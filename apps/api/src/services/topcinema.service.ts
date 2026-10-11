import https from 'https';
import http from 'http';
import { vodRepository, Movie, Series, Episode } from '../repositories/vod.repository';
import { isValidStreamEmbed } from './fivetv.service';
import { streamResolverService } from './stream-resolver.service';

export interface TopCinemaSyncReport {
  moviesAdded: number;
  seriesAdded: number;
  episodesAdded: number;
  totalMovies: number;
  totalSeries: number;
  newEpisodes: number;
  durationMs: number;
}

export class TopCinemaService {
  private readonly BASE_URL = 'https://web.topcinema.io';
  private readonly USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  private autoUpdateInterval: NodeJS.Timeout | null = null;
  private isSyncing = false;

  /**
   * Helper to make resilient HTTP GET requests with redirect following
   */
  private fetchHtml(url: string, retries = 2): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const client = isHttps ? https : http;

      const req = client.get({
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        headers: {
          'User-Agent': this.USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ar,en-US;q=0.7,en;q=0.3',
          'Referer': this.BASE_URL + '/',
        },
      }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let loc = res.headers.location;
          if (!loc.startsWith('http')) {
            loc = new URL(loc, url).toString();
          }
          return this.fetchHtml(loc, retries - 1).then(resolve).catch(reject);
        }

        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`HTTP error ${res.statusCode} for ${url}`));
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });

      req.on('error', (err) => {
        if (retries > 0) {
          setTimeout(() => {
            this.fetchHtml(url, retries - 1).then(resolve).catch(reject);
          }, 1000);
        } else {
          reject(err);
        }
      });

      req.setTimeout(14000, () => {
        req.destroy();
        if (retries > 0) {
          this.fetchHtml(url, retries - 1).then(resolve).catch(reject);
        } else {
          reject(new Error(`Timeout fetching ${url}`));
        }
      });
    });
  }

  /**
   * Fetch specific server iframe via Single/Server.php
   */
  private fetchServer(id: string, sIndex: string): Promise<string | null> {
    return new Promise((resolve) => {
      const postData = new URLSearchParams({ id, i: String(sIndex) }).toString();
      const req = https.request('https://web.topcinema.io/wp-content/themes/movies2023/Ajaxat/Single/Server.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': this.USER_AGENT,
          'Referer': this.BASE_URL + '/',
          'X-Requested-With': 'XMLHttpRequest'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const iframeMatch = data.match(/<iframe[^>]+src="([^"]+)"/i);
          resolve(iframeMatch ? iframeMatch[1] : null);
        });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(8000, () => { req.destroy(); resolve(null); });
      req.write(postData);
      req.end();
    });
  }

  /**
   * Extract working stream iframe and details from a watch page
   * STRICT: NEVER returns website URL as streamUrl!
   */
  private async extractWatchDetails(watchUrl: string): Promise<{
    streamUrl: string | null;
    posterUrl: string | null;
    description: string | null;
    rating: number | null;
  }> {
    try {
      const html = await this.fetchHtml(watchUrl);
      const descMatch = html.match(/<meta property="og:description" content="([^"]+)"/i)
        || html.match(/<div class="story"[^>]*>([\s\S]*?)<\/div>/i);
      const posterMatch = html.match(/<meta property="og:image" content="([^"]+)"/i);
      const ratingMatch = html.match(/<div class="imdbBox">[\s\S]*?<span>([\d.]+)<\/span>/i)
        || html.match(/<li[^>]*class="imdbRating"[^>]*>([\d.]+)<\/li>/i);

      let cleanDesc: string | null = null;
      if (descMatch) {
        cleanDesc = descMatch[1].replace(/<[^>]+>/g, '').trim();
      }

      // Extract all server items from HTML
      const serverItems = [...html.matchAll(/<li[^>]+data-id="([^"]+)"[^>]+data-server="([^"]+)"[^>]*>([\s\S]*?)<\/li>/gi)].map(m => ({
        id: m[1],
        sIndex: m[2],
        name: m[3].replace(/<[^>]+>/g, '').trim().toLowerCase()
      }));

      let chosenStream: string | null = null;

      if (serverItems.length > 0) {
        // Preference ranking: OK.ru (Server 5, rock-solid, 1080p, no restrictions) > Streamtape > LuluStream > Mixdrop > Firestream > UpStream > StreamWish (demoted due to domain block) > VidTube (blocked)
        const getRank = (item: { name: string; sIndex: string }) => {
          if (item.name.includes('ok')) return 1;
          if (item.name.includes('streamtape')) return 2;
          if (item.name.includes('lulu')) return 3;
          if (item.name.includes('mixdrop')) return 4;
          if (item.name.includes('firestream')) return 5;
          if (item.name.includes('upstream')) return 6;
          if (item.name.includes('dood')) return 7;
          if (item.name.includes('streamwish') || item.name.includes('streamhg') || item.sIndex === '2') return 8; // Demote StreamWish due to domain restrictions
          if (item.name.includes('filelion') || item.name.includes('earnvids')) return 9;
          if (item.name.includes('tube') || item.sIndex === '0') return 10; // VidTube disables embeds!
          return 7;
        };

        serverItems.sort((a, b) => getRank(a) - getRank(b));

        for (const item of serverItems) {
          if (getRank(item) >= 10 && serverItems.length > 1) {
            continue; // Skip VidTube
          }
          const stream = await this.fetchServer(item.id, item.sIndex);
          if (stream && isValidStreamEmbed(stream) && !stream.includes('vidtube') && !stream.includes('videotube')) {
            chosenStream = stream;
            break;
          }
        }

        if (!chosenStream && serverItems[0]) {
          const fallbackStream = await this.fetchServer(serverItems[0].id, serverItems[0].sIndex);
          if (fallbackStream && isValidStreamEmbed(fallbackStream)) {
            chosenStream = fallbackStream;
          }
        }
      }

      // Fallback to iframe in HTML if Server.php didn't respond
      if (!chosenStream) {
        const iframeMatch = html.match(/<iframe[^>]+src="([^"]+)"/i);
        if (iframeMatch && isValidStreamEmbed(iframeMatch[1])) {
          chosenStream = iframeMatch[1];
        }
      }

      // Automatically extract direct video stream URL if available
      if (chosenStream) {
        try {
          const direct = await streamResolverService.resolveDirectStream(chosenStream);
          if (direct.directUrl) {
            chosenStream = direct.directUrl;
          }
        } catch {}
      }

      return {
        streamUrl: chosenStream,
        posterUrl: posterMatch ? posterMatch[1] : null,
        description: cleanDesc,
        rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
      };
    } catch {
      return { streamUrl: null, posterUrl: null, description: null, rating: null };
    }
  }

  /**
   * Parse Arabic word ordinal or digit into a number
   */
  private parseArabicOrdinal(text: string): number {
    if (!text) return 1;
    const t = text.trim();
    const digitMatch = t.match(/\d+/);
    if (digitMatch) return parseInt(digitMatch[0], 10);
    if (t.includes('الاول') || t.includes('الأول')) return 1;
    if (t.includes('الثاني')) return 2;
    if (t.includes('الثالث')) return 3;
    if (t.includes('الرابع')) return 4;
    if (t.includes('الخامس')) return 5;
    if (t.includes('السادس')) return 6;
    if (t.includes('السابع')) return 7;
    if (t.includes('الثامن')) return 8;
    if (t.includes('التاسع')) return 9;
    if (t.includes('العاشر')) return 10;
    if (t.includes('الحادي عشر')) return 11;
    if (t.includes('الثاني عشر')) return 12;
    return 1;
  }

  /**
   * Normalize title string for strict deduplication
   */
  public normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/^(فيلم|مسلسل|انمي)\s+/i, '')
      .replace(/(مترجم|مدبلج|كامل|اون لاين|بجودة|hd|web-dl|bluray)/gi, '')
      .replace(/[^\w\u0600-\u06FF]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .trim();
  }

  /**
   * Crawl movies from TopCinema (crawls all pages from page 1 to end when maxPages is 0)
   */
  async scrapeMovies(maxPages = 0): Promise<number> {
    let totalAdded = 0;
    let page = 1;

    while (true) {
      if (maxPages > 0 && page > maxPages) break;
      const pageUrl = page === 1 ? `${this.BASE_URL}/movies/` : `${this.BASE_URL}/movies/page/${page}/`;

      try {
        const html = await this.fetchHtml(pageUrl);
        const movieBoxes = [...html.matchAll(/<div class="Small--Box[^"]*">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];

        if (movieBoxes.length === 0) break;

        // Process in chunks of 5
        const chunkSize = 5;
        for (let i = 0; i < movieBoxes.length; i += chunkSize) {
          const chunk = movieBoxes.slice(i, i + chunkSize);
          await Promise.all(chunk.map(async (box) => {
            const pageUrl = box[1];
            const titleMatch = box[2].match(/<h3 class="title">([^<]+)<\/h3>/i);
            const title = titleMatch ? titleMatch[1].trim() : '';
            if (!title) return;

            const posterMatch = box[2].match(/data-src="([^"]+)"/i) || box[2].match(/src="([^"]+)"/i);
            const defaultPoster = posterMatch ? posterMatch[1] : undefined;

            const yearMatch = title.match(/\b(19\d{2}|20\d{2})\b/);
            const releaseYear = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();

            const genreMatches = [...box[2].matchAll(/<li>([^<]+)<\/li>/gi)].map(m => m[1].trim());
            const category = genreMatches.length > 0 ? `أفلام ${genreMatches.join(' - ')}` : 'أفلام توب سينما';

            // Fetch stream link from watch page
            const watchUrl = pageUrl.replace(/\/$/, '') + '/watch/';
            const details = await this.extractWatchDetails(watchUrl);

            // STRICT: Must be a pure stream embed! NEVER save website URL!
            if (!isValidStreamEmbed(details.streamUrl)) {
              return;
            }

            await vodRepository.upsertMovie({
              title,
              normalizedTitle: this.normalizeTitle(title),
              category,
              posterUrl: details.posterUrl || defaultPoster,
              description: details.description || `مشاهدة وتحميل ${title} بجودة عالية وبدون تقطيع على أسبيرين TV.`,
              releaseYear,
              rating: details.rating || 7.5,
              streamUrl: details.streamUrl!,
              containerExtension: 'html',
            });

            totalAdded++;
          }));
        }

        page++;
      } catch (err: any) {
        console.error(`Error scraping TopCinema movies page ${page}:`, err.message);
        break;
      }
    }

    return totalAdded;
  }

  /**
   * Crawl TV Series and all their ordered seasons & episodes with category pagination
   * Extracts pure embed streams for each episode (no website links!)
   */
  async scrapeSeries(maxSeries = 0, maxCatPages = 0): Promise<{ seriesAdded: number; episodesAdded: number }> {
    let seriesAdded = 0;
    let episodesAdded = 0;

    const categories = [
      `${this.BASE_URL}/category/%d9%85%d8%b3%d9%84%d8%b3%d9%84%d8%a7%d8%aa-%d8%a7%d8%ac%d9%86%d8%a8%d9%8a/`,
      `${this.BASE_URL}/category/%d9%85%d8%b3%d9%84%d8%b3%d9%84%d8%a7%d8%aa-%d8%a7%d8%b3%d9%8a%d9%88%d9%8a%d8%a9/`,
      `${this.BASE_URL}/category/%d9%85%d8%b3%d9%84%d8%b3%d9%84%d8%a7%d8%aa-%d8%a7%d9%86%d9%85%d9%8a/`,
      `${this.BASE_URL}/category/%d9%85%d8%b3%d9%84%d8%b3%d9%84%d8%a7%d8%aa-%d8%aa%d8%b1%d9%83%d9%8a%d8%a9/`,
      `${this.BASE_URL}/category/%d9%85%d8%b3%d9%84%d8%b3%d9%84%d8%a7%d8%aa-%d8%b9%d8%b1%d8%a8%d9%8a%d8%a9/`,
    ];

    for (const catBase of categories) {
      if (maxSeries > 0 && seriesAdded >= maxSeries) break;

      let p = 1;
      while (true) {
        if (maxCatPages > 0 && p > maxCatPages) break;
        if (maxSeries > 0 && seriesAdded >= maxSeries) break;

        const catUrl = p === 1 ? catBase : `${catBase}page/${p}/`;

        try {
          const catHtml = await this.fetchHtml(catUrl);
          const seriesBoxes = [...catHtml.matchAll(/<div class="Small--Box">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
          if (seriesBoxes.length === 0) break;

          for (const sBox of seriesBoxes) {
            if (maxSeries > 0 && seriesAdded >= maxSeries) break;

            const seriesUrl = sBox[1];
            const sTitleMatch = sBox[2].match(/<h3 class="title">([^<]+)<\/h3>/i);
            const rawTitle = sTitleMatch ? sTitleMatch[1].trim() : 'Unknown';
            const defaultPosterMatch = sBox[2].match(/data-src="([^"]+)"/i) || sBox[2].match(/src="([^"]+)"/i);
            const defaultPoster = defaultPosterMatch ? defaultPosterMatch[1] : undefined;

            try {
              const seriesHtml = await this.fetchHtml(seriesUrl);
              const descMatch = seriesHtml.match(/<div class="story"[^>]*>([\s\S]*?)<\/div>/i);
              const posterMatch = seriesHtml.match(/<meta property="og:image" content="([^"]+)"/i);
              const ratingMatch = seriesHtml.match(/<div class="imdbBox">[\s\S]*?<span>([\d.]+)<\/span>/i);

              const seasonBoxes = [...seriesHtml.matchAll(/<div class="Small--Box Season">\s*<a href="([^"]+)"[\s\S]*?<div class="epnum"><span>الموسم<\/span>([^<]+)<\/div>[\s\S]*?<\/a>/gi)];
              const totalSeasons = Math.max(1, seasonBoxes.length);

              const yearMatch = rawTitle.match(/\b(19\d{2}|20\d{2})\b/);
              const releaseYear = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();

              const categoryName = catBase.includes('انمي') ? 'مسلسلات أنمي' :
                                   catBase.includes('اسيوي') ? 'مسلسلات آسيوية' :
                                   catBase.includes('تركي') ? 'مسلسلات تركية' :
                                   catBase.includes('عربي') ? 'مسلسلات عربية' : 'مسلسلات أجنبية';

              const createdSeries = await vodRepository.upsertSeries({
                title: rawTitle,
                normalizedTitle: this.normalizeTitle(rawTitle),
                category: categoryName,
                posterUrl: posterMatch ? posterMatch[1] : defaultPoster,
                description: descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : `مسلسل ${rawTitle} كامل المواسم والحلقات بدون تكرار.`,
                releaseYear,
                rating: ratingMatch ? parseFloat(ratingMatch[1]) : 8.0,
                totalSeasons,
              });

              seriesAdded++;

              // Process each season and its episodes
              for (const seasonBox of seasonBoxes) {
                const seasonUrl = seasonBox[1];
                const seasonNum = this.parseArabicOrdinal(seasonBox[2]);

                try {
                  const seasonHtml = await this.fetchHtml(seasonUrl);
                  const epMatches = [...seasonHtml.matchAll(/<a[^>]+href="([^"]+)"[^>]*title="([^"]*الحلقة[^"]*)"/gi)];

                  // Process episodes in chunks of 4
                  const epChunkSize = 4;
                  for (let j = 0; j < epMatches.length; j += epChunkSize) {
                    const epChunk = epMatches.slice(j, j + epChunkSize);
                    await Promise.all(epChunk.map(async (epMatch) => {
                      const epUrl = epMatch[1];
                      const epTitle = epMatch[2].replace(/- توب سينما/g, '').trim();
                      const numMatch = epTitle.match(/الحلقة\s*(\d+)/i);
                      const epNum = numMatch ? parseInt(numMatch[1], 10) : 1;

                      // Fetch episode watch stream
                      const epWatchUrl = epUrl.replace(/\/$/, '') + '/watch/';
                      const epDetails = await this.extractWatchDetails(epWatchUrl);

                      // STRICT: Must be a pure stream embed! NEVER save epWatchUrl or website URL!
                      if (!isValidStreamEmbed(epDetails.streamUrl)) {
                        return;
                      }

                      await vodRepository.upsertEpisode({
                        seriesId: createdSeries.id,
                        seasonNum,
                        episodeNum: epNum,
                        title: `الموسم ${seasonNum} - الحلقة ${epNum}`,
                        posterUrl: epDetails.posterUrl || createdSeries.posterUrl,
                        description: epDetails.description || `${rawTitle} - الموسم ${seasonNum} الحلقة ${epNum}`,
                        streamUrl: epDetails.streamUrl!,
                        containerExtension: 'html',
                      });

                      episodesAdded++;
                    }));
                  }
                } catch (err: any) {
                  console.error(`Error scraping season ${seasonNum} for ${rawTitle}:`, err.message);
                }
              }
            } catch (err: any) {
              console.error(`Error scraping series page ${seriesUrl}:`, err.message);
            }
          }

          p++;
        } catch (err: any) {
          console.error(`Error scraping series category ${catUrl}:`, err.message);
          break;
        }
      }
    }

    return { seriesAdded, episodesAdded };
  }

  /**
   * Crawl the /recent/ page for the newest releases
   */
  async scrapeRecent(limit = 40): Promise<{ newMovies: number; newEpisodes: number }> {
    let newMovies = 0;
    let newEpisodes = 0;

    try {
      const html = await this.fetchHtml(`${this.BASE_URL}/recent/`);
      const items = [...html.matchAll(/<div class="Small--Box[^"]*">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];

      const selected = items.slice(0, limit);
      for (const item of selected) {
        const itemUrl = item[1];
        const titleMatch = item[2].match(/<h3 class="title">([^<]+)<\/h3>/i);
        const title = titleMatch ? titleMatch[1].trim() : '';
        if (!title) continue;

        const posterMatch = item[2].match(/data-src="([^"]+)"/i) || item[2].match(/src="([^"]+)"/i);
        const defaultPoster = posterMatch ? posterMatch[1] : undefined;

        const isEpisode = title.includes('الحلقة') || itemUrl.includes('الحلقة');

        if (isEpisode) {
          let seriesTitle = title
            .replace(/الموسم\s+[^]+$/i, '')
            .replace(/الحلقة\s+[^]+$/i, '')
            .trim();
          if (!seriesTitle.startsWith('مسلسل')) {
            seriesTitle = `مسلسل ${seriesTitle}`;
          }

          const seasonMatch = title.match(/الموسم\s+([^\s]+)/i);
          const seasonNum = seasonMatch ? this.parseArabicOrdinal(seasonMatch[1]) : 1;

          const epNumMatch = title.match(/الحلقة\s*(\d+)/i);
          const episodeNum = epNumMatch ? parseInt(epNumMatch[1], 10) : 1;

          const watchUrl = itemUrl.replace(/\/$/, '') + '/watch/';
          const details = await this.extractWatchDetails(watchUrl);

          // STRICT: NEVER save website URL!
          if (!isValidStreamEmbed(details.streamUrl)) continue;

          const series = await vodRepository.upsertSeries({
            title: seriesTitle,
            normalizedTitle: this.normalizeTitle(seriesTitle),
            category: 'أحدث المسلسلات والحلقات',
            posterUrl: defaultPoster,
            description: `مسلسل ${seriesTitle} متجدد الحلقات تلقائياً.`,
            totalSeasons: seasonNum,
          });

          await vodRepository.upsertEpisode({
            seriesId: series.id,
            seasonNum,
            episodeNum,
            title: `الموسم ${seasonNum} - الحلقة ${episodeNum}`,
            posterUrl: details.posterUrl || defaultPoster,
            description: details.description || `${seriesTitle} - الموسم ${seasonNum} الحلقة ${episodeNum}`,
            streamUrl: details.streamUrl!,
            containerExtension: 'html',
          });

          newEpisodes++;
        } else {
          const yearMatch = title.match(/\b(19\d{2}|20\d{2})\b/);
          const releaseYear = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();

          const watchUrl = itemUrl.replace(/\/$/, '') + '/watch/';
          const details = await this.extractWatchDetails(watchUrl);

          // STRICT: NEVER save website URL!
          if (!isValidStreamEmbed(details.streamUrl)) continue;

          await vodRepository.upsertMovie({
            title,
            normalizedTitle: this.normalizeTitle(title),
            category: 'أحدث الأفلام المضافة',
            posterUrl: details.posterUrl || defaultPoster,
            description: details.description || `مشاهدة وتحميل ${title} بجودة عالية.`,
            releaseYear,
            rating: details.rating || 7.5,
            streamUrl: details.streamUrl!,
            containerExtension: 'html',
          });

          newMovies++;
        }
      }
    } catch (err: any) {
      console.error('Error in scrapeRecent:', err.message);
    }

    return { newMovies, newEpisodes };
  }

  /**
   * Complete topcinema synchronization (with full unlimited deep crawl support)
   */
  async syncTopCinema(options: { deep?: boolean; unlimited?: boolean; maxMoviePages?: number; maxSeries?: number; recentLimit?: number } = {}): Promise<TopCinemaSyncReport> {
    if (this.isSyncing) {
      const stats = await vodRepository.getStats();
      return {
        moviesAdded: 0,
        seriesAdded: 0,
        episodesAdded: 0,
        totalMovies: stats.totalMovies,
        totalSeries: stats.totalSeries,
        newEpisodes: stats.totalEpisodes,
        durationMs: 0,
      };
    }

    this.isSyncing = true;
    const startTime = Date.now();

    const maxMoviePages = options.unlimited ? 0 : (options.maxMoviePages || (options.deep ? 25 : 8));
    const maxSeries = options.unlimited ? 0 : (options.maxSeries || (options.deep ? 60 : 25));
    const recentLimit = options.recentLimit || (options.deep ? 80 : 40);

    try {
      console.log(`--- Starting TopCinema VOD Sync (unlimited: ${!!options.unlimited}, deep: ${!!options.deep}, moviePages: ${maxMoviePages || 'ALL'}, series: ${maxSeries || 'ALL'}) ---`);

      // 1. Scrape latest additions first
      const recentStats = await this.scrapeRecent(recentLimit);
      console.log(`[TopCinema] Recent ingested: ${recentStats.newMovies} movies, ${recentStats.newEpisodes} episodes`);

      // 2. Scrape movies catalog
      const moviesAdded = await this.scrapeMovies(maxMoviePages);
      console.log(`[TopCinema] Movie catalog ingested: ${moviesAdded} movies`);

      // 3. Scrape series catalog
      const seriesStats = await this.scrapeSeries(maxSeries, options.unlimited ? 0 : (options.deep ? 6 : 2));
      console.log(`[TopCinema] Series ingested: ${seriesStats.seriesAdded} series, ${seriesStats.episodesAdded} episodes`);

      const totalStats = await vodRepository.getStats();
      const durationMs = Date.now() - startTime;

      return {
        moviesAdded: moviesAdded + recentStats.newMovies,
        seriesAdded: seriesStats.seriesAdded,
        episodesAdded: seriesStats.episodesAdded + recentStats.newEpisodes,
        totalMovies: totalStats.totalMovies,
        totalSeries: totalStats.totalSeries,
        newEpisodes: totalStats.totalEpisodes,
        durationMs,
      };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Start background auto-updater: runs every intervalMinutes
   */
  startAutoUpdater(intervalMinutes = 30): void {
    if (this.autoUpdateInterval) return;

    console.log(`[TopCinema] Auto-updater scheduled every ${intervalMinutes} minutes.`);
    this.autoUpdateInterval = setInterval(async () => {
      try {
        console.log('[TopCinema] Running scheduled background update for newest movies & episodes...');
        const result = await this.scrapeRecent(25);
        console.log(`[TopCinema] Background update finished: +${result.newMovies} movies, +${result.newEpisodes} episodes`);
      } catch (err: any) {
        console.error('[TopCinema] Background update error:', err.message);
      }
    }, intervalMinutes * 60 * 1000);
  }

  stopAutoUpdater(): void {
    if (this.autoUpdateInterval) {
      clearInterval(this.autoUpdateInterval);
      this.autoUpdateInterval = null;
    }
  }
}

export const topCinemaService = new TopCinemaService();
