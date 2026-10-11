import http from 'http';
import https from 'https';
import { URL } from 'url';
import { channelRepository } from '../repositories/channel.repository';
import { encrypt } from '../security/encryption';

export interface SniffedStreamResult {
  success: boolean;
  streamUrl?: string;
  channelName?: string;
  sourceUrl?: string;
  headers?: Record<string, string>;
  error?: string;
}

export type ChannelCategory = 'all' | 'sports' | 'iraq' | 'arabic';

export interface ScanResult {
  totalScanned: number;
  addedCount: number;
  updatedCount: number;
  byCategory: Record<string, number>;
  activeChannels: Array<{ name: string; category: string; url: string }>;
}

export class SnifferService {
  private readonly USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

  /**
   * High-availability verified direct seed channels for Iraqi & Arabic & beIN Sports
   */
  private readonly DIRECT_SEEDS: Array<{ name: string; category: string; url: string; logo?: string }> = [
    // --- قنوات رياضية عربية و beIN ---
    {
      name: 'beIN SPORTS NEWS HD',
      category: 'beIN & الرياضة',
      url: 'https://beinsports.akamaized.net/hls/live/2039234/beIN_SPORTS_NEWS/master.m3u8',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/2/26/BeIN_Sports_News_logo.png',
    },
    {
      name: 'beIN SPORTS HD (Open)',
      category: 'beIN & الرياضة',
      url: 'https://beinsports.akamaized.net/hls/live/2039233/beIN_SPORTS/master.m3u8',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/b/b9/BeIN_Sports_logo.svg',
    },
    {
      name: 'Al Kass 1 HD (الكأس 1)',
      category: 'beIN & الرياضة',
      url: 'https://alkass-live.akamaized.net/hls/live/2016335/alkass1/master.m3u8',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/4/4b/Alkass_Digital_Logo.png',
    },
    {
      name: 'Al Kass 2 HD (الكأس 2)',
      category: 'beIN & الرياضة',
      url: 'https://alkass-live.akamaized.net/hls/live/2016336/alkass2/master.m3u8',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/4/4b/Alkass_Digital_Logo.png',
    },
    {
      name: 'Abu Dhabi Sports 1 HD (أبوظبي الرياضية 1)',
      category: 'beIN & الرياضة',
      url: 'https://admdn1.cdn.mangomolo.com/adsports1/smil:adsports1.stream.smil/chunklist.m3u8',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/5/52/Abu_Dhabi_Sports_logo.png',
    },
    {
      name: 'Abu Dhabi Sports 2 HD (أبوظبي الرياضية 2)',
      category: 'beIN & الرياضة',
      url: 'https://admdn2.cdn.mangomolo.com/adsports2/smil:adsports2.stream.smil/chunklist.m3u8',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/5/52/Abu_Dhabi_Sports_logo.png',
    },
    {
      name: 'Dubai Sports 1 HD (دبي الرياضية 1)',
      category: 'beIN & الرياضة',
      url: 'https://dmitv.cdn.mangomolo.com/dubaisports/smil:dubaisports.smil/playlist.m3u8',
      logo: 'https://upload.wikimedia.org/wikipedia/en/b/b5/Dubai_Sports_Logo.png',
    },
    {
      name: 'KSA Sports 1 HD (الرياضية السعودية 1)',
      category: 'beIN & الرياضة',
      url: 'https://live-ksa-sports1.akamaized.net/hls/live/2042129/ksasports1/master.m3u8',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/a/a2/KSA_SPORTS_Logo.png',
    },
    {
      name: 'OnTime Sports 1 HD (أون تايم سبورت 1)',
      category: 'beIN & الرياضة',
      url: 'https://stream.ontimesports.com/live/ontime1/index.m3u8',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/8/87/ON_Time_Sports.png',
    },

    // --- قنوات عراقية ---
    {
      name: 'Al Iraqiya HD (العراقية الإخبارية)',
      category: 'قنوات عراقية',
      url: 'https://stream.imn.iq/live/aliraqia-news/playlist.m3u8',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/7/7b/Al_Iraqiya_logo.png',
    },
    {
      name: 'Al Iraqiya Sport (العراقية الرياضية)',
      category: 'قنوات عراقية',
      url: 'https://stream.imn.iq/live/aliraqia-sport/playlist.m3u8',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/7/7b/Al_Iraqiya_logo.png',
    },
    {
      name: 'Al Sharqiya HD (الشرقية)',
      category: 'قنوات عراقية',
      url: 'https://alsharqiya.mangomolo.com/alsharqiya/smil:alsharqiya.smil/playlist.m3u8',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/1/14/Al_Sharqiya_Logo.png',
    },
    {
      name: 'Al Sharqiya News (الشرقية نيوز)',
      category: 'قنوات عراقية',
      url: 'https://alsharqiya.mangomolo.com/alsharqiyanews/smil:alsharqiyanews.smil/playlist.m3u8',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/1/14/Al_Sharqiya_Logo.png',
    },
    {
      name: 'Al Sumaria HD (السومرية)',
      category: 'قنوات عراقية',
      url: 'https://alsumaria.mangomolo.com/alsumaria/smil:alsumaria.smil/playlist.m3u8',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/e/ec/Alsumaria_TV_logo.png',
    },
    {
      name: 'UTV Iraq HD (يو تي في العراق)',
      category: 'قنوات عراقية',
      url: 'https://utv.mangomolo.com/utv/smil:utv.smil/playlist.m3u8',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/2/23/Utv_iraq_logo.png',
    },
    {
      name: 'Dijlah TV (دجلة الفضائية)',
      category: 'قنوات عراقية',
      url: 'https://dijlah.mangomolo.com/dijlah/smil:dijlah.smil/playlist.m3u8',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/9/91/Dijlah_TV_logo.png',
    },
    {
      name: 'Al Rabiaa TV (الرابعة العراقية)',
      category: 'قنوات عراقية',
      url: 'https://alrabiaa.mangomolo.com/alrabiaa/smil:alrabiaa.smil/playlist.m3u8',
      logo: 'https://alrabiaa.tv/assets/images/logo.png',
    },
    {
      name: 'Al Fallujah TV (الفلوجة)',
      category: 'قنوات عراقية',
      url: 'https://alfallujah.mangomolo.com/alfallujah/smil:alfallujah.smil/playlist.m3u8',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/4/4e/Al_Fallujah_TV_Logo.png',
    },

    // --- قنوات عربية وإخبارية عامة ---
    {
      name: 'Al Jazeera HD (الجزيرة)',
      category: 'قنوات الأخبار',
      url: 'https://live-hls-web-aje.getaj.net/AJE/03.m3u8',
      logo: 'https://upload.wikimedia.org/wikipedia/en/7/7a/Al_Jazeera_Channel_Logo.svg',
    },
    {
      name: 'Al Arabiya HD (العربية)',
      category: 'قنوات الأخبار',
      url: 'https://live.alarabiya.net/alarabiapublish/alarabiya.smil/playlist.m3u8',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/6/62/Al_Arabiya_Logo.png',
    },
    {
      name: 'Al Hadath HD (الحدث)',
      category: 'قنوات الأخبار',
      url: 'https://live.alarabiya.net/alarabiapublish/alhadath.smil/playlist.m3u8',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/2/2c/Al_Hadath_Logo.png',
    },
    {
      name: 'BBC Arabic HD (بي بي سي عربي)',
      category: 'قنوات الأخبار',
      url: 'https://bbclive.akamaized.net/hls/live/2034335/bbcarabic/master.m3u8',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/a/ae/BBC_Arabic_Television_logo.png',
    },
    {
      name: 'Sky News Arabia HD (سكاي نيوز عربية)',
      category: 'قنوات الأخبار',
      url: 'https://stream.skynewsarabia.com/hls/sna.m3u8',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/0/07/Sky_News_Arabia_logo.png',
    },
    {
      name: 'Dubai TV HD (تلفزيون دبي)',
      category: 'قنوات عربية ومنوعة',
      url: 'https://dmitv.cdn.mangomolo.com/dubaitv/smil:dubaitv.smil/playlist.m3u8',
      logo: 'https://upload.wikimedia.org/wikipedia/en/9/90/Dubai_TV_logo.png',
    },
    {
      name: 'Abu Dhabi TV HD (أبوظبي)',
      category: 'قنوات عربية ومنوعة',
      url: 'https://admdn3.cdn.mangomolo.com/adtv/smil:adtv.stream.smil/chunklist.m3u8',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/4/4e/Abu_Dhabi_TV_logo.png',
    },
    {
      name: 'Kuwait TV 1 (تلفزيون الكويت)',
      category: 'قنوات عربية ومنوعة',
      url: 'https://media.ktv.gov.kw/live/ktv1/index.m3u8',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/1/1a/Kuwait_Television_Logo.png',
    },
  ];

