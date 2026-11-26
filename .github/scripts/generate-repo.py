"""Generate the extension repo served from the `repo` branch.

Usage: generate-repo.py <artifacts-dir> <output-dir>

<artifacts-dir> holds the build outputs: each extension's keiyoushi-source-info.json
(emitted by assembleRelease, see GenerateSourceInfoTask) with its release APK under
outputs/apk/release/ next to it. <output-dir> receives the repo in keiyoushi's format
(index.proto, Mihon's index plus keiyoushi's and Neiro's fields):

    index.pb          the index, gzipped protobuf
    index.json        the same index as JSON
    repo.json         points apps given the old index.min.json URL at index.pb
    index.min.json    empty list, so those apps go on to repo.json
    store-icon.png    the store's icon (Index.iconUrl)
    apk/<name>.apk
    icon/<pkg>.png

The fingerprint is read from the APKs with apksigner (APKSIGNER, or the newest
$ANDROID_HOME/build-tools). Every APK must carry the same single signer, and a debug
signature is refused, so a build without the release key can't be published.
"""

import gzip
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from xml.etree import ElementTree

import index_pb2
from google.protobuf import json_format

ANDROID_NS = "http://schemas.android.com/apk/res/android"
AUDIO_METADATA = "neiro.extension.audio"

STORE_NAME = "Neiro Extensions"
BADGE_LABEL = "Neiro"
WEBSITE = "https://github.com/hazptr/neiro-extensions"
REPO_URL = f"https://raw.githubusercontent.com/{os.environ.get('GITHUB_REPOSITORY', 'hazptr/neiro-extensions')}/repo"

SOURCE_DIR = Path(__file__).resolve().parents[2]
ICON_FILE = "res/mipmap-xhdpi/ic_launcher.png"
STORE_ICON = SOURCE_DIR / ".github/store-icon.png"

# apksigner labels signers "Signer #1", "V2 Signer:" or by SDK range, depending on its version
SIGNER = r"^(?:V\d+ )?Signer(?: #\d+| \([^)]*\))?:? certificate"
CERT_DIGEST_REGEX = re.compile(SIGNER + r" SHA-256 digest: ([0-9a-f]{64})$", re.MULTILINE)
CERT_DN_REGEX = re.compile(SIGNER + r" DN: (.*)$", re.MULTILINE)


def find_apksigner() -> str:
    if env := os.environ.get("APKSIGNER"):
        return env
    if found := shutil.which("apksigner"):
        return found
    build_tools = Path(os.environ["ANDROID_HOME"]) / "build-tools"
    versions = sorted(
        (d for d in build_tools.iterdir() if (d / "apksigner").exists()),
        key=lambda d: [int(p) if p.isdigit() else 0 for p in re.split(r"[.-]", d.name)],
    )
    if not versions:
        raise FileNotFoundError(f"no apksigner under {build_tools}")
    return str(versions[-1] / "apksigner")


