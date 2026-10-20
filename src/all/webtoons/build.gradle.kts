import io.github.keiyoushi.gradle.api.ContentWarning

plugins {
    alias(kei.plugins.extension)
}

keiyoushi {
    // Own package and name, so it installs alongside keiyoushi's Webtoons.com and its source IDs differ.
    name = "Webtoons.com Audio"
    pkgName = "all.webtoonsaudio"
    versionCode = 1
    contentWarning = ContentWarning.SAFE
    libVersion = "1.6"

    listOf("en", "id", "th", "es", "fr", "zh-Hant", "de").forEach { langCode ->
        source {
            lang = langCode
            baseUrl = "https://www.webtoons.com"
        }
    }

    deeplink {
        host("webtoons.com")
        host("www.webtoons.com")
        host("m.webtoons.com")
        path("/.*/.*/.*/..*")
        path("/.*/.*/.*/.*/..*")
    }
}

dependencies {
    implementation(project(":lib:textinterceptor"))
}
