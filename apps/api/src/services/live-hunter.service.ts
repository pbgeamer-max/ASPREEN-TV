/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║           ASPREEN-TV ▸ LIVE HUNTER SERVICE v3.0                    ║
 * ║  خارق الروابط المباشرة — قنوات تلفزيون + مباريات كرة القدم        ║
 * ║                                                                      ║
 * ║  المصادر:                                                            ║
 * ║    • alokalive.com      → قنوات تلفزيون عربية مباشرة               ║
 * ║    • aflam4you/koora    → مباريات كرة قدم مباشرة                    ║
 * ║                                                                      ║
 * ║  الميزات:                                                            ║
 * ║    ✅ فك تشفير Dean Edwards / packed JS بالكامل                     ║
 * ║    ✅ كشف M3U8 / HLS / MP4 مباشر                                    ║
 * ║    ✅ فك شفرة Jwplayer / JWPlayer setup / hls.js                    ║
 * ║    ✅ تتبع الـ iframes بعمق 3 مستويات                               ║
 * ║    ✅ التحقق الفوري من حياة الرابط (HEAD + GET)                     ║
 * ║    ✅ حفظ في قاعدة البيانات (channel_repository)                    ║
 * ║    ✅ حذف القديمات المنتهية الصلاحية تلقائياً                      ║
 * ║    ✅ 20 طلب متوازي للسرعة القصوى                                   ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';
import vm from 'vm';
import zlib from 'zlib';
import { channelRepository } from '../repositories/channel.repository';
import { encrypt } from '../security/encryption';

// ─────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────
export interface HuntedStream {
  name: string;
  streamUrl: string;
  pageUrl: string;
  category: string;
  logo?: string;
  description?: string;
  referer?: string;
  isLive: boolean;
}

export interface HuntResult {
  source: string;
  totalFound: number;
  addedCount: number;
  updatedCount: number;
  skippedCount: number;
  deletedOldCount: number;
  streams: HuntedStream[];
  errors: string[];
}

// ─────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const DEAD_HOSTS = [
  'ok.ru', 'vidmoly.to', 'vidmoly.com', 'gamescdn.online',
  'vidembed.cc', 'vembed.net', 'mixdrop.co', 'fembed.com',
  'solidfiles.com', 'openload.co', 'oload.tv',
];

// Source IDs stored in DB so we can purge old entries per-source
const SOURCE_ID_ALOKAL = 'live-hunter-alokal';
const SOURCE_ID_KOORA  = 'live-hunter-koora';

// ─────────────────────────────────────────────────────────────
//  LiveHunterService
// ─────────────────────────────────────────────────────────────
export class LiveHunterService {
  private channelPageCache = new Map<string, string>();
  private isHunting = false;

  // ── HTTP helpers ─────────────────────────────────────────────

  private async fetchDirect(
    url: string,
    referer?: string,
    depth = 0
  ): Promise<{ body: string; finalUrl: string; statusCode: number } | null> {
    if (depth > 5) return null;
    return new Promise((resolve) => {
      try {
        const parsed = new URL(url);
        const isHttps = parsed.protocol === 'https:';
        const lib = isHttps ? https : http;

        const req = lib.request(
          {
            hostname: parsed.hostname,
            port: parsed.port ? parseInt(parsed.port, 10) : (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'GET',
            rejectUnauthorized: false,
            headers: {
              'User-Agent': UA,
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
              'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
              'Accept-Encoding': 'gzip, deflate, br',
              Referer: referer || `${parsed.protocol}//${parsed.hostname}/`,
              Connection: 'keep-alive',
              'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
              'Sec-Ch-Ua-Mobile': '?0',
              'Sec-Ch-Ua-Platform': '"Windows"',
              'Sec-Fetch-Dest': 'document',
              'Sec-Fetch-Mode': 'navigate',
              'Sec-Fetch-Site': 'none',
              'Sec-Fetch-User': '?1',
              'Upgrade-Insecure-Requests': '1',
            },
            timeout: 4500,
          },
          (res) => {
            const statusCode = res.statusCode || 0;
            if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
              const redirected = new URL(res.headers.location, url).toString();
              res.destroy();
              return this.fetchDirect(redirected, referer || url, depth + 1).then(resolve);
            }

            let stream: NodeJS.ReadableStream = res;
            const enc = (res.headers['content-encoding'] || '').toLowerCase();
            if (enc === 'gzip') {
              stream = res.pipe(zlib.createGunzip());
            } else if (enc === 'deflate') {
              stream = res.pipe(zlib.createInflate());
            } else if (enc === 'br') {
              stream = res.pipe(zlib.createBrotliDecompress());
            }

            let data = '';
            stream.setEncoding('utf8');
            stream.on('data', (c) => (data += c));
            stream.on('end', () => resolve({ body: data, finalUrl: url, statusCode }));
            stream.on('error', () => resolve({ body: data, finalUrl: url, statusCode }));
          }
        );

        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.on('error', () => resolve(null));
        req.end();
      } catch {
        resolve(null);
      }
    });
  }

