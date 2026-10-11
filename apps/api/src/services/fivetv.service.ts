import https from 'https';
import http from 'http';
import dns from 'dns';
import { vodRepository, Movie, Series, Episode } from '../repositories/vod.repository';

// Set resilient DNS for resolving domains like 5tv.lol
try {
  dns.setServers(['1.1.1.1', '8.8.8.8', '1.0.0.1']);
} catch {
  // Ignore in environments where setServers is restricted
}

export interface FiveTvSyncReport {
  moviesAdded: number;
  seriesAdded: number;
  episodesAdded: number;
  totalMovies: number;
  totalSeries: number;
  newEpisodes: number;
  durationMs: number;
}

export function isValidStreamEmbed(url: string | null | undefined): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (
    lower.includes('topcinema.io') ||
    lower.includes('5tv.lol') ||
    lower.includes('new61.5tv') ||
    lower.includes('wp-json') ||
    lower.includes('wp-content') ||
    lower.includes('/episode/') ||
    lower.includes('/series/') ||
    lower.includes('/movie/')
  ) {
    return false;
  }
  return (
    lower.includes('71stream.one') ||
    lower.includes('ok.ru') ||
    lower.includes('streamwish') ||
    lower.includes('streamtape') ||
    lower.includes('upstream') ||
    lower.includes('updown') ||
    lower.includes('ult4vid') ||
    lower.includes('vidmoly') ||
    lower.includes('morencius') ||
    lower.includes('.m3u8') ||
    lower.includes('.mp4') ||
    lower.includes('/embed') ||
    lower.includes('videoembed')
  );
}

export class FiveTvService {
  private readonly BASE_URL = 'https://new61.5tv.lol';
  private readonly USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  private autoUpdateInterval: NodeJS.Timeout | null = null;
  private isSyncing = false;
  private isDeepSyncing = false;

