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

export interface SportsSyncResult {
  totalScanned: number;
  addedCount: number;
  updatedCount: number;
  activeChannels: Array<{ name: string; url: string }>;
}

export class SnifferService {
  private readonly USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

  /**
   * Fetches the HTML or JS content of a target URL
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
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
              Referer: referer || `${parsed.protocol}//${parsed.hostname}/`,
              Connection: 'close',
            },
            timeout: 10000,
          },
          (res) => {
            // Follow redirect (301, 302, 307, 308)
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
   * Unpacks Dean Edwards eval(function(p,a,c,k,e,d)...) obfuscated code
   */
  public unpackDeanEdwards(packedCode: string): string {
    const pattern = /eval\(function\(p,a,c,k,e,[rd]\)\{.+?\.split\('\|'\)\)\)/gs;
    const matches = packedCode.match(pattern);
    if (!matches) return packedCode;

    let result = packedCode;
    for (const match of matches) {
      try {
        // Safe evaluation simulation for string replacement
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
      } catch {
        // Continue if parse fails
      }
    }
    return result;
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

      // 1. Direct Regex for .m3u8 or HLS urls
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

      // 2. Check for iframes inside the page (often the stream is nested)
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

      // 3. Check for Clappr / JWPlayer / VideoJS source configs
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

  /**
   * Verifies if an extracted stream URL responds with 200
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
            timeout: 6000,
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
   * Automated Sports Discovery Engine:
   * Scans curated live sports feeds for active beIN Sports & Arabic sports channels,
   * verifies each stream, and auto-populates/updates Aspreen TV database.
   */
  public async syncLiveSports(): Promise<SportsSyncResult> {
    // Curated high-availability public sports stream index (raw M3U / JSON feeds)
    const sportsFeeds = [
      'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_ar.m3u',
      'https://iptv-org.github.io/iptv/categories/sports.m3u',
    ];

    let allEntries: Array<{ name: string; url: string; logo?: string }> = [];

    for (const feedUrl of sportsFeeds) {
      try {
        const res = await this.fetchContent(feedUrl);
        if (res && res.body) {
          const parsed = this.parseM3u(res.body);
          allEntries.push(...parsed);
        }
      } catch {
        // Fallback to next feed
      }
    }

    // Filter sports & beIN channels
    const sportsRegex = /(bein|ssc|alkass|ad\s*sport|dubai\s*sport|on\s*time|kora|العراقية\s*الرياضية|الرياضية)/i;
    const targetChannels = allEntries.filter((item) => sportsRegex.test(item.name));

    let addedCount = 0;
    let updatedCount = 0;
    const activeChannels: Array<{ name: string; url: string }> = [];

    // Check existing channels to avoid duplicates
    const existing = await channelRepository.listChannels();
    const existingMap = new Map(existing.map((c) => [c.normalizedName, c]));

    // Check up to top 25 target sports channels
    const sample = targetChannels.slice(0, 25);

    for (const ch of sample) {
      const isAlive = await this.verifyStream(ch.url);
      if (!isAlive) continue;

      activeChannels.push({ name: ch.name, url: ch.url });
      const norm = ch.name.trim().toLowerCase();

      if (existingMap.has(norm)) {
        // Update existing channel
        const current = existingMap.get(norm)!;
        await channelRepository.updateChannel(current.id, {
          encryptedInputUrl: encrypt(ch.url),
          inputStatus: 'ONLINE',
          enabled: true,
        });
        updatedCount++;
      } else {
        // Create new channel
        await channelRepository.createChannel({
          sourceId: 'auto-sports-discovery',
          name: ch.name,
          normalizedName: norm,
          inputType: ch.url.includes('.m3u8') ? 'HLS' : 'TS_STREAM',
          inputStatus: 'ONLINE',
          transcodingStatus: 'STOPPED',
          encryptedInputUrl: encrypt(ch.url),
          groupTitle: 'Sports & Live',
          logoUrl: ch.logo,
          enabled: true,
          preset: 'COPY',
        });
        addedCount++;
      }
    }

    return {
      totalScanned: sample.length,
      addedCount,
      updatedCount,
      activeChannels,
    };
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
