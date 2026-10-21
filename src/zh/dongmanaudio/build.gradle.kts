import io.github.keiyoushi.gradle.api.ContentWarning

plugins {
    alias(kei.plugins.extension)
}

keiyoushi {
    // Own package and name, so it installs alongside keiyoushi's Dongman Manhua and its source ID differs.
    name = "Dongman Manhua Audio"
    pkgName = "zh.dongmanaudio"
    versionCode = 0
    contentWarning = ContentWarning.SAFE
    libVersion = "1.6"

    source {
        // The source ID hashes this name, so it must differ from keiyoushi's "Dongman Manhua".
        name = "Dongman Manhua Audio"
        lang = "zh-Hans"
        baseUrl = "https://www.dongmanmanhua.cn"
    }
}
