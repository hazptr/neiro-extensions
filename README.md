# neiro-extensions

Extensions for [Neiro](https://github.com/hazptr/neiro), a Mihon fork that plays background music
provided by a source. It holds two extensions:

- **Webtoons.com Audio** (`eu.kanade.tachiyomi.extension.all.webtoonsaudio`): the Webtoons.com
  extension, plus the background music of sound episodes, attached to the chapter as a
  `ChapterAudio` timeline. It has its own package and source IDs, so it installs next to
  keiyoushi's Webtoons.com instead of replacing it. In an app without `ChapterAudio`, sound
  episodes read normally, without music.
- **Naver Webtoon Audio** (`eu.kanade.tachiyomi.extension.ko.naveraudio`): the Naver Webtoon source
  from keiyoushi's Naver Comic, plus the background music of the episodes that have one. Those
  episodes end in a note (♫) in the chapter list. Challenge and Best Challenge are left out, as their
  episodes have no music. It has its own package and source ID, so it installs next to keiyoushi's
  Naver Comic.

The store and everything in it: [hazptr.github.io/neiro-extensions](https://hazptr.github.io/neiro-extensions/)

## Adding the repo

In Neiro: **Settings → Browse → Extension stores → Add extension store**, and enter

```
https://raw.githubusercontent.com/hazptr/neiro-extensions/repo/index.min.json
```

Both extensions then show up in the extension list.

## Building

The build is keiyoushi's. Extensions compile against
[neiro-extensions-lib](https://github.com/hazptr/neiro-extensions-lib), keiyoushi's extensions-lib
plus the `ChapterAudio` types.

```
./gradlew :src:all:webtoons:assembleRelease
./gradlew :src:ko:naveraudio:assembleRelease
```

Release builds are signed with `signingkey.jks` in the repository root when it exists, using the
`ALIAS`, `KEY_STORE_PASSWORD` and `KEY_PASSWORD` environment variables, and with the debug key
otherwise. CI builds every push to `main` and publishes the repo to the `repo` branch.

## Credits

Based on [keiyoushi/extensions-source](https://github.com/keiyoushi/extensions-source) at
[`ff521c17bb3e503c01e658e8fac00b60a95829f3`](https://github.com/keiyoushi/extensions-source/tree/ff521c17bb3e503c01e658e8fac00b60a95829f3),
trimmed to what the two extensions need. Licensed under the Apache License 2.0, see [LICENSE](LICENSE).
