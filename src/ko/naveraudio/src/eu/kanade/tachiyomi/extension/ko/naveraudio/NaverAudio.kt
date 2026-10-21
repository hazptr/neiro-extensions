package eu.kanade.tachiyomi.extension.ko.naveraudio

import eu.kanade.tachiyomi.source.model.AudioCue
import eu.kanade.tachiyomi.source.model.AudioTrack
import eu.kanade.tachiyomi.source.model.ChapterAudio
import eu.kanade.tachiyomi.source.model.FilterList
import eu.kanade.tachiyomi.source.model.MangasPage
import eu.kanade.tachiyomi.source.model.Page
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.SManga
import eu.kanade.tachiyomi.source.model.SMangaUpdate
import keiyoushi.annotation.Source
import keiyoushi.network.get
import keiyoushi.source.KeiSource
import keiyoushi.utils.asJsoup
import keiyoushi.utils.parseAs
import keiyoushi.utils.tryParseDate
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Response
import org.jsoup.nodes.Document
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val dateFormat = DateTimeFormatter.ofPattern("yy.M.d")
private val seoulZone = ZoneId.of("Asia/Seoul")

@Source
abstract class NaverAudio : KeiSource() {

    // Challenge and Best Challenge episodes carry no background music, so only the regular series is here.
    private val mType = "webtoon"

    internal val mobileUrl = "https://m.comic.naver.com"

    // 1.4 stored absolute m.comic.naver.com URLs for entries added from popular/latest
    private fun SManga.titleId() = url.substringAfter("titleId=").substringBefore("&")

    override fun getMangaUrl(manga: SManga): String = "$baseUrl/$mType/list?titleId=${manga.titleId()}"

    // ============================== Popular ==============================

    override suspend fun getPopularManga(page: Int): MangasPage = client.get("$mobileUrl/$mType/weekday?sort=ALL_READER").let(::parseMangaList)

    private fun parseMangaList(response: Response): MangasPage {
        val document = response.asJsoup()
        val mangas = document.select(".list_toon > [class='item ']").mapNotNull { element ->
            val url = element.selectFirst("a")?.attr("abs:href") ?: return@mapNotNull null
            val title = element.selectFirst("strong")?.text() ?: return@mapNotNull null

            SManga.create().apply {
                setUrlWithoutDomain(url)
                this.title = title
                this.author = element.selectFirst("span.author")?.text()?.split(" / ")?.joinToString() ?: ""
                this.thumbnail_url = element.selectFirst("img")?.attr("abs:src")
            }
        }
        return MangasPage(mangas, false)
    }

    // ============================== Latest ===============================

    override suspend fun getLatestUpdates(page: Int): MangasPage = client.get("$mobileUrl/$mType/weekday?sort=UPDATE").let(::parseMangaList)

    // ============================== Search ===============================

    override suspend fun getSearchMangaList(page: Int, query: String, filters: FilterList): MangasPage {
        val result = client.get("$baseUrl/api/search/$mType?keyword=$query&page=$page")
            .parseAs<ApiMangaSearchResponse>()
        return MangasPage(result.toSMangas(mType), result.hasNextPage)
    }

    // ============================== Details ==============================

    override suspend fun fetchMangaUpdate(
        manga: SManga,
        chapters: List<SChapter>,
        fetchDetails: Boolean,
        fetchChapters: Boolean,
    ): SMangaUpdate = coroutineScope {
        val titleId = manga.titleId()

        val details = if (fetchDetails) {
            async {
                client.get("$baseUrl/api/article/list/info?titleId=$titleId")
                    .parseAs<Manga>()
                    .toSManga(mType)
                    .apply { url = manga.url }
            }
        } else {
            null
        }

        val chapterList = if (fetchChapters) {
            async { fetchChapterList(titleId) }
        } else {
            null
        }

        SMangaUpdate(
            details?.await() ?: manga,
            chapterList?.await() ?: chapters,
        )
    }

    // ============================= Chapters ==============================

    private suspend fun fetchChapterList(titleId: String): List<SChapter> {
        val chapters = mutableListOf<SChapter>()
        var page = 1

        while (true) {
            val result = client.get("$baseUrl/api/article/list?titleId=$titleId&page=$page")
                .parseAs<ApiMangaChapterListResponse>()

            chapters.addAll(
                result.articleList.map { chapter ->
                    chapter.toSChapter(mType, result.titleId, ::parseChapterDate)
                },
            )

            if (!result.hasNextPage) break

            page = result.pageInfo.nextPage
        }

        return chapters
    }

    private fun parseChapterDate(date: String): Long = if (date.contains(":")) {
        System.currentTimeMillis()
    } else {
        dateFormat.tryParseDate(date, seoulZone)
    }

    // =============================== Pages ===============================

    override suspend fun getPageList(chapter: SChapter): List<Page> {
        val document = client.get(getChapterUrl(chapter)).asJsoup()

        var urls = document.select(".wt_viewer img").map { it.attr("abs:src").ifEmpty { it.attr("src") } }
        if (urls.isEmpty()) {
            urls = document.select(".toon_view_lst img.toon_image").map {
                it.attr("abs:data-src").ifEmpty { it.attr("abs:src") }
            }
        }

        val pages = urls.mapIndexed { index, url -> Page(index, imageUrl = url) }

        // AudioTrack/AudioCue/ChapterAudio are compileOnly and absent from apps that predate them;
        // runCatching turns the resulting LinkageError into "no music" instead of a dead chapter.
        runCatching { attachBgm(document, pages) }

        return pages
    }

    /**
     * Attaches the episode's background music to the first page.
     *
     * ChapterAudio/AudioTrack/AudioCue/Page.chapterAudio are compileOnly and absent from the built
     * APK, so every reference to them stays in this one method, under the runCatching at the call
     * site. An episode has at most one track, which starts at the top and does not loop, so a
     * single cue covers every page. toPageIndex is exclusive, hence pages.size.
     *
     * Older episodes point at `/bgsound/<uuid>.mp3` without the `bgm_` prefix. Those are real
     * tracks too (a HEAD request reports length 0, a GET returns the audio), so both kinds are used.
     */
    private fun attachBgm(document: Document, pages: List<Page>) {
        if (pages.isEmpty()) return

        val src = document.selectFirst("audio#bgmPlayer source[src]")?.attr("abs:src") ?: return
        val trackId = src.toHttpUrl().pathSegments.last().substringBeforeLast('.')
        pages[0].chapterAudio = ChapterAudio(
            tracks = listOf(AudioTrack(id = trackId, url = src)),
            cues = listOf(AudioCue(trackId = trackId, fromPageIndex = 0, toPageIndex = pages.size)),
        )
    }
}
