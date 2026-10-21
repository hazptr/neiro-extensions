import io.github.keiyoushi.gradle.api.ContentWarning

plugins {
    alias(kei.plugins.extension)
}

keiyoushi {
    // Own package and name, so it installs alongside keiyoushi's Naver Comic and its source ID differs.
    name = "Naver Webtoon Audio"
    pkgName = "ko.naveraudio"
    versionCode = 0
    contentWarning = ContentWarning.SAFE
    libVersion = "1.6"

    // Only the regular series: Challenge and Best Challenge episodes carry no background music.
    source {
        // The source ID hashes this name, so it must differ from keiyoushi's "Naver Webtoon".
        name = "Naver Webtoon Audio"
        lang = "ko"
        baseUrl = "https://comic.naver.com"
    }
}