  private async fetchViaProxy(url: string): Promise<string | null> {
    return new Promise((resolve) => {
      try {
        const jinaUrl = `https://r.jina.ai/${url}`;
        const parsed = new URL(jinaUrl);
        const req = https.request(
          {
            hostname: parsed.hostname,
            port: 443,
            path: parsed.pathname + parsed.search,
            method: 'GET',
            headers: {
              'User-Agent': UA,
              'X-Return-Format': 'html',
              Accept: 'text/html,*/*',
            },
            timeout: 4500,
          },
          (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (c) => (data += c));
            res.on('end', () => resolve(data));
            res.on('error', () => resolve(null));
          }
        );
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.on('error', () => resolve(null));
        req.end();
      } catch {
        resolve(null);
      }
    });
  }

  private async fetchHtml(
    url: string,
    referer?: string,
    depth = 0
  ): Promise<{ body: string; finalUrl: string } | null> {
    if (depth > 5) return null;

    // 1. Direct request first (FAST: ~100-300ms)
    const direct = await this.fetchDirect(url, referer, depth);
    const isCloudflareBlocked =
      !direct ||
      !direct.body ||
      direct.statusCode === 403 ||
      direct.statusCode === 503 ||
      (direct.body.includes('Just a moment...') && !direct.body.includes('playerae.php'));

    if (direct?.body && !isCloudflareBlocked) {
      return { body: direct.body, finalUrl: direct.finalUrl };
    }

    // 2. Only fallback to proxy if direct returned Cloudflare challenge (403/503/Just a moment)
    if (isCloudflareBlocked && direct?.statusCode !== 404) {
      console.log(`[LiveHunter] 🛡️ تفعيل تجاوز Cloudflare لـ: ${url}`);
      const proxiedBody = await this.fetchViaProxy(url);
      if (proxiedBody && proxiedBody.length > 200) {
        return { body: proxiedBody, finalUrl: url };
      }
    }

    return direct ? { body: direct.body, finalUrl: direct.finalUrl } : null;
  }

  private async verifyStream(url: string, referer?: string): Promise<boolean> {
    if (!url || !url.startsWith('http')) return false;
    if (DEAD_HOSTS.some((h) => url.includes(h))) return false;

    return new Promise((resolve) => {
      try {
        const cleanUrl = url.split('|')[0];
        const parsed = new URL(cleanUrl);
        const isHttps = parsed.protocol === 'https:';
        const lib = isHttps ? https : http;

        let effectiveReferer = referer || `${parsed.protocol}//${parsed.hostname}/`;
        const headers: Record<string, string> = {
          'User-Agent': UA,
          Referer: effectiveReferer,
          Accept: '*/*',
        };

        const isLv = /:8443|lastvelvet|cuttingfame|5gkygx509kqv|awqb0f40a9yo|7odxv0l067ka/i.test(cleanUrl) || referer?.includes('lastvelvet') || referer?.includes('cuttingfame');
        if (isLv) {
          headers['Referer'] = 'https://lastvelvet.net/';
          headers['Origin'] = 'https://lastvelvet.net';
          headers['Sec-Fetch-Dest'] = 'empty';
          headers['Sec-Fetch-Mode'] = 'cors';
          headers['Sec-Fetch-Site'] = 'cross-site';
        } else if (/baranewssumsel|sportsurges|alokalive/i.test(cleanUrl)) {
          headers['Referer'] = 'https://www.alokalive.com/';
          headers['Origin'] = 'https://www.alokalive.com';
        }

        const portNumber = parsed.port ? parseInt(parsed.port, 10) : (isHttps ? 443 : 80);
        const req = lib.request(
          {
            hostname: parsed.hostname,
            port: portNumber,
            path: parsed.pathname + parsed.search,
            method: 'GET',
            rejectUnauthorized: false,
            headers,
            timeout: 6000,
          },
          (res) => {
            const sc = res.statusCode || 0;
            res.destroy();
            // 200, 206 (partial), 301/302 redirects all count as alive
            resolve(sc >= 200 && sc < 400);
          }
        );

        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.on('error', () => resolve(false));
        req.end();
      } catch {
        resolve(false);
      }
    });
  }

  // ── Decryption / Extraction engine ───────────────────────────

  /**
   * Decrypts SwarmCloud / Lastvelvet window._econfig payload
   * (4-chunk reverse transposition permutation [2, 0, 3, 1] with char-3 offset)
   */
  public decryptLastvelvetEconfig(input: string): any {
    try {
      if (!input) return null;
      const order = [2, 0, 3, 1];
      const partsCount = 4;
      const atob1 = (s: string) => Buffer.from(s, 'base64').toString('binary');
      const step1 = atob1(input);
      const totalLen = step1.length;
      const partLen = Math.round(totalLen / partsCount);
      const chunks: string[] = [];
      let offset = 0;
      for (let i = 0; i < partsCount; i++) {
        chunks.push(step1.substr(offset, partLen));
        offset += partLen;
      }
      const reordered: string[] = [];
      for (let i = 0; i < order.length; i++) {
        let chunk = String(chunks[i]);
        chunk = chunk.slice(0, 3) + chunk.slice(4);
        reordered[order[i]] = atob1(chunk);
      }
      const combined = reordered.join('');
      const jsonStr = Buffer.from(combined, 'base64').toString('utf8');
      return JSON.parse(jsonStr);
    } catch {
      return null;
    }
  }

  /**
   * Full Dean Edwards p,a,c,k,e,d unpacker using the vm sandbox.
   */
  private unpackDean(code: string): string {
    const pattern = /eval\(function\(p,a,c,k,e,[rd]\)\{[\s\S]+?\}\s*\(['"]([\s\S]+?)['"],(\d+),(\d+),['"](.+?)['"]\s*\.split\(['"]\|['"]\)\)/g;
    let result = code;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(code)) !== null) {
      try {
        const block = m[0];
        const unpacked = vm.runInNewContext('var _r;eval=function(x){_r=x};' + block + ';_r', {}, { timeout: 1500 });
        if (typeof unpacked === 'string' && unpacked.length > 10) {
          result += '\n' + unpacked;
        }
      } catch {
        // fallback manual
        try {
          let p = m[1]; const a = parseInt(m[2], 10); let c = parseInt(m[3], 10); const k = m[4].split('|');
          const b36 = (n: number): string =>
            (n < a ? '' : b36(Math.floor(n / a))) + ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
          while (c--) { if (k[c]) { const r = new RegExp('\\b' + b36(c) + '\\b', 'g'); p = p.replace(r, k[c]); } }
          result += '\n' + p;
        } catch { /* ignore */ }
      }
    }
    return result;
  }

  /**
   * JWPlayer / HLS.js config extraction: looks for setup({ ... }) or new Hls()
   */
  private extractFromPlayerConfig(html: string, baseUrl: string): string | null {
    // JWPlayer "file": "..."
    const jwFile = html.match(/['"file['"]\s*:\s*['"]([^'"]+\.(?:m3u8|mp4)[^'"]*)['"]/i);
    if (jwFile) return this.normalizeUrl(jwFile[1], baseUrl);

    // JWPlayer sources array
    const jwSrc = html.match(/sources\s*:\s*\[[\s\S]*?file\s*:\s*['"]([^'"]+\.(?:m3u8|mp4)[^'"]*)['"]/i);
    if (jwSrc) return this.normalizeUrl(jwSrc[1], baseUrl);

    // setup({ ... })
    const setupMatch = html.match(/setup\s*\(\s*\{([\s\S]{0,2000}?)\}\s*\)/);
    if (setupMatch) {
      const block = setupMatch[1];
      const fm = block.match(/['"]?(?:file|src|source)['"]?\s*:\s*['"]([^'"]+\.(?:m3u8|mp4)[^'"]*)['"]/i);
      if (fm) return this.normalizeUrl(fm[1], baseUrl);
    }

    // Clappr, Plyr, Video.js
    const plyrMatch = html.match(/new\s+(?:Plyr|Player)\s*\([^)]+,\s*\{[\s\S]*?source\s*:\s*['"]([^'"]+\.(?:m3u8|mp4)[^'"]*)['"]/i);
    if (plyrMatch) return this.normalizeUrl(plyrMatch[1], baseUrl);

    // HLS.js: hls.loadSource("...")
    const hlsLoad = html.match(/hls\.loadSource\s*\(\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i);
    if (hlsLoad) return this.normalizeUrl(hlsLoad[1], baseUrl);

    // ReactHLS / plain video source
    const videoSrc = html.match(/<source[^>]+src=['"]([^'"]+\.(?:m3u8|mp4)[^'"]*)['"]/i);
    if (videoSrc) return this.normalizeUrl(videoSrc[1], baseUrl);

    return null;
  }

  /**
   * Comprehensive stream URL extractor from raw HTML/JS
   */
  private extractStreamUrl(html: string, baseUrl: string): string | null {
    if (!html) return null;

    // 0. Lastvelvet / SwarmCloud window._econfig decryption
    const econfigMatch = html.match(/window\._econfig\s*=\s*['"]([^'"]+)['"]/);
    if (econfigMatch) {
      const cfg = this.decryptLastvelvetEconfig(econfigMatch[1]);
      if (cfg) {
        const direct = cfg.stream_url || cfg.stream_url_nop2p;
        if (direct && this.isValidStreamUrl(direct)) {
          return direct;
        }
      }
    }

    const unpacked = this.unpackDean(html);
    const combined = html + '\n' + unpacked;

    // 1. Direct M3U8/MP4 URL in quotes
    const directM3u8 = combined.match(/['"]?(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*?)['"]?(?=\s|,|;|}|$)/i);
    if (directM3u8) {
      const u = directM3u8[1].replace(/\\+/g, '').replace(/&amp;/g, '&');
      if (this.isValidStreamUrl(u)) return u;
    }

    const directMp4 = combined.match(/['"]?(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*?)['"]?(?=\s|,|;|}|$)/i);
    if (directMp4) {
      const u = directMp4[1].replace(/\\+/g, '').replace(/&amp;/g, '&');
      if (this.isValidStreamUrl(u)) return u;
    }

    // 2. Player config (JWPlayer, HLS.js, Clappr, Plyr)
    const fromPlayer = this.extractFromPlayerConfig(combined, baseUrl);
    if (fromPlayer && this.isValidStreamUrl(fromPlayer)) return fromPlayer;

    // 3. Cloudflare R2 / GCP storage
    const r2 = combined.match(/https?:\/\/[^\s"'<>]*(?:r2\.cloudflarestorage|workers\.dev|storage\.googleapis)[^\s"'<>]+\.(?:mp4|m3u8)[^\s"'<>]*/i);
    if (r2) {
      const u = r2[0].replace(/&amp;/g, '&');
      if (this.isValidStreamUrl(u)) return u;
    }

    // 4. data-link / data-src / data-file
    const dataAttr =
      combined.match(/data-(?:link|src|file|stream)=['"]([^'"]+\.(?:m3u8|mp4)[^'"]*)['"]/i) ||
      combined.match(/data-(?:link|src|file|stream)=['"]([^'"]+)['"]/i);
    if (dataAttr) {
      const u = this.normalizeUrl(dataAttr[1], baseUrl);
      if (u && this.isValidStreamUrl(u)) return u;
    }

    // 5. Generic "source": "..." or "file": "..."
    const fileKv =
      combined.match(/(?:source|file|src|stream)\s*:\s*['"]([^'"]{15,}\.(?:m3u8|mp4)[^'"]*)['"]/i) ||
      combined.match(/(?:source|file|src|stream)\s*:\s*['"]([^'"]{15,})['"]/i);
    if (fileKv) {
      const u = this.normalizeUrl(fileKv[1].replace(/\\+/g, ''), baseUrl);
      if (u && this.isValidStreamUrl(u)) return u;
    }

    // 6. ManifestUrl for HLS
    const manifestUrl = combined.match(/manifest(?:Url|URL)\s*[=:]\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i);
    if (manifestUrl) {
      const u = this.normalizeUrl(manifestUrl[1], baseUrl);
      if (u && this.isValidStreamUrl(u)) return u;
    }

    return null;
  }

  private normalizeUrl(raw: string, base: string): string | null {
    try {
      if (!raw) return null;
      raw = raw.replace(/\\+/g, '').replace(/&amp;/g, '&').trim();
      if (raw.startsWith('//')) return 'https:' + raw;
      if (raw.startsWith('/')) return new URL(raw, base).toString();
      if (raw.startsWith('http')) return raw;
      return null;
    } catch {
      return null;
    }
  }

  private isValidStreamUrl(url: string): boolean {
    if (!url || !url.startsWith('http')) return false;
    const clean = url.split('|')[0];
    if (DEAD_HOSTS.some((h) => clean.includes(h))) return false;
    return clean.includes('.m3u8') || clean.includes('.mp4') || clean.includes('/stream') || clean.includes('manifest');
  }

  // ── Deep iframe resolver (up to 4 levels) ────────────────────

  private async resolveIframes(
    html: string,
    pageUrl: string,
    depth = 0
  ): Promise<{ streamUrl: string; referer: string } | null> {
    if (depth > 4) return null;

    // Try to get stream from current page first
    const direct = this.extractStreamUrl(html, pageUrl);
    if (direct) {
      const isLv = /:8443|lastvelvet|cuttingfame|5gkygx509kqv|awqb0f40a9yo|7odxv0l067ka/i.test(direct);
      const ref = isLv ? 'https://lastvelvet.net/' : pageUrl;
      return { streamUrl: direct, referer: ref };
    }

    // Direct Aflam4you shortcut: extract vid from pageUrl (e.g. ..._68.html or embed.php?vid=68)
    const vidMatch = pageUrl.match(/(?:_(\d+)\.html|vid=(\d+))/);
    const vid = vidMatch ? (vidMatch[1] || vidMatch[2]) : null;
    if (vid && !pageUrl.includes('playeraf.php') && !pageUrl.includes('lastvelvet')) {
      for (const serverNum of [1, 2]) {
        const directPlayerUrl = `https://channel.aflam4you.net/playeraf.php?vid=${vid}&aflam_s=${serverNum}&aflam_k=forex1`;
        try {
          const pResp = await this.fetchHtml(directPlayerUrl, `https://channel.aflam4you.net/embed.php?vid=${vid}`);
          if (pResp?.body) {
            const res = await this.resolveIframes(pResp.body, directPlayerUrl, depth + 1);
            if (res) return res;
          }
        } catch { /* continue */ }
      }
    }

    // Check for Double Base64 embed_c (Aflam4you / Koora player)
    const embedCMatch = html.match(/var\s+embed_c\s*=\s*['"]([A-Za-z0-9+/=]{40,})['"]/);
    if (embedCMatch) {
      try {
        const l1 = Buffer.from(embedCMatch[1], 'base64').toString('utf8');
        const l2 = Buffer.from(l1, 'base64').toString('utf8');
        const lvMatch = l2.match(/https?:\/\/[^\s"'<>]+\/e\/[a-zA-Z0-9]+/);
        if (lvMatch) {
          const resp = await this.fetchHtml(lvMatch[0], pageUrl);
          if (resp?.body) {
            const res = await this.resolveIframes(resp.body, lvMatch[0], depth + 1);
            if (res) return res;
          }
        }
      } catch { /* ignore */ }
    }

    // Check for playerae.php link in embed.php or page
    const playeraeMatch = html.match(/playerae\.php\?vid=[^'"]+/i);
    if (playeraeMatch) {
      try {
        const playerUrl = new URL(playeraeMatch[0], pageUrl).toString();
        const resp = await this.fetchHtml(playerUrl, pageUrl);
        if (resp?.body) {
          const res = await this.resolveIframes(resp.body, playerUrl, depth + 1);
          if (res) return res;
        }
      } catch { /* ignore */ }
    }

    // Find all iframes
    const iframeRegex = /<iframe[^>]+src=['"]([^'"]+)['"]/gi;
    let match: RegExpExecArray | null;
    const iframes: string[] = [];

    while ((match = iframeRegex.exec(html)) !== null) {
      try {
        const iframeUrl = new URL(match[1], pageUrl).toString();
        if (!iframeUrl.includes('google') && !iframeUrl.includes('facebook')) {
          iframes.push(iframeUrl);
        }
      } catch { /* invalid URL */ }
    }

    // Also catch JS-built iframes: document.write('<iframe src="...">')
    const jsIframeRegex = /(?:iframe|src)\s*[=+]\s*['"]([^'"]{10,})['"].*?(?:m3u8|m3u|embed|player|live|stream)/gi;
    while ((match = jsIframeRegex.exec(html)) !== null) {
      try {
        const iframeUrl = new URL(match[1], pageUrl).toString();
        iframes.push(iframeUrl);
      } catch { /* ignore */ }
    }

    for (const iframeUrl of iframes.slice(0, 8)) {
      const resp = await this.fetchHtml(iframeUrl, pageUrl);
      if (resp?.body) {
        const result = await this.resolveIframes(resp.body, iframeUrl, depth + 1);
        if (result) return result;
      }
    }

    return null;
  }

  // ── Concurrent mapper ─────────────────────────────────────────

  private async pMap<T, R>(
    items: T[],
    mapper: (item: T, index: number) => Promise<R>,
    concurrency = 20
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let idx = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (idx < items.length) {
        const i = idx++;
        try { results[i] = await mapper(items[i], i); }
        catch { results[i] = null as any; }
      }
    });
    await Promise.all(workers);
    return results;
  }

  // ─────────────────────────────────────────────────────────────
  //  SOURCE 1: alokalive.com — Live TV Channels
  // ─────────────────────────────────────────────────────────────

  /**
   * Scrapes alokalive.com for all live TV channel pages and extracts streams
   */
  public async huntAlokalive(): Promise<HuntResult> {
    const result: HuntResult = {
      source: 'alokalive.com',
      totalFound: 0,
      addedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      deletedOldCount: 0,
      streams: [],
      errors: [],
    };

    console.log('[LiveHunter] 🚀 بدء صيد قنوات alokalive.com ...');

    const indexPages = [
      'https://www.alokalive.com/',
      'https://www.alokalive.com/channels',
      'https://www.alokalive.com/arabic-channels',
      'https://www.alokalive.com/sports-channels',
      'https://www.alokalive.com/news-channels',
    ];

    const channelLinks = new Set<string>();

    // Fetch index pages and collect channel links
    for (const indexUrl of indexPages) {
      const resp = await this.fetchHtml(indexUrl);
      if (!resp?.body) {
        result.errors.push(`فشل في فتح: ${indexUrl}`);
        continue;
      }

      // Extract channel page links and article links
      const linkRegex = /href=['"]([^'"]*(?:\/channel\/|\/watch\/|\/live\/|\/channels\/|\/\d{4}\/\d{2}\/)[^'"]+\.html)['"]/gi;
      let m: RegExpExecArray | null;
      while ((m = linkRegex.exec(resp.body)) !== null) {
        try {
          const fullUrl = new URL(m[1], indexUrl).toString();
          if (fullUrl.includes('alokalive.com')) {
            channelLinks.add(fullUrl);
          }
        } catch { /* ignore */ }
      }

      // Also look for data-href or data-url attributes with channel info
      const dataHrefRegex = /data-(?:href|url|link)=['"]([^'"]*(?:\/channel\/|\/watch\/|\/\d{4}\/\d{2}\/)[^'"]+)['"]/gi;
      while ((m = dataHrefRegex.exec(resp.body)) !== null) {
        try {
          const fullUrl = new URL(m[1], indexUrl).toString();
          if (fullUrl.includes('alokalive.com')) {
            channelLinks.add(fullUrl);
          }
        } catch { /* ignore */ }
      }

      // Try JSON data embedded in the page (API responses embedded in SSR pages)
      const jsonDataMatch = resp.body.match(/window\.__(?:INITIAL_STATE|DATA|NUXT|NEXT_DATA)__\s*=\s*(\{[\s\S]{100,50000}\})/);
      if (jsonDataMatch) {
        try {
          const jsonData = JSON.parse(jsonDataMatch[1]);
          this.extractChannelLinksFromJson(jsonData, indexUrl, channelLinks);
        } catch { /* ignore */ }
      }
    }

    // If no channel links found via crawling, try the sitemap or API
    if (channelLinks.size === 0) {
      const apiResp = await this.fetchHtml('https://www.alokalive.com/api/channels?limit=200');
      if (apiResp?.body) {
        try {
          const data = JSON.parse(apiResp.body);
          const channels = data?.channels || data?.data || data || [];
          if (Array.isArray(channels)) {
            for (const ch of channels) {
              const slug = ch?.slug || ch?.id || ch?.url;
              if (slug) {
                channelLinks.add(`https://www.alokalive.com/channel/${slug}`);
              }
            }
          }
        } catch { /* ignore */ }
      }
    }

    console.log(`[LiveHunter] 📡 وجدت ${channelLinks.size} رابط قناة من alokalive.com`);
    result.totalFound = channelLinks.size;

    if (channelLinks.size === 0) {
      result.errors.push('لم يتم العثور على روابط قنوات في alokalive.com — ربما الموقع يحتاج JavaScript (Cloudflare)');
      return result;
    }

    // Process each channel page
    const channelArray = Array.from(channelLinks);
    await this.pMap(
      channelArray,
      async (channelUrl) => {
        try {
          const resp = await this.fetchHtml(channelUrl, 'https://www.alokalive.com/');
          if (!resp?.body) return;

          // Extract channel name from title tag or h1
          const nameMatch =
            resp.body.match(/<title[^>]*>([^<]{3,80})<\/title>/i) ||
            resp.body.match(/<h1[^>]*>([^<]{3,60})<\/h1>/i);
          let channelName = nameMatch
            ? nameMatch[1]
                .replace(/\s*[-|–]\s*alokalive\.?com.*$/i, '')
                .replace(/\s*\|\s*.*$/, '')
                .replace(/مشاهدة\s+قناة\s+/i, '')
                .replace(/مشاهده\s+قناه\s+/i, '')
                .replace(/بث\s+مباشر.*$/i, '')
                .trim()
            : channelUrl.split('/').pop()?.replace(/-/g, ' ') || 'قناة مجهولة';

          // Extract logo
          const logoMatch =
            resp.body.match(/(?:channel-logo|logo|thumbnail)[^>]+src=['"]([^'"]+)['"]/i) ||
            resp.body.match(/<img[^>]+(?:alt=['"][^'"]*logo[^'"]*['"]|class=['"][^'"]*logo[^'"]*['"])[^>]+src=['"]([^'"]+)['"]/i);
          const logo = logoMatch ? this.normalizeUrl(logoMatch[1], channelUrl) || undefined : undefined;

          // Resolve stream
          const resolved = await this.resolveIframes(resp.body, channelUrl);
          if (!resolved) return;

          const { streamUrl, referer } = resolved;

          // Verify the stream is actually alive
          const alive = await this.verifyStream(streamUrl, referer);
          if (!alive) return;

          // Determine category
          const category = this.categorizeChannel(channelName);

          const stream: HuntedStream = {
            name: channelName,
            streamUrl,
            pageUrl: channelUrl,
            category,
            logo,
            referer,
            isLive: true,
          };

          result.streams.push(stream);

          // Save to DB
          const { added, updated } = await this.saveChannelToDb(stream, SOURCE_ID_ALOKAL);
          if (added) result.addedCount++;
          else if (updated) result.updatedCount++;
          else result.skippedCount++;

          console.log(`[LiveHunter] ✅ ${channelName} → ${streamUrl.substring(0, 80)}...`);
        } catch (err: any) {
          result.errors.push(`${channelUrl}: ${err.message}`);
        }
      },
      15
    );

    // Delete stale entries from previous scans for this source
    result.deletedOldCount = await this.purgeStaleEntries(SOURCE_ID_ALOKAL, result.streams.map((s) => s.name));
    if (result.streams.length === 0) {
      result.errors.push('ملاحظة: موقع alokalive.com لا يحتوي على مشغلات فيديو نشطة حالياً (مقالات فقط)، بينما كورة لايف يحتوي على كافة القنوات.');
    }
    console.log(`[LiveHunter] ✅ alokalive.com — تم إضافة ${result.addedCount}, تحديث ${result.updatedCount}, حذف ${result.deletedOldCount}`);

    return result;
  }

  private extractChannelLinksFromJson(obj: any, baseUrl: string, out: Set<string>, depth = 0): void {
    if (depth > 10 || !obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (const item of obj) this.extractChannelLinksFromJson(item, baseUrl, out, depth + 1);
    } else {
      for (const [key, val] of Object.entries(obj)) {
        if ((key === 'url' || key === 'href' || key === 'link' || key === 'slug') && typeof val === 'string') {
          try {
            const full = new URL(val, baseUrl).toString();
            if (full.includes('alokalive.com')) {
              out.add(full);
            }
          } catch { /* ignore */ }
        } else if (val && typeof val === 'object') {
          this.extractChannelLinksFromJson(val, baseUrl, out, depth + 1);
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  SOURCE 2: aflam4you.net/koora_live — Football Matches
  // ─────────────────────────────────────────────────────────────

  public async huntKooraLive(): Promise<HuntResult> {
    const result: HuntResult = {
      source: 'aflam4you/koora_live',
      totalFound: 0,
      addedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      deletedOldCount: 0,
      streams: [],
      errors: [],
    };

    console.log('[LiveHunter] ⚽ بدء صيد مباريات koora_live ...');

    const indexPages = [
      'https://channel.aflam4you.net/browse-watch-koora_live-tv-live-videos-1-date.html',
      'https://channel.aflam4you.net/browse-watch-koora_live-tv-live-videos-2-date.html',
      'https://channel.aflam4you.net/browse-watch-koora_live-tv-live-videos-3-date.html',
    ];

    const matchLinks = new Set<string>();

    for (const pageUrl of indexPages) {
      const resp = await this.fetchHtml(pageUrl, 'https://channel.aflam4you.net/');
      if (!resp?.body) continue;

      // Extract channels: ends with _\d+.html e.g. bein-sport-1-live-bein-1-funding-tv_68.html
      const linkPatterns = [
        /href=['"](https?:\/\/channel\.aflam4you\.net\/[^'"]+_\d+\.html)['"]/gi,
        /href=['"](\/[^'"]+_\d+\.html)['"]/gi,
        /\]\((https?:\/\/channel\.aflam4you\.net\/[^\s)]+_\d+\.html)/gi,
        /(https?:\/\/channel\.aflam4you\.net\/[a-zA-Z0-9_-]+_\d+\.html)/gi,
        /href=['"]([^'"]*(?:watch|video|live|match|stream)[^'"]*\.html)['"]/gi,
      ];

      for (const pattern of linkPatterns) {
        let m: RegExpExecArray | null;
        while ((m = pattern.exec(resp.body)) !== null) {
          try {
            const fullUrl = new URL(m[1], pageUrl).toString();
            if (
              fullUrl.includes('aflam4you.net') &&
              !fullUrl.includes('browse-watch') &&
              !fullUrl.includes('login') &&
              !fullUrl.includes('register')
            ) {
              matchLinks.add(fullUrl);
            }
          } catch { /* ignore */ }
        }
      }
    }

    console.log(`[LiveHunter] ⚽ وجدت ${matchLinks.size} رابط مباراة/قناة من koora_live`);
    result.totalFound = matchLinks.size;

    if (matchLinks.size === 0) {
      result.errors.push('لم يتم العثور على روابط مباريات — الموقع محجوب أو محمي');
      return result;
    }

    const matchArray = Array.from(matchLinks).slice(0, 35);

    await this.pMap(
      matchArray,
      async (matchUrl) => {
        try {
          // Fast-path: extract vid directly from matchUrl
          const vidMatch = matchUrl.match(/(?:_(\d+)\.html|vid=(\d+))/);
          const vid = vidMatch ? (vidMatch[1] || vidMatch[2]) : null;

          let matchName = 'مباراة مباشرة';
          let thumbnail: string | undefined = undefined;

          // Quick slug-based channel name fallback
          const urlSlug = matchUrl.split('/').pop()?.replace(/_\d+\.html$/, '') || '';
          if (urlSlug) {
            matchName = urlSlug.replace(/-/g, ' ').trim();
          }

          const resp = await this.fetchHtml(matchUrl, 'https://channel.aflam4you.net/');
          if (resp?.body) {
            const titleMatch =
              resp.body.match(/<title[^>]*>([^<]{5,100})<\/title>/i) ||
              resp.body.match(/<h1[^>]*>([^<]{5,80})<\/h1>/i);
            if (titleMatch) {
              matchName = titleMatch[1]
                .replace(/\s*[-|–]\s*(?:aflam4you|koora|مباشر).*$/i, '')
                .replace(/\s*\|\s*.*$/, '')
                .replace(/مشاهدة\s+قناة\s+/i, '')
                .replace(/مشاهده\s+قناه\s+/i, '')
                .trim();
            }

            const thumbMatch =
              resp.body.match(/(?:poster|thumbnail|og:image)['":\s]+['"]([^'"]+)['"]/i) ||
              resp.body.match(/<meta[^>]+(?:property=['"]og:image['"]|name=['"]thumbnail['"])[^>]+content=['"]([^'"]+)['"]/i);
            thumbnail = thumbMatch ? this.normalizeUrl(thumbMatch[1], matchUrl) || undefined : undefined;
          }

          // Resolve stream (vid fast-path + deep iframe + lastvelvet decrypter)
          const resolved = vid
            ? await this.resolveFreshStream(matchUrl)
            : (resp?.body ? await this.resolveIframes(resp.body, matchUrl) : null);

          if (!resolved) return;

          const { streamUrl, referer } = resolved;
          const alive = await this.verifyStream(streamUrl, referer);
          if (!alive) return;

          const stream: HuntedStream = {
            name: matchName,
            streamUrl,
            pageUrl: matchUrl,
            category: this.categorizeChannel(matchName),
            logo: thumbnail,
            referer: referer || 'https://lastvelvet.net/',
            isLive: true,
          };

          result.streams.push(stream);

          const { added, updated } = await this.saveChannelToDb(stream, SOURCE_ID_KOORA);
          if (added) result.addedCount++;
          else if (updated) result.updatedCount++;
          else result.skippedCount++;

          console.log(`[LiveHunter] ⚽ ${matchName} → ${streamUrl.substring(0, 70)}...`);
        } catch (err: any) {
          result.errors.push(`${matchUrl}: ${err.message}`);
        }
      },
      15
    );

    // Delete stale match entries safely (only if we scanned enough active channels)
    result.deletedOldCount = await this.purgeStaleEntries(SOURCE_ID_KOORA, result.streams.map((s) => s.name));
    console.log(`[LiveHunter] ✅ koora_live — تم إضافة ${result.addedCount}, تحديث ${result.updatedCount}, حذف ${result.deletedOldCount}`);

    return result;
  }

  // ─────────────────────────────────────────────────────────────
  //  DB Persistence
  // ─────────────────────────────────────────────────────────────

  private async saveChannelToDb(
    stream: HuntedStream,
    sourceId: string
  ): Promise<{ added: boolean; updated: boolean }> {
    const norm = stream.name.trim().toLowerCase();
    const existing = await channelRepository.findChannelByNormalizedName(norm).catch(() => null);

    // Cache page URL for fast lookup
    if (stream.pageUrl) {
      this.channelPageCache.set(norm, stream.pageUrl);
    }

    // If stream has a custom referer, append it as pipe header so FFmpeg relays it seamlessly
    let finalStreamUrl = stream.streamUrl;
    if (!finalStreamUrl.includes('|')) {
      const isLv = /:8443|lastvelvet|cuttingfame|5gkygx509kqv|awqb0f40a9yo|7odxv0l067ka/i.test(stream.streamUrl) || stream.referer?.includes('lastvelvet') || stream.referer?.includes('cuttingfame');
      const parts = [`Referer=${stream.referer || (isLv ? 'https://lastvelvet.net/' : 'https://www.alokalive.com/')}`];
      if (isLv) {
        parts.push('Origin=https://lastvelvet.net');
      }
      if (stream.pageUrl) {
        parts.push(`PageUrl=${encodeURIComponent(stream.pageUrl)}`);
      }
      finalStreamUrl = `${stream.streamUrl}|${parts.join('|')}`;
    }

    const payload = {
      sourceId,
      externalIdentifier: stream.pageUrl,
      name: stream.name,
      normalizedName: norm,
      inputType: (stream.streamUrl.includes('.m3u8') ? 'HLS' : 'TS_STREAM') as 'HLS' | 'TS_STREAM',
      inputStatus: 'ONLINE' as const,
      transcodingStatus: 'STOPPED' as const,
      encryptedInputUrl: encrypt(finalStreamUrl),
      groupTitle: stream.category,
      logoUrl: stream.logo,
      orderIndex: this.extractOrderIndex(stream.name),
      enabled: true,
      preset: 'COPY' as const,
    };

    if (existing) {
      await channelRepository.updateChannel(existing.id, {
        externalIdentifier: stream.pageUrl,
        encryptedInputUrl: encrypt(finalStreamUrl),
        inputStatus: 'ONLINE',
        groupTitle: stream.category,
        logoUrl: stream.logo || existing.logoUrl,
        enabled: true,
      });
      return { added: false, updated: true };
    } else {
      await channelRepository.createChannel(payload);
      return { added: true, updated: false };
    }
  }

  private async purgeStaleEntries(sourceId: string, activeNames: string[]): Promise<number> {
    try {
      // Safety guard: NEVER purge if fewer than 10 channels were found in the current hunt
      if (!activeNames || activeNames.length < 10) {
        return 0;
      }
      const all = await channelRepository.listChannels(sourceId);
      let deleted = 0;
      const activeNormed = new Set(activeNames.map((n) => n.trim().toLowerCase()));

      for (const ch of all) {
        if (!activeNormed.has(ch.normalizedName)) {
          await channelRepository.deleteChannel(ch.id);
          deleted++;
        }
      }
      return deleted;
    } catch {
      return 0;
    }
  }

  /**
   * Returns cached page URL for a channel by normalized name
   */
  public getCachedPageUrl(channelName: string): string | null {
    if (!channelName) return null;
    return this.channelPageCache.get(channelName.trim().toLowerCase()) || null;
  }

  /**
   * Resolves a fresh live stream URL on demand for a pageUrl / matchUrl
   */
  public async resolveFreshStream(pageUrl: string): Promise<{ streamUrl: string; referer: string } | null> {
    if (!pageUrl) return null;
    const vidMatch = pageUrl.match(/(?:_(\d+)\.html|vid=(\d+))/);
    const vid = vidMatch ? (vidMatch[1] || vidMatch[2]) : null;

    if (vid) {
      for (const serverNum of [1, 2]) {
        const directPlayerUrl = `https://channel.aflam4you.net/playeraf.php?vid=${vid}&aflam_s=${serverNum}&aflam_k=forex1`;
        try {
          const pResp = await this.fetchHtml(directPlayerUrl, `https://channel.aflam4you.net/embed.php?vid=${vid}`);
          if (pResp?.body) {
            const res = await this.resolveIframes(pResp.body, directPlayerUrl);
            if (res?.streamUrl) {
              return res;
            }
          }
        } catch { /* continue */ }
      }
    }

    try {
      const resp = await this.fetchHtml(pageUrl, 'https://channel.aflam4you.net/');
      if (resp?.body) {
        return await this.resolveIframes(resp.body, pageUrl);
      }
    } catch {}

    return null;
  }

  // ─────────────────────────────────────────────────────────────
  //  Full Hunt (Both Sources)
  // ─────────────────────────────────────────────────────────────

  public async huntAll(): Promise<{ alokal: HuntResult; koora: HuntResult; alreadyRunning?: boolean }> {
    if (this.isHunting) {
      console.log('[LiveHunter] ⏳ صيد قيد التنفيذ بالفعل — منع التكرار');
      return {
        alreadyRunning: true,
        alokal: { source: 'alokalive.com', totalFound: 0, addedCount: 0, updatedCount: 0, skippedCount: 0, deletedOldCount: 0, streams: [], errors: [] },
        koora: { source: 'aflam4you/koora_live', totalFound: 0, addedCount: 0, updatedCount: 0, skippedCount: 0, deletedOldCount: 0, streams: [], errors: [] },
      };
    }

    this.isHunting = true;
    try {
      console.log('[LiveHunter] 🔥 بدء الصيد الشامل — كل المصادر ...');
      const [alokal, koora] = await Promise.all([
        this.huntAlokalive().catch((err) => ({
          source: 'alokalive.com', totalFound: 0, addedCount: 0, updatedCount: 0,
          skippedCount: 0, deletedOldCount: 0, streams: [],
          errors: [`خطأ فادح: ${err.message}`],
        } as HuntResult)),
        this.huntKooraLive().catch((err) => ({
          source: 'aflam4you/koora', totalFound: 0, addedCount: 0, updatedCount: 0,
          skippedCount: 0, deletedOldCount: 0, streams: [],
          errors: [`خطأ فادح: ${err.message}`],
        } as HuntResult)),
      ]);
      return { alokal, koora };
    } finally {
      this.isHunting = false;
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  Helpers
  // ─────────────────────────────────────────────────────────────

  private categorizeChannel(name: string): string {
    const n = name.toLowerCase();
    if (/bein|beIN/.test(name)) return 'باقة beIN Sports';
    if (/\bssc\b/.test(n)) return 'باقة قنوات SSC';
    if (/alkass|كأس/.test(n)) return 'باقة قنوات الكأس (Alkass)';
    if (/sport|رياضة|رياضي|football|soccer|koora|كورة|مباري|match/.test(n)) return 'مباريات كرة القدم';
    if (/abu.?dhabi|dubai|أبوظبي|دبي/.test(n)) return 'باقة أبوظبي ودبي الرياضية';
    if (/iraq|عراق|sharqiya|sumaria|dijlah|شرقية|سومرية|دجلة/.test(n)) return 'باقة القنوات العراقية';
    if (/mbc/.test(n)) return 'باقة قنوات MBC';
    if (/rotana|روتانا/.test(n)) return 'باقة قنوات روتانا';
    if (/news|jazeera|arabiya|hadath|أخبار|إخبارية|حدث/.test(n)) return 'باقة الأخبار العربية';
    if (/quran|قرآن|إسلام|سنة/.test(n)) return 'باقة القنوات الإسلامية';
    return 'باقة القنوات العربية والمنوعة';
  }

  private extractOrderIndex(name: string): number {
    const m = name.match(/\b(\d+)\b/);
    return m ? parseInt(m[1], 10) : 99;
  }
}

export const liveHunterService = new LiveHunterService();