  /**
   * Resilient HTTP GET request with redirect following
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
          'Accept-Language': 'ar,en-US;q=0.8,en;q=0.7',
          'Referer': this.BASE_URL + '/',
          'Cookie': 'ftv_vip_checked=1',
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
   * Title normalization for zero duplicates across all providers
   */
  public normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/^(فيلم|مسلسل|انمي)\s+/i, '')
      .replace(/(مترجم|مدبلج|كامل|اون لاين|اونلاين|بجودة|hd|web-dl|bluray)/gi, '')
      .replace(/[^\w\u0600-\u06FF]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .trim();
  }

  /**
   * Extract working stream and metadata from a 5tv page
   */
  public async extractWatchDetails(pageUrl: string): Promise<{
    title: string | null;
    streamUrl: string | null;
    posterUrl: string | null;
    description: string | null;
    rating: number | null;
  }> {
    try {
      const html = await this.fetchHtml(pageUrl);
      const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      const posterMatch = html.match(/<meta property="og:image" content="([^"]+)"/i);
      const descMatch = html.match(/<meta property="og:description" content="([^"]+)"/i)
        || html.match(/<div class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      const ratingMatch = html.match(/class="[^"]*rating[^"]*"[^>]*>([\d.]+)/i);

      let cleanDesc: string | null = null;
      if (descMatch) {
        cleanDesc = descMatch[1].replace(/<[^>]+>/g, '').trim();
      }

      // Priority 1: Primary iframe
      const iframeMatches = [...html.matchAll(/<iframe[^>]+src="([^"]+)"/gi)].map(m => m[1]);
      let chosenStream: string | null = null;

      for (const ifr of iframeMatches) {
        if (isValidStreamEmbed(ifr)) {
          chosenStream = ifr;
          break;
        }
      }

      // Priority 2: Alternative embed servers in HTML (71stream, ult4vid, morencius, vidmoly)
      if (!chosenStream) {
        const embedCandidates = [...html.matchAll(/https?:\/\/[^\s"'<>]*(?:71stream|ult4vid|morencius|vidmoly)[^\s"'<>]*/gi)].map(m => m[0]);
        for (const candidate of embedCandidates) {
          if (isValidStreamEmbed(candidate)) {
            chosenStream = candidate;
            break;
          }
        }
      }

      // Automatically resolve 71stream.one into direct high-speed MP4 link
      if (chosenStream && chosenStream.includes('71stream.one')) {
        try {
          const resolved = await this.resolve71Stream(chosenStream);
          if (resolved.directUrl) {
            chosenStream = resolved.directUrl;
          }
        } catch {}
      }

      return {
        title: titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : null,
        streamUrl: chosenStream,
        posterUrl: posterMatch ? posterMatch[1] : null,
        description: cleanDesc,
        rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
      };
    } catch {
      return { title: null, streamUrl: null, posterUrl: null, description: null, rating: null };
    }
  }

  /**
   * Resolve a 71stream embed URL directly to the underlying MP4 media link
   */
  public async resolve71Stream(embedUrl: string): Promise<{ directUrl: string | null; title?: string }> {
    try {
      const html = await this.fetchHtml(embedUrl);
      const dataPageMatch = html.match(/data-page="([^"]+)"/i);
      if (dataPageMatch) {
        const decoded = JSON.parse(dataPageMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
        if (decoded?.props?.url) {
          return {
            directUrl: decoded.props.url,
            title: decoded.props.title,
          };
        }
      }
      return { directUrl: null };
    } catch {
      return { directUrl: null };
    }
  }

  /**
   * Crawl movies from FiveTV catalog (full pagination support from page 1 to end)
   */
  async scrapeMovies(maxPages = 0): Promise<number> {
    let totalAdded = 0;
    let page = 1;

    while (true) {
      if (maxPages > 0 && page > maxPages) break;
      const pageUrl = page === 1 ? `${this.BASE_URL}/latest-movies/` : `${this.BASE_URL}/latest-movies/page/${page}/`;

      try {
        const html = await this.fetchHtml(pageUrl);
        const movieLinks = [...new Set([...html.matchAll(/href="([^"]*\/movie\/[^"]*)"/gi)].map(m => m[1]))];

        if (movieLinks.length === 0) {
          // End of catalog reached
          break;
        }

        // Process in chunks of 5
        const chunkSize = 5;
        for (let i = 0; i < movieLinks.length; i += chunkSize) {
          const chunk = movieLinks.slice(i, i + chunkSize);
          await Promise.all(chunk.map(async (mUrl) => {
            try {
              const details = await this.extractWatchDetails(mUrl);
              const rawTitle = details.title || '';
              if (!rawTitle) return;

              // STRICT CHECK: Must be a pure stream embed! NEVER save website URL!
              if (!isValidStreamEmbed(details.streamUrl)) {
                return;
              }

              const yearMatch = rawTitle.match(/\b(19\d{2}|20\d{2})\b/);
              const releaseYear = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();

              await vodRepository.upsertMovie({
                title: rawTitle,
                normalizedTitle: this.normalizeTitle(rawTitle),
                category: 'أفلام فايف تي في FiveTV',
                posterUrl: details.posterUrl || undefined,
                description: details.description || `مشاهدة وتحميل ${rawTitle} أون لاين على أسبيرين TV.`,
                releaseYear,
                rating: details.rating || 8.0,
                streamUrl: details.streamUrl!,
                containerExtension: 'html',
              });

              totalAdded++;
            } catch (err: any) {
              console.error(`Error processing 5tv movie ${mUrl}:`, err.message);
            }
          }));
        }

        page++;
      } catch (err: any) {
        console.error(`Error scraping 5tv movies page ${page}:`, err.message);
        break;
      }
    }

    return totalAdded;
  }

  /**
   * Crawl TV Series and all their ordered seasons & episodes from FiveTV
   * Extracts pure embed streams for each episode (no website links!)
   */
  async scrapeSeries(maxPages = 0, maxSeries = 0): Promise<{ seriesAdded: number; episodesAdded: number }> {
    let seriesAdded = 0;
    let episodesAdded = 0;
    let page = 1;

    while (true) {
      if (maxPages > 0 && page > maxPages) break;
      if (maxSeries > 0 && seriesAdded >= maxSeries) break;

      const pageUrl = page === 1 ? `${this.BASE_URL}/latest-series/` : `${this.BASE_URL}/latest-series/page/${page}/`;

      try {
        const html = await this.fetchHtml(pageUrl);
        const seriesLinks = [...new Set([...html.matchAll(/href="([^"]*\/series\/[^"]*)"/gi)].map(m => m[1]))];

        if (seriesLinks.length === 0) break;

        for (const sUrl of seriesLinks) {
          if (maxSeries > 0 && seriesAdded >= maxSeries) break;

          try {
            const sHtml = await this.fetchHtml(sUrl);
            const titleMatch = sHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
            const rawTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
            if (!rawTitle) continue;

            const posterMatch = sHtml.match(/<meta property="og:image" content="([^"]+)"/i);
            const descMatch = sHtml.match(/<meta property="og:description" content="([^"]+)"/i);
            const yearMatch = rawTitle.match(/\b(19\d{2}|20\d{2})\b/);
            const releaseYear = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();

            // Extract episode links
            const epMatches = [...sHtml.matchAll(/<a[^>]*href="([^"]*\/episode\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)];
            const seenEpUrls = new Set<string>();
            const epList: Array<{ epUrl: string; seasonNum: number; episodeNum: number; epTitle: string }> = [];

            for (const epM of epMatches) {
              const epUrl = epM[1];
              if (seenEpUrls.has(epUrl)) continue;
              seenEpUrls.add(epUrl);

              const text = epM[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

              let seasonNum = 1;
              let episodeNum = 1;

              const sxMatch = epUrl.match(/(\d+)x(\d+)/i) || text.match(/(\d+)x(\d+)/i);
              const seMatch = epUrl.match(/s(\d+)e(\d+)/i) || text.match(/s(\d+)e(\d+)/i);

              if (sxMatch) {
                seasonNum = parseInt(sxMatch[1], 10);
                episodeNum = parseInt(sxMatch[2], 10);
              } else if (seMatch) {
                seasonNum = parseInt(seMatch[1], 10);
                episodeNum = parseInt(seMatch[2], 10);
              } else {
                const seasonTextMatch = text.match(/الموسم\s*(\d+)/i) || epUrl.match(/season-(\d+)/i);
                if (seasonTextMatch) seasonNum = parseInt(seasonTextMatch[1], 10);

                const epTextMatch = text.match(/الحلقة\s*(\d+)/i) || epUrl.match(/episode-(\d+)/i) || epUrl.match(/-(\d+)\/?$/);
                if (epTextMatch) episodeNum = parseInt(epTextMatch[1], 10);
              }

              epList.push({
                epUrl,
                seasonNum,
                episodeNum,
                epTitle: `الموسم ${seasonNum} - الحلقة ${episodeNum}`,
              });
            }

            const maxSeason = epList.reduce((max, ep) => Math.max(max, ep.seasonNum), 1);

            // Upsert series
            const series = await vodRepository.upsertSeries({
              title: rawTitle,
              normalizedTitle: this.normalizeTitle(rawTitle),
              category: 'مسلسلات فايف تي في FiveTV',
              posterUrl: posterMatch ? posterMatch[1] : undefined,
              description: descMatch ? descMatch[1] : `مسلسل ${rawTitle} كامل المواسم والحلقات على أسبيرين TV.`,
              releaseYear,
              rating: 8.5,
              totalSeasons: maxSeason,
            });

            seriesAdded++;

            // Extract pure stream for each episode in chunks of 5
            const epChunkSize = 5;
            for (let i = 0; i < epList.length; i += epChunkSize) {
              const chunk = epList.slice(i, i + epChunkSize);
              await Promise.all(chunk.map(async (ep) => {
                try {
                  const epDetails = await this.extractWatchDetails(ep.epUrl);
                  // STRICT: NEVER save ep.epUrl! Only save pure stream embed!
                  if (!isValidStreamEmbed(epDetails.streamUrl)) {
                    return;
                  }

                  await vodRepository.upsertEpisode({
                    seriesId: series.id,
                    seasonNum: ep.seasonNum,
                    episodeNum: ep.episodeNum,
                    title: ep.epTitle,
                    posterUrl: epDetails.posterUrl || posterMatch?.[1] || series.posterUrl,
                    description: epDetails.description || `${rawTitle} - ${ep.epTitle}`,
                    streamUrl: epDetails.streamUrl!,
                    containerExtension: 'html',
                  });

                  episodesAdded++;
                } catch (err: any) {
                  console.error(`Error extracting stream for 5tv episode ${ep.epUrl}:`, err.message);
                }
              }));
            }
          } catch (err: any) {
            console.error(`Error processing 5tv series ${sUrl}:`, err.message);
          }
        }

        page++;
      } catch (err: any) {
        console.error(`Error scraping 5tv series page ${page}:`, err.message);
        break;
      }
    }

    return { seriesAdded, episodesAdded };
  }

  /**
   * Crawl latest additions for immediate updates
   */
  async scrapeRecent(limit = 40): Promise<{ newEpisodes: number; newMovies: number }> {
    let newEpisodes = 0;
    let newMovies = 0;

    try {
      const epHtml = await this.fetchHtml(`${this.BASE_URL}/latest-episodes/`);
      const epLinks = [...new Set([...epHtml.matchAll(/href="([^"]*\/episode\/[^"]*)"/gi)].map(m => m[1]))].slice(0, limit);

      const chunkSize = 4;
      for (let i = 0; i < epLinks.length; i += chunkSize) {
        const chunk = epLinks.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async (epUrl) => {
          try {
            const epDetails = await this.extractWatchDetails(epUrl);
            const rawTitle = epDetails.title || '';
            if (!rawTitle || !isValidStreamEmbed(epDetails.streamUrl)) return;

            let seriesTitle = rawTitle.replace(/—\s*الحلقة.*$/i, '').replace(/الموسم.*$/i, '').trim();
            if (!seriesTitle) seriesTitle = rawTitle;

            let seasonNum = 1;
            let episodeNum = 1;

            const sxMatch = epUrl.match(/(\d+)x(\d+)/i) || rawTitle.match(/(\d+)x(\d+)/i);
            if (sxMatch) {
              seasonNum = parseInt(sxMatch[1], 10);
              episodeNum = parseInt(sxMatch[2], 10);
            } else {
              const sMatch = rawTitle.match(/الموسم\s*(\d+)/i);
              if (sMatch) seasonNum = parseInt(sMatch[1], 10);
              const eMatch = rawTitle.match(/الحلقة\s*(\d+)/i) || epUrl.match(/-(\d+)\/?$/);
              if (eMatch) episodeNum = parseInt(eMatch[1], 10);
            }

            const series = await vodRepository.upsertSeries({
              title: seriesTitle,
              normalizedTitle: this.normalizeTitle(seriesTitle),
              category: 'أحدث حلقات فايف تي في FiveTV',
              posterUrl: epDetails.posterUrl || undefined,
              description: `مسلسل ${seriesTitle} متجدد على أسبيرين TV.`,
              totalSeasons: seasonNum,
            });

            await vodRepository.upsertEpisode({
              seriesId: series.id,
              seasonNum,
              episodeNum,
              title: `الموسم ${seasonNum} - الحلقة ${episodeNum}`,
              posterUrl: epDetails.posterUrl || series.posterUrl,
              description: epDetails.description || `${seriesTitle} - الحلقة ${episodeNum}`,
              streamUrl: epDetails.streamUrl!,
              containerExtension: 'html',
            });

            newEpisodes++;
          } catch (err: any) {
            console.error(`Error scraping recent 5tv episode ${epUrl}:`, err.message);
          }
        }));
      }
    } catch (err: any) {
      console.error('Error in 5tv scrapeRecent:', err.message);
    }

    return { newEpisodes, newMovies };
  }

  /**
   * Complete FiveTV synchronization (with full unlimited deep crawl support)
   */
  async syncFiveTv(options: { deep?: boolean; unlimited?: boolean; maxMoviePages?: number; maxSeriesPages?: number; recentLimit?: number } = {}): Promise<FiveTvSyncReport> {
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

    // If unlimited is set, maxPages = 0 (crawls all pages until catalog ends)
    const maxMoviePages = options.unlimited ? 0 : (options.maxMoviePages || (options.deep ? 25 : 8));
    const maxSeriesPages = options.unlimited ? 0 : (options.maxSeriesPages || (options.deep ? 20 : 6));
    const recentLimit = options.recentLimit || (options.deep ? 80 : 40);

    try {
      console.log(`--- Starting FiveTV VOD Sync (unlimited: ${!!options.unlimited}, deep: ${!!options.deep}, moviePages: ${maxMoviePages || 'ALL'}, seriesPages: ${maxSeriesPages || 'ALL'}) ---`);

      // 1. Scrape latest episode updates
      const recentStats = await this.scrapeRecent(recentLimit);
      console.log(`[FiveTV] Recent ingested: ${recentStats.newEpisodes} episodes`);

      // 2. Scrape movie catalog
      const moviesAdded = await this.scrapeMovies(maxMoviePages);
      console.log(`[FiveTV] Movie catalog ingested: ${moviesAdded} movies`);

      // 3. Scrape series catalog
      const seriesStats = await this.scrapeSeries(maxSeriesPages, options.unlimited ? 0 : (options.deep ? 100 : 35));
      console.log(`[FiveTV] Series catalog ingested: ${seriesStats.seriesAdded} series, ${seriesStats.episodesAdded} episodes`);

      const totalStats = await vodRepository.getStats();
      const durationMs = Date.now() - startTime;

      return {
        moviesAdded,
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

    console.log(`[FiveTV] Auto-updater scheduled every ${intervalMinutes} minutes.`);
    this.autoUpdateInterval = setInterval(async () => {
      try {
        console.log('[FiveTV] Running scheduled background update for newest content...');
        const result = await this.scrapeRecent(25);
        console.log(`[FiveTV] Background update finished: +${result.newEpisodes} episodes`);
      } catch (err: any) {
        console.error('[FiveTV] Background update error:', err.message);
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

export const fiveTvService = new FiveTvService();