  /**
   * Fetches content from a URL with browser emulation
   */
  public async fetchContent(targetUrl: string, referer?: string): Promise<{ body: string; finalUrl: string } | null> {
    return new Promise((resolve) => {
      try {
        const parsed = new URL(targetUrl);
        const isHttps = parsed.protocol === 'https:';
        const lib = isHttps ? https : http;

        const req = lib.request(
          {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'GET',
            headers: {
              'User-Agent': this.USER_AGENT,
              Accept: '*/*',
              'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
              Referer: referer || `${parsed.protocol}//${parsed.hostname}/`,
              Connection: 'close',
            },
            timeout: 8000,
          },
          (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              const redirectUrl = new URL(res.headers.location, targetUrl).toString();
              res.destroy();
              return this.fetchContent(redirectUrl, targetUrl).then(resolve);
            }

            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => resolve({ body: data, finalUrl: targetUrl }));
          }
        );

        req.on('timeout', () => {
          req.destroy();
          resolve(null);
        });
        req.on('error', () => resolve(null));
        req.end();
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * Super Scanner:
   * Scans Iraqi, Arabic, and beIN Sports channels across multiple high-speed feeds concurrently.
   */
  public async superScan(category: ChannelCategory = 'all', maxPerCategory = 50): Promise<ScanResult> {
    const feedsToScan: string[] = [];

    if (category === 'all' || category === 'iraq') {
      feedsToScan.push('https://iptv-org.github.io/iptv/countries/iq.m3u');
    }
    if (category === 'all' || category === 'sports') {
      feedsToScan.push(
        'https://iptv-org.github.io/iptv/categories/sports.m3u',
        'https://iptv-org.github.io/iptv/countries/qa.m3u',
        'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_ar.m3u'
      );
    }
    if (category === 'all' || category === 'arabic') {
      feedsToScan.push(
        'https://iptv-org.github.io/iptv/languages/ara.m3u',
        'https://iptv-org.github.io/iptv/countries/sa.m3u',
        'https://iptv-org.github.io/iptv/countries/ae.m3u',
        'https://iptv-org.github.io/iptv/countries/eg.m3u'
      );
    }

    // 1. Collect candidates
    let rawCandidates: Array<{ name: string; url: string; logo?: string; category: string }> = [];

    // Add direct high-availability seeds first
    for (const seed of this.DIRECT_SEEDS) {
      if (category === 'all' || this.matchesCategory(seed.category, category)) {
        rawCandidates.push(seed);
      }
    }

    // Fetch remote M3U feeds in parallel
    const feedResults = await Promise.allSettled(feedsToScan.map((url) => this.fetchContent(url)));
    for (const res of feedResults) {
      if (res.status === 'fulfilled' && res.value && res.value.body) {
        const parsed = this.parseM3u(res.value.body);
        for (const item of parsed) {
          const cat = this.detectCategory(item.name);
          if (category === 'all' || this.matchesCategory(cat, category)) {
            rawCandidates.push({
              name: this.cleanChannelName(item.name),
              url: item.url,
              logo: item.logo,
              category: cat,
            });
          }
        }
      }
    }

    // Deduplicate by normalized channel name
    const uniqueMap = new Map<string, { name: string; url: string; logo?: string; category: string }>();
    for (const item of rawCandidates) {
      const key = item.name.trim().toLowerCase();
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, item);
      }
    }

    const uniqueCandidates = Array.from(uniqueMap.values()).slice(0, maxPerCategory * 3);

    // 2. High-concurrency stream verification (12 concurrent probes)
    const activeChannels: Array<{ name: string; category: string; url: string }> = [];
    const existing = await channelRepository.listChannels();
    const existingMap = new Map(existing.map((c) => [c.normalizedName, c]));

    const byCategory: Record<string, number> = {};
    let addedCount = 0;
    let updatedCount = 0;

    await this.pMap(
      uniqueCandidates,
      async (candidate) => {
        const isAlive = await this.verifyStream(candidate.url);
        if (!isAlive) return;

        activeChannels.push({
          name: candidate.name,
          category: candidate.category,
          url: candidate.url,
        });

        byCategory[candidate.category] = (byCategory[candidate.category] || 0) + 1;
        const norm = candidate.name.trim().toLowerCase();

        if (existingMap.has(norm)) {
          const current = existingMap.get(norm)!;
          await channelRepository.updateChannel(current.id, {
            encryptedInputUrl: encrypt(candidate.url),
            inputStatus: 'ONLINE',
            groupTitle: candidate.category,
            logoUrl: candidate.logo || current.logoUrl,
            enabled: true,
          });
          updatedCount++;
        } else {
          await channelRepository.createChannel({
            sourceId: 'super-scanner',
            name: candidate.name,
            normalizedName: norm,
            inputType: candidate.url.includes('.m3u8') ? 'HLS' : 'TS_STREAM',
            inputStatus: 'ONLINE',
            transcodingStatus: 'STOPPED',
            encryptedInputUrl: encrypt(candidate.url),
            groupTitle: candidate.category,
            logoUrl: candidate.logo,
            enabled: true,
            preset: 'COPY',
          });
          addedCount++;
        }
      },
      12
    );

    return {
      totalScanned: uniqueCandidates.length,
      addedCount,
      updatedCount,
      byCategory,
      activeChannels,
    };
  }

