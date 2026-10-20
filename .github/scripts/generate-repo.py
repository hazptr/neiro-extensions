"""Generate the extension repo served from the `repo` branch.

Usage: generate-repo.py <artifacts-dir> <output-dir>

<artifacts-dir> holds the build outputs: each extension's keiyoushi-source-info.json
(emitted by assembleRelease, see GenerateSourceInfoTask) with its release APK under
outputs/apk/release/ next to it. <output-dir> receives the repo in the format apps read
from index.min.json:

    index.min.json    one entry per extension
    repo.json         repo metadata, including the signing cert's SHA-256 fingerprint
    apk/<name>.apk
    icon/<pkg>.png

The fingerprint is read from the APKs with apksigner (APKSIGNER, or the newest
$ANDROID_HOME/build-tools). Every APK must carry the same single signer, and a debug
signature is refused, so a build without the release key can't be published.
"""

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from xml.etree import ElementTree

ANDROID_NS = "http://schemas.android.com/apk/res/android"
AUDIO_METADATA = "neiro.extension.audio"

REPO_META = {
    "name": "Neiro Extensions",
    "shortName": "Neiro",
    "website": "https://github.com/hazptr/neiro-extensions",
}

SOURCE_DIR = Path(__file__).resolve().parents[2]
ICON_FILE = "res/mipmap-xhdpi/ic_launcher.png"

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

    index = []
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

        index.append(
            {
                "name": f"Tachiyomi: {info['name']}",
                "pkg": package_name,
                "apk": apk.name,
                # Module directory's language: "all" for multi-language extensions.
                "lang": info["module"].split(".")[0],
                "code": info["versionCode"],
                "version": info["versionName"],
                # contentWarning: SAFE=1, MIXED=2, NSFW=3
                "nsfw": 1 if info["contentWarning"] > 2 else 0,
                # Neiro badges extensions that play background music
                "audio": 1 if has_audio(info["module"]) else 0,
                "sources": [
                    {
                        "name": source["name"],
                        "lang": source["lang"],
                        "id": str(source["id"]),
                        "baseUrl": source["baseUrl"],
                    }
                    for source in info["sources"]
                ],
            }
        )

    if not index:
        raise FileNotFoundError(f"no keiyoushi-source-info.json under {artifacts_dir}")
    if len(fingerprints) != 1:
        raise ValueError(f"APKs are signed with {len(fingerprints)} different certificates")

    index.sort(key=lambda ext: ext["pkg"])
    with (output_dir / "index.min.json").open("w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))

    repo = {"meta": {**REPO_META, "signingKeyFingerprint": fingerprints.pop()}}
    with (output_dir / "repo.json").open("w", encoding="utf-8") as f:
        json.dump(repo, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Wrote {len(index)} extension(s) to {output_dir}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]))