def signing_fingerprint(apksigner: str, apk: Path) -> str:
    out = subprocess.run(
        [apksigner, "verify", "--print-certs", str(apk)],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    # The same certificate can be listed once per SDK range
    digests = set(CERT_DIGEST_REGEX.findall(out))
    if len(digests) != 1:
        print(out, file=sys.stderr)
        raise ValueError(f"{apk.name}: expected exactly one signer, found {len(digests)}")
    if any("CN=Android Debug" in dn for dn in CERT_DN_REGEX.findall(out)):
        raise ValueError(f"{apk.name}: signed with a debug key, not the release key")
    # Lowercase hex without separators, the form the app compares against.
    return digests.pop()


def has_audio(module: str) -> bool:
    """Whether the module's manifest declares that it attaches background music to chapters."""
    manifest = SOURCE_DIR / "src" / module.replace(".", "/") / "AndroidManifest.xml"
    if not manifest.exists():
        return False
    application = ElementTree.parse(manifest).getroot().find("application")
    return any(
        meta.get(f"{{{ANDROID_NS}}}name") == AUDIO_METADATA and meta.get(f"{{{ANDROID_NS}}}value") == "true"
        for meta in (application if application is not None else [])
        if meta.tag == "meta-data"
    )


def icon_path(module: str, theme: str | None) -> Path:
    candidates = [SOURCE_DIR / "src" / module.replace(".", "/") / ICON_FILE]
    if theme:
        candidates.append(SOURCE_DIR / "lib-multisrc" / theme / ICON_FILE)
    candidates.append(SOURCE_DIR / "core/src/main" / ICON_FILE)
    return next(p for p in candidates if p.exists())


def main(artifacts_dir: Path, output_dir: Path) -> None:
    apksigner = find_apksigner()
    apk_dir = output_dir / "apk"
    icon_dir = output_dir / "icon"
    apk_dir.mkdir(parents=True, exist_ok=True)
    icon_dir.mkdir(parents=True, exist_ok=True)

    extensions = []
    fingerprints = set()

    for info_file in sorted(artifacts_dir.glob("**/keiyoushi-source-info.json")):
        info = json.loads(info_file.read_text(encoding="utf-8"))
        package_name = info["packageName"]
        apks = sorted((info_file.parent / "outputs/apk/release").glob("*.apk"))
        if len(apks) != 1:
            raise FileNotFoundError(f"{package_name}: expected one release apk, found {len(apks)}")
        apk = apks[0]

        fingerprints.add(signing_fingerprint(apksigner, apk))
        shutil.copyfile(apk, apk_dir / apk.name)
        shutil.copyfile(icon_path(info["module"], info.get("theme")), icon_dir / f"{package_name}.png")

        extensions.append(
            index_pb2.Extension(
                name=info["name"],
                packageName=package_name,
                resources=index_pb2.Resources(
                    apkUrl=f"{REPO_URL}/apk/{apk.name}",
                    iconUrl=f"{REPO_URL}/icon/{package_name}.png",
                ),
                extensionLib=info["extensionLib"],
                versionCode=info["versionCode"],
                versionName=info["versionName"],
                contentWarning=info["contentWarning"],
                sources=[
                    index_pb2.Source(
                        id=int(source["id"]),
                        name=source["name"],
                        language=source["lang"],
                        homeUrl=source["baseUrl"],
                        mirrorUrls=source.get("mirrorUrls", []),
                    )
                    for source in info["sources"]
                ],
                audio=has_audio(info["module"]),
            )
        )

    if not extensions:
        raise FileNotFoundError(f"no keiyoushi-source-info.json under {artifacts_dir}")
    if len(fingerprints) != 1:
        raise ValueError(f"APKs are signed with {len(fingerprints)} different certificates")

    extensions.sort(key=lambda ext: ext.packageName)
    fingerprint = fingerprints.pop()
    index = index_pb2.Index(
        name=STORE_NAME,
        badgeLabel=BADGE_LABEL,
        signingKey=fingerprint,
        contact=index_pb2.Contact(website=WEBSITE),
        extensionList=index_pb2.ExtensionList(extensions=extensions),
        iconUrl=f"{REPO_URL}/store-icon.png",
    )
    with (output_dir / "index.pb").open("wb") as f:
        f.write(gzip.compress(index.SerializeToString(deterministic=True), mtime=0))
    with (output_dir / "index.json").open("w", encoding="utf-8") as f:
        f.write(
            json_format.MessageToJson(
                index,
                always_print_fields_with_no_presence=False,
                preserving_proto_field_name=True,
            )
        )

    repo = {
        "index_v2": f"{REPO_URL}/index.pb",
        "meta": {
            "name": STORE_NAME,
            "shortName": BADGE_LABEL,
            "website": WEBSITE,
            "signingKeyFingerprint": fingerprint,
        },
    }
    with (output_dir / "repo.json").open("w", encoding="utf-8") as f:
        json.dump(repo, f, ensure_ascii=False, indent=2)
        f.write("\n")
    with (output_dir / "index.min.json").open("w", encoding="utf-8") as f:
        f.write("[]")
    shutil.copyfile(STORE_ICON, output_dir / "store-icon.png")

    print(f"Wrote {len(extensions)} extension(s) to {output_dir}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]))