  /**
   * Backward compatible wrapper for sports sync
   */
  public async syncLiveSports(): Promise<ScanResult> {
    return this.superScan('sports', 30);
  }

  /**
   * Helper to verify if an HTTP/HTTPS stream returns 200/300
   */
  public async verifyStream(streamUrl: string, referer?: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const parsed = new URL(streamUrl);
        const isHttps = parsed.protocol === 'https:';
        const lib = isHttps ? https : http;

        const req = lib.request(
          {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'GET',
            headers: {
              'User-Agent': this.USER_AGENT,
              Referer: referer || `${parsed.protocol}//${parsed.hostname}/`,
              Connection: 'close',
            },
            timeout: 3500,
          },
          (res) => {
            const status = res.statusCode || 0;
            res.destroy();
            resolve(status >= 200 && status < 400);
          }
        );

        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });
        req.on('error', () => resolve(false));
        req.end();
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Sniffs and extracts .m3u8 stream links from a webpage URL or embedded iframe
   */
  public async sniffWebpage(pageUrl: string): Promise<SniffedStreamResult> {
    try {
      const response = await this.fetchContent(pageUrl);
      if (!response || !response.body) {
        return { success: false, error: 'تعذر فتح الصفحة، قد تكون محمية بـ Cloudflare أو السيرفر محجوب.' };
      }

      let content = response.body;
      content += '\n' + this.unpackDeanEdwards(content);

      const directM3u8Regex = /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i;
      const directMatch = content.match(directM3u8Regex);

      if (directMatch && directMatch[1]) {
        const streamUrl = directMatch[1].replace(/\\/g, '');
        const isAlive = await this.verifyStream(streamUrl, pageUrl);
        if (isAlive) {
          return {
            success: true,
            streamUrl,
            sourceUrl: pageUrl,
            headers: { Referer: pageUrl, 'User-Agent': this.USER_AGENT },
          };
        }
      }

      const iframeRegex = /<iframe[^>]+src=["']([^"']+)["']/gi;
      let iframeMatch;
      while ((iframeMatch = iframeRegex.exec(content)) !== null) {
        const rawIframeSrc = iframeMatch[1];
        if (!rawIframeSrc || rawIframeSrc.startsWith('javascript:')) continue;

        const iframeUrl = new URL(rawIframeSrc, pageUrl).toString();
        const iframeResp = await this.fetchContent(iframeUrl, pageUrl);
        if (iframeResp && iframeResp.body) {
          const iframeContent = iframeResp.body + '\n' + this.unpackDeanEdwards(iframeResp.body);
          const m3u8Match = iframeContent.match(directM3u8Regex);
          if (m3u8Match && m3u8Match[1]) {
            const streamUrl = m3u8Match[1].replace(/\\/g, '');
            const isAlive = await this.verifyStream(streamUrl, iframeUrl);
            if (isAlive) {
              return {
                success: true,
                streamUrl,
                sourceUrl: iframeUrl,
                headers: { Referer: iframeUrl, 'User-Agent': this.USER_AGENT },
              };
            }
          }
        }
      }

      const playerSourceRegex = /(?:source|file|src)\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i;
      const playerMatch = content.match(playerSourceRegex);
      if (playerMatch && playerMatch[1]) {
        let streamUrl = playerMatch[1].replace(/\\/g, '');
        if (streamUrl.startsWith('//')) streamUrl = 'https:' + streamUrl;
        else if (streamUrl.startsWith('/')) streamUrl = new URL(streamUrl, pageUrl).toString();

        return {
          success: true,
          streamUrl,
          sourceUrl: pageUrl,
          headers: { Referer: pageUrl, 'User-Agent': this.USER_AGENT },
        };
      }

      return {
        success: false,
        error: 'لم يتم العثور على رابط بث m3u8 مباشر في هذه الصفحة.',
      };
    } catch (err: any) {
      return {
        success: false,
        error: `خطأ أثناء فحص الصفحة: ${err.message}`,
      };
    }
  }

  public unpackDeanEdwards(packedCode: string): string {
    const pattern = /eval\(function\(p,a,c,k,e,[rd]\)\{.+?\.split\('\|'\)\)\)/gs;
    const matches = packedCode.match(pattern);
    if (!matches) return packedCode;

    let result = packedCode;
    for (const match of matches) {
      try {
        const argsMatch = match.match(/return p\}\('(.*)',(\d+),(\d+),'(.*)'\.split\('\|'\)/s);
        if (argsMatch) {
          let p = argsMatch[1];
          const a = parseInt(argsMatch[2], 10);
          const c = parseInt(argsMatch[3], 10);
          const k = argsMatch[4].split('|');

          const baseN = (n: number, rad: number): string => {
            return (n < rad ? '' : baseN(Math.floor(n / rad), rad)) + ((n = n % rad) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
          };

          for (let i = c - 1; i >= 0; i--) {
            if (k[i]) {
              const key = baseN(i, a);
              const reg = new RegExp('\\b' + key + '\\b', 'g');
              p = p.replace(reg, k[i]);
            }
          }
          result += '\n' + p;
        }
      } catch {}
    }
    return result;
  }

  private cleanChannelName(raw: string): string {
    return raw
      .replace(/\s*\(\d+p\)/gi, '')
      .replace(/\s*\[.*?\]/g, '')
      .replace(/[\r\n]+/g, '')
      .trim();
  }

  private detectCategory(name: string): string {
    const sportsRegex = /(bein|ssc|alkass|sport|كأس|رياض|on time|kora|دوري)/i;
    const iraqRegex = /(iraq|العراق|sharqiya|sumaria|dijlah|rabiaa|rasheed|afaq|utv|zagros|rudaw|شرقية|سومرية|دجلة|رابعة|فلوجة)/i;
    const newsRegex = /(jazeera|arabiya|hadath|news|أخبار|إخبارية|حدث|bbc arabic|sky news)/i;
    const islamicRegex = /(quran|قرآن|اسلام|sunnah|karbala|imama|jawadain|naeem)/i;

    if (sportsRegex.test(name)) return 'beIN & الرياضة';
    if (iraqRegex.test(name)) return 'قنوات عراقية';
    if (newsRegex.test(name)) return 'قنوات الأخبار';
    if (islamicRegex.test(name)) return 'قنوات إسلامية';
    return 'قنوات عربية ومنوعة';
  }

  private matchesCategory(actualCategory: string, requested: ChannelCategory): boolean {
    if (requested === 'all') return true;
    if (requested === 'sports') return actualCategory.includes('الرياضة') || actualCategory.includes('beIN');
    if (requested === 'iraq') return actualCategory.includes('عراق');
    if (requested === 'arabic') return !actualCategory.includes('الرياضة');
    return true;
  }

  /**
   * Concurrency mapper to run up to N async tasks at once
   */
  private async pMap<T, R>(items: T[], mapper: (item: T) => Promise<R>, concurrency = 10): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let index = 0;
    const workers = new Array(concurrency).fill(0).map(async () => {
      while (index < items.length) {
        const i = index++;
        try {
          results[i] = await mapper(items[i]);
        } catch {
          results[i] = null as any;
        }
      }
    });
    await Promise.all(workers);
    return results;
  }

  private parseM3u(content: string): Array<{ name: string; url: string; logo?: string }> {
    const lines = content.split('\n');
    const result: Array<{ name: string; url: string; logo?: string }> = [];

    let currentName = '';
    let currentLogo: string | undefined;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXTINF:')) {
        const logoMatch = line.match(/tvg-logo=["']([^"']+)["']/i);
        if (logoMatch) currentLogo = logoMatch[1];

        const commaIdx = line.lastIndexOf(',');
        if (commaIdx !== -1) {
          currentName = line.slice(commaIdx + 1).trim();
        }
      } else if (line && !line.startsWith('#') && /^https?:\/\//i.test(line)) {
        if (currentName) {
          result.push({
            name: currentName,
            url: line,
            logo: currentLogo,
          });
        }
        currentName = '';
        currentLogo = undefined;
      }
    }

    return result;
  }
}

export const snifferService = new SnifferService();
