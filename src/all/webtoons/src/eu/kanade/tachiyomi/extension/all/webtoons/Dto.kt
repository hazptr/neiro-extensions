package eu.kanade.tachiyomi.extension.all.webtoons

import kotlinx.serialization.Serializable

typealias EpisodeListResponse = ResultDto<EpisodeList>

@Serializable
class ResultDto<T>(
    val result: T,
)

@Serializable
class EpisodeList(
    val episodeList: List<Episode>,
)

@Serializable
class Episode(
    val episodeTitle: String,
    val viewerLink: String,
    val exposureDateMillis: Long,
    val hasBgm: Boolean = false,
) {
    var chapterNumber = -1f
    var seasonNumber = 1
}

@Serializable
class MotionToonResponse(
    val assets: MotionToonAssets,
)

@Serializable
class MotionToonAssets(
    val images: Map<String, String>,
)

// Background music ("sound episodes"). The viewer page inlines a window.__audioProperties__
// object; each entry names an audio track plus the images it should start and stop on.
@Serializable
class EpisodeBgm(
    val audioId: String,
    val playImageUrl: String = "",
    val stopImageUrl: String = "",
)

// Naver audiocloud hands back a base64 blob that wraps the real, signed media URL.
@Serializable
class AudioTokenResponse(
    val result: AudioTokenResult,
)

@Serializable
class AudioTokenResult(
    val playToken: String,
)

@Serializable
class PlayToken(
    val audioInfo: AudioInfo,
)

@Serializable
class AudioInfo(
    val url: String,
)
