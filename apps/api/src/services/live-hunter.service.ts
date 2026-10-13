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
  groupTitle?: string;
  orderIndex?: number;
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
  'proveouter.net', 'turneven.net', 'baranewssumsel.online',
];

// Source IDs stored in DB so we can purge old entries per-source
const SOURCE_ID_ALOKAL = 'live-hunter-alokal';
const SOURCE_ID_KOORA  = 'live-hunter-koora';

// Direct verified embed URLs for major channels (bypasses Cloudflare block on Railway)
const KNOWN_CHANNEL_EMBEDS: Record<string, string[]> = {
  // beIN Sports (cuttingfame.net Server 2 is primary & fast, lastvelvet.net Server 1 is backup)
  '68':  ['https://cuttingfame.net/e/ul20p3zstxrux', 'https://lastvelvet.net/e/yxtmusy4xj8tj'], // beIN Sports 1
  '2':   ['https://cuttingfame.net/e/7i3ndsazuue9c', 'https://lastvelvet.net/e/g8yofudvqi9o4'], // beIN Sports 2
  '1':   ['https://cuttingfame.net/e/sudzp065f56jn', 'https://lastvelvet.net/e/jme27e5q28q73'], // beIN Sports 3
  '3':   ['https://cuttingfame.net/e/cd8wb9ca5aa27', 'https://lastvelvet.net/e/nes605b1s1auu'], // beIN Sports 4
  '73':  ['https://cuttingfame.net/e/pq1cxgc9ayrt8', 'https://lastvelvet.net/e/9pbaymxoe10u5'], // beIN Sports 5
  '74':  ['https://cuttingfame.net/e/r47qs176bsera', 'https://lastvelvet.net/e/k5ayolxfziqxw'], // beIN Sports 6
  '75':  ['https://cuttingfame.net/e/cd8wbhkarw9zf', 'https://lastvelvet.net/e/fkl4huceistlc'], // beIN Sports 7
  '76':  ['https://cuttingfame.net/e/hojurc23czia2', 'https://lastvelvet.net/e/r47qsx86linpo'], // beIN Sports 8
  '179': ['https://cuttingfame.net/e/ul20p3zstxrux', 'https://lastvelvet.net/e/yxtmusy4xj8tj'], // beIN Sports Max 1
  '180': ['https://cuttingfame.net/e/7i3ndsazuue9c', 'https://lastvelvet.net/e/g8yofudvqi9o4'], // beIN Sports Max 2
  // SSC & Sports
  '167': ['https://cuttingfame.net/e/4yiju00rko0iq', 'https://lastvelvet.net/e/nes6w0c1sbpt4'], // SSC 1 Sports
  '4':   ['https://cuttingfame.net/e/k5sdbrofhyd5u', 'https://lastvelvet.net/e/3hom7ub0xrx4h'], // Arryadia SNRT TNT
  '65':  ['https://lastvelvet.net/e/qjndxh9pae73e'], // ON Time Sports 3
  // Entertainment & Variety
  '6':   ['https://lastvelvet.net/e/7i3ncg4z65r4j'], // MBC 2
  '7':   ['https://lastvelvet.net/e/g8yoeasv965i2'], // Al Oula
  '8':   ['https://lastvelvet.net/e/fkknn6repsxl6'], // 2M Maroc
  '9':   ['https://lastvelvet.net/e/pq1cy7g9kcu3z'], // Zee Aflam
  '79':  ['https://lastvelvet.net/e/qjndxtnpil3iy'], // Zee Alwan
  '20':  ['https://lastvelvet.net/e/twof22linrpra'], // Algerie TV
  '40':  ['https://lastvelvet.net/e/two992oijp5tg'], // Nesma
};

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

        const isCuttingFame = /cuttingfame/i.test(cleanUrl) || referer?.includes('cuttingfame');
        const isLv = /:8443|lastvelvet|cuttingfame|5gkygx509kqv|awqb0f40a9yo|7odxv0l067ka/i.test(cleanUrl) || referer?.includes('lastvelvet');
        if (isCuttingFame) {
          headers['Referer'] = 'https://cuttingfame.net/';
          headers['Origin'] = 'https://cuttingfame.net';
        } else if (isLv) {
          headers['Referer'] = 'https://lastvelvet.net/';
          headers['Origin'] = 'https://lastvelvet.net';
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
      const isCf = /cuttingfame/i.test(direct) || pageUrl.includes('cuttingfame');
      const isLv = /:8443|lastvelvet|cuttingfame|5gkygx509kqv|awqb0f40a9yo|7odxv0l067ka/i.test(direct);
      const ref = isCf ? 'https://cuttingfame.net/' : isLv ? 'https://lastvelvet.net/' : pageUrl;
      return { streamUrl: direct, referer: ref };
    }

    // Direct Aflam4you shortcut: extract vid from pageUrl (e.g. ..._68.html or embed.php?vid=68)
    const vidMatch = pageUrl.match(/(?:_(\d+)\.html|vid=(\d+))/);
    const vid = vidMatch ? (vidMatch[1] || vidMatch[2]) : null;
    if (vid && !pageUrl.includes('playeraf.php') && !pageUrl.includes('lastvelvet') && !pageUrl.includes('cuttingfame')) {
      // First check known verified embeds (bypasses Cloudflare on Railway)
      if (KNOWN_CHANNEL_EMBEDS[vid]) {
        for (const embedUrl of KNOWN_CHANNEL_EMBEDS[vid]) {
          try {
            const isCf = embedUrl.includes('cuttingfame');
            const parentRef = `https://channel.aflam4you.net/playeraf.php?vid=${vid}&aflam_s=${isCf ? 2 : 1}&aflam_k=forex1`;
            const resp = await this.fetchHtml(embedUrl, parentRef);
            if (resp?.body) {
              const res = await this.resolveIframes(resp.body, embedUrl, depth + 1);
              if (res) return res;
            }
          } catch { /* continue */ }
        }
      }

      for (const serverNum of [2, 1, 3]) {
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
          const lvUrl = lvMatch[0];
          if (!DEAD_HOSTS.some((h) => lvUrl.includes(h))) {
            const resp = await this.fetchHtml(lvUrl, pageUrl);
            if (resp?.body) {
              const res = await this.resolveIframes(resp.body, lvUrl, depth + 1);
              if (res) return res;
            }
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
      4
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

    console.log('[LiveHunter] ⚽ بدء صيد جميع قنوات koora_live من الألف إلى الياء...');

    interface ChannelMeta {
      title?: string;
      logo?: string;
    }

    const matchLinks = new Map<string, ChannelMeta>();

    // Pre-seed known core sports channels so they are always guaranteed
    const knownBasePages = [
      'https://channel.aflam4you.net/bein-sport-1-live-bein-1-funding-tv_68.html',
      'https://channel.aflam4you.net/bein-sports-2-2026-bn2-funding-tv_2.html',
      'https://channel.aflam4you.net/bein-sport-3-bein-3-live-funding-tv_1.html',
      'https://channel.aflam4you.net/bein-sport-4-hd-live-hd-funding-tv_3.html',
      'https://channel.aflam4you.net/bein-sports-5-hd-live-funding-tv_73.html',
      'https://channel.aflam4you.net/bein-sports-6-hd-live-funding-tv_74.html',
      'https://channel.aflam4you.net/bein-sports-7-hd-live-bein7-funding-tv_75.html',
      'https://channel.aflam4you.net/bein-sports-8-hd-live-funding-tv_76.html',
      'https://channel.aflam4you.net/bein-sport-max-1-live-hd-funding-tv_179.html',
      'https://channel.aflam4you.net/bein-sport-max-2-live-hd-funding-tv_180.html',
      'https://channel.aflam4you.net/arryadia-snrt-live-maroc-funding-tv_4.html',
      'https://channel.aflam4you.net/ssc-1-live-hd-tv-live-match-funding-tv_167.html',
    ];
    for (const kp of knownBasePages) {
      matchLinks.set(kp, {});
    }

    // Crawl all pages of sports category dynamically until no more pages exist
    for (let page = 1; page <= 25; page++) {
      const pageUrl = `https://channel.aflam4you.net/browse-watch-koora_live-tv-live-videos-${page}-date.html`;
      const resp = await this.fetchHtml(pageUrl, 'https://channel.aflam4you.net/');
      if (!resp?.body) break;

      let foundOnPage = 0;
      const itemRegex = /<div class="pm-video-thumb">[\s\S]*?<a href="([^"]+)"(?:\s+title="([^"]*)")?[\s\S]*?<img src="([^"]+)"[^>]*alt="([^"]*)"/gi;
      let m: RegExpExecArray | null;

      while ((m = itemRegex.exec(resp.body)) !== null) {
        try {
          const fullUrl = new URL(m[1], pageUrl).toString();
          if (fullUrl.includes('aflam4you.net') && !fullUrl.includes('browse-watch')) {
            const rawTitle = (m[4] || m[2] || '').trim();
            const rawLogo = m[3] ? (m[3].startsWith('http') ? m[3] : 'https://channel.aflam4you.net' + m[3]) : undefined;
            matchLinks.set(fullUrl, {
              title: rawTitle,
              logo: rawLogo,
            });
            foundOnPage++;
          }
        } catch { /* ignore */ }
      }

      // Fallback regex to capture any other channel links on page
      const linkRegex = /href=['"]([^'"]*_(\d+)\.html)['"][^>]*>([^<]*)<\/a>/gi;
      while ((m = linkRegex.exec(resp.body)) !== null) {
        try {
          const rawUrl = m[1];
          if (rawUrl.includes('browse-watch') || rawUrl.includes('login') || rawUrl.includes('register')) continue;
          const fullUrl = new URL(rawUrl, pageUrl).toString();
          if (!matchLinks.has(fullUrl)) {
            matchLinks.set(fullUrl, { title: (m[3] || '').trim() });
            foundOnPage++;
          }
        } catch { /* ignore */ }
      }

      if (foundOnPage === 0) {
        break; // Reached end of pagination
      }
    }

    console.log(`[LiveHunter] ⚽ إجمالي القنوات المكتشفة من koora_live: ${matchLinks.size} قناة.`);
    result.totalFound = matchLinks.size;

    if (matchLinks.size === 0) {
      result.errors.push('لم يتم العثور على روابط مباريات — الموقع محجوب أو محمي');
      return result;
    }

    // Wipe previous channels for this source first to ensure a 100% clean, non-duplicate list
    console.log('[LiveHunter] 🗑️ حذف القنوات القديمة من مصدر koora_live لبدء استيراد نظيف 100%...');
    const deletedCount = await channelRepository.deleteChannelsBySource(SOURCE_ID_KOORA).catch(() => 0);
    result.deletedOldCount = deletedCount;
    console.log(`[LiveHunter] 🗑️ تم حذف ${deletedCount} قناة سابقة بنجاح.`);

    // Deduplicate by cleanName first so each of the 101 channels is processed exactly once
    interface DeduplicatedChannel {
      matchUrl: string;
      meta: ChannelMeta;
      cleanName: string;
      group: string;
      order: number;
      vid: string | null;
    }

    const uniqueChannels = new Map<string, DeduplicatedChannel>();
    for (const [matchUrl, meta] of matchLinks.entries()) {
      const vidMatch = matchUrl.match(/(?:_(\d+)\.html|vid=(\d+))/);
      const vid = vidMatch ? (vidMatch[1] || vidMatch[2]) : null;
      const { name: cleanName, group, order } = this.classifyAndOrderSportChannel(
        meta.title || '',
        matchUrl
      );
      if (!uniqueChannels.has(cleanName)) {
        uniqueChannels.set(cleanName, { matchUrl, meta, cleanName, group, order, vid });
      }
    }

    const sortedEntries = Array.from(uniqueChannels.values()).sort((a, b) => a.order - b.order);
    console.log(`[LiveHunter] ⚽ إجمالي القنوات الفريدة بعد التصفية والتصنيف: ${sortedEntries.length} قناة.`);

    // Process ALL discovered channels from A to Z without dropping any channel
    await this.pMap(
      sortedEntries,
      async (item) => {
        try {
          const thumbnail = item.meta.logo || (item.vid ? `https://channel.aflam4you.net/uploads/thumbs/${item.vid}-1.jpg` : undefined);

          // Resolve fresh stream from upstream CDN
          let streamUrl: string;
          let referer: string = 'https://lastvelvet.net/';
          let isLive = false;

          const resolved = await this.resolveFreshStream(item.matchUrl);
          if (resolved?.streamUrl) {
            streamUrl = resolved.streamUrl;
            referer = resolved.referer || referer;
            isLive = true;
          } else {
            // Reliable fallback player so the channel is NEVER lost even before match kick-off
            streamUrl = `https://channel.aflam4you.net/playeraf.php?vid=${item.vid || '1'}&aflam_s=1&aflam_k=forex1`;
            referer = 'https://channel.aflam4you.net/';
            isLive = false;
          }

          const stream: HuntedStream = {
            name: item.cleanName,
            streamUrl,
            pageUrl: item.matchUrl,
            category: item.group,
            groupTitle: item.group,
            orderIndex: item.order,
            logo: thumbnail,
            referer,
            isLive,
          };

          result.streams.push(stream);

          const { added, updated } = await this.saveChannelToDb(stream, SOURCE_ID_KOORA);
          if (added) result.addedCount++;
          else if (updated) result.updatedCount++;
          else result.skippedCount++;

          console.log(`[LiveHunter] ⚽ [${result.streams.length}/${sortedEntries.length}] ${item.cleanName} (#${item.order}) → ${isLive ? '🟢 Live' : '🟡 Standby'}`);
        } catch (err: any) {
          result.errors.push(`${item.matchUrl}: ${err.message}`);
        }
      },
      8
    );

    console.log(`[LiveHunter] ✅ koora_live — تم إضافة ${result.addedCount}, تحديث ${result.updatedCount}, حذف ${result.deletedOldCount}, المجموع الحي ${result.streams.length}`);

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
      if (existing) {
        this.channelPageCache.set(existing.normalizedName, stream.pageUrl);
      }
    }

    // If stream has a custom referer, append it as pipe header so FFmpeg relays it seamlessly
    let finalStreamUrl = stream.streamUrl;
    if (!finalStreamUrl.includes('|')) {
      const isCuttingFame = /cuttingfame/i.test(stream.streamUrl) || stream.referer?.includes('cuttingfame');
      const isLv = /:8443|lastvelvet|cuttingfame|5gkygx509kqv|awqb0f40a9yo|7odxv0l067ka/i.test(stream.streamUrl) || stream.referer?.includes('lastvelvet');
      const ref = stream.referer || (isCuttingFame ? 'https://cuttingfame.net/' : isLv ? 'https://lastvelvet.net/' : 'https://www.alokalive.com/');
      const orig = isCuttingFame ? 'https://cuttingfame.net' : isLv ? 'https://lastvelvet.net' : 'https://www.alokalive.com';
      const parts = [`Referer=${ref}`, `Origin=${orig}`];
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
      groupTitle: stream.groupTitle || stream.category,
      logoUrl: stream.logo,
      orderIndex: stream.orderIndex !== undefined ? stream.orderIndex : this.extractOrderIndex(stream.name),
      enabled: true,
      preset: 'COPY' as const,
    };

    if (existing) {
      await channelRepository.updateChannel(existing.id, {
        name: stream.name,
        normalizedName: norm,
        externalIdentifier: stream.pageUrl,
        encryptedInputUrl: encrypt(finalStreamUrl),
        inputStatus: 'ONLINE',
        groupTitle: stream.groupTitle || stream.category,
        logoUrl: stream.logo || existing.logoUrl,
        orderIndex: stream.orderIndex !== undefined ? stream.orderIndex : existing.orderIndex,
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

  private static readonly NAME_TO_PAGE_URL: Record<string, string> = {
    'bein sport 1': 'https://channel.aflam4you.net/bein-sport-1-live-bein-1-funding-tv_68.html',
    'bein sports 1': 'https://channel.aflam4you.net/bein-sport-1-live-bein-1-funding-tv_68.html',
    'bein sport 2': 'https://channel.aflam4you.net/bein-sports-2-2026-bn2-funding-tv_2.html',
    'bein sports 2': 'https://channel.aflam4you.net/bein-sports-2-2026-bn2-funding-tv_2.html',
    'bein sport 3': 'https://channel.aflam4you.net/bein-sport-3-bein-3-live-funding-tv_1.html',
    'bein sports 3': 'https://channel.aflam4you.net/bein-sport-3-bein-3-live-funding-tv_1.html',
    'bein sport 4': 'https://channel.aflam4you.net/bein-sport-4-hd-live-hd-funding-tv_3.html',
    'bein sports 4': 'https://channel.aflam4you.net/bein-sport-4-hd-live-hd-funding-tv_3.html',
    'bein sport 5': 'https://channel.aflam4you.net/bein-sports-5-hd-live-funding-tv_73.html',
    'bein sports 5': 'https://channel.aflam4you.net/bein-sports-5-hd-live-funding-tv_73.html',
    'bein sport 6': 'https://channel.aflam4you.net/bein-sports-6-hd-live-funding-tv_74.html',
    'bein sports 6': 'https://channel.aflam4you.net/bein-sports-6-hd-live-funding-tv_74.html',
    'bein sport 7': 'https://channel.aflam4you.net/bein-sports-7-hd-live-bein7-funding-tv_75.html',
    'bein sports 7': 'https://channel.aflam4you.net/bein-sports-7-hd-live-bein7-funding-tv_75.html',
    'bein sport 8': 'https://channel.aflam4you.net/bein-sports-8-hd-live-funding-tv_76.html',
    'bein sports 8': 'https://channel.aflam4you.net/bein-sports-8-hd-live-funding-tv_76.html',
    'bein sport max 1': 'https://channel.aflam4you.net/bein-sport-max-1-live-hd-funding-tv_179.html',
    'bein sports max 1': 'https://channel.aflam4you.net/bein-sport-max-1-live-hd-funding-tv_179.html',
    'bein sport max 2': 'https://channel.aflam4you.net/bein-sport-max-2-live-hd-funding-tv_180.html',
    'bein sports max 2': 'https://channel.aflam4you.net/bein-sport-max-2-live-hd-funding-tv_180.html',
    'arryadia': 'https://channel.aflam4you.net/arryadia-snrt-live-maroc-funding-tv_4.html',
    'ssc 1': 'https://channel.aflam4you.net/ssc-1-live-hd-tv-live-match-funding-tv_167.html',
    'ssc 1 sports': 'https://channel.aflam4you.net/ssc-1-live-hd-tv-live-match-funding-tv_167.html',
  };

  /**
   * Resolves known aflam4you page URL by channel name if not in cache
   */
  public findPageUrlByName(channelName: string): string | null {
    if (!channelName) return null;
    const lower = channelName.toLowerCase();
    for (const [key, url] of Object.entries(LiveHunterService.NAME_TO_PAGE_URL)) {
      if (lower.includes(key)) return url;
    }
    if (/بي ان سبورت 1|بين سبورت 1/.test(channelName)) return 'https://channel.aflam4you.net/bein-sport-1-live-bein-1-funding-tv_68.html';
    if (/بي ان سبورت 2|بين سبورت 2/.test(channelName)) return 'https://channel.aflam4you.net/bein-sports-2-2026-bn2-funding-tv_2.html';
    if (/بي ان سبورت 3|بين سبورت 3/.test(channelName)) return 'https://channel.aflam4you.net/bein-sport-3-bein-3-live-funding-tv_1.html';
    if (/بي ان سبورت 4|بين سبورت 4/.test(channelName)) return 'https://channel.aflam4you.net/bein-sport-4-hd-live-hd-funding-tv_3.html';
    if (/بي ان سبورت 5|بين سبورت 5/.test(channelName)) return 'https://channel.aflam4you.net/bein-sports-5-hd-live-funding-tv_73.html';
    if (/بي ان سبورت 6|بين سبورت 6/.test(channelName)) return 'https://channel.aflam4you.net/bein-sports-6-hd-live-funding-tv_74.html';
    if (/بي ان سبورت 7|بين سبورت 7/.test(channelName)) return 'https://channel.aflam4you.net/bein-sports-7-hd-live-bein7-funding-tv_75.html';
    if (/بي ان سبورت 8|بين سبورت 8/.test(channelName)) return 'https://channel.aflam4you.net/bein-sports-8-hd-live-funding-tv_76.html';
    if (/ماكس 1|max 1/.test(lower)) return 'https://channel.aflam4you.net/bein-sport-max-1-live-hd-funding-tv_179.html';
    if (/ماكس 2|max 2/.test(lower)) return 'https://channel.aflam4you.net/bein-sport-max-2-live-hd-funding-tv_180.html';
    if (/الرياضية المغربية|snrt|رياضية/.test(channelName)) return 'https://channel.aflam4you.net/arryadia-snrt-live-maroc-funding-tv_4.html';
    if (/اس اس سي 1|ssc 1/.test(lower)) return 'https://channel.aflam4you.net/ssc-1-live-hd-tv-live-match-funding-tv_167.html';
    return null;
  }

  /**
   * Resolves a fresh live stream URL on demand for a pageUrl / matchUrl
   */
  public async resolveFreshStream(pageUrl: string): Promise<{ streamUrl: string; referer: string } | null> {
    if (!pageUrl) return null;
    const vidMatch = pageUrl.match(/(?:_(\d+)\.html|vid=(\d+))/);
    const vid = vidMatch ? (vidMatch[1] || vidMatch[2]) : null;

    if (vid) {
      // 1. Direct verified embed bypass (NO CLOUDFLARE REQUEST TO AFLAM4YOU NEEDED!)
      if (KNOWN_CHANNEL_EMBEDS[vid]) {
        for (const embedUrl of KNOWN_CHANNEL_EMBEDS[vid]) {
          try {
            const isCf = embedUrl.includes('cuttingfame');
            const parentRef = `https://channel.aflam4you.net/playeraf.php?vid=${vid}&aflam_s=${isCf ? 2 : 1}&aflam_k=forex1`;
            const resp = await this.fetchHtml(embedUrl, parentRef);
            if (resp?.body) {
              const res = await this.resolveIframes(resp.body, embedUrl);
              if (res?.streamUrl) {
                return res;
              }
            }
          } catch { /* continue */ }
        }
      }

      // 2. Fallback to playeraf servers 2, 1, 3
      for (const serverNum of [2, 1, 3]) {
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

  private formatArabicChannelName(url: string): string {
    const slug = url.split('/').pop()?.replace(/_\d+\.html$/, '') || '';
    if (/bein-?sport-?1\b/i.test(slug)) return 'قناة beIN Sports 1 HD';
    if (/bein-?sport-?2\b/i.test(slug)) return 'قناة beIN Sports 2 HD';
    if (/bein-?sport-?3\b/i.test(slug)) return 'قناة beIN Sports 3 HD';
    if (/bein-?sport-?4\b/i.test(slug)) return 'قناة beIN Sports 4 HD';
    if (/bein-?sport-?5\b/i.test(slug)) return 'قناة beIN Sports 5 HD';
    if (/bein-?sport-?6\b/i.test(slug)) return 'قناة beIN Sports 6 HD';
    if (/bein-?sport-?7\b/i.test(slug)) return 'قناة beIN Sports 7 HD';
    if (/bein-?sport-?8\b/i.test(slug)) return 'قناة beIN Sports 8 HD';
    if (/bein-?sport-?9\b/i.test(slug)) return 'قناة beIN Sports 9 HD';
    if (/bein-?sport-?10\b/i.test(slug)) return 'قناة beIN Sports 10 HD';
    if (/bein-?sport-?max-?1\b/i.test(slug)) return 'قناة beIN Sports Max 1 HD';
    if (/bein-?sport-?max-?2\b/i.test(slug)) return 'قناة beIN Sports Max 2 HD';
    if (/bein-?ports-?news\b/i.test(slug)) return 'قناة beIN Sports الإخبارية';
    if (/arryadia/i.test(slug)) return 'قناة الرياضية المغربية (Arryadia SNRT)';
    if (/ssc1\b/i.test(slug)) return 'قناة SSC 1 Sports HD';
    if (/ssc2\b/i.test(slug)) return 'قناة SSC 2 Sports HD';
    if (/ssc3\b/i.test(slug)) return 'قناة SSC 3 Sports HD';
    if (/ssc4\b/i.test(slug)) return 'قناة SSC 4 Sports HD';
    if (/ssc5\b/i.test(slug)) return 'قناة SSC 5 Sports HD';
    if (/abudhabi-?sport-?3\b/i.test(slug)) return 'قناة أبوظبي الرياضية 3';
    if (/alkass/i.test(slug)) return 'قناة الكأس الرياضية';

    return slug
      .replace(/-funding-tv$/i, '')
      .replace(/-live$/i, '')
      .replace(/-/g, ' ')
      .trim() || 'مباراة مباشرة';
  }

  public classifyAndOrderSportChannel(rawName: string, pageUrl: string): { name: string; group: string; order: number } {
    const r = (rawName || '').trim();
    const slug = pageUrl.split('/').pop()?.replace(/_\d+\.html$/, '').toLowerCase() || '';
    const combined = (r + ' ' + slug).toLowerCase();

    const hasNum = (n: number) => {
      const arabicNums = ['', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩', '١٠', '١١', '١٢'];
      const arN = arabicNums[n] || '';
      const reWord = new RegExp('(^|[^0-9])' + n + '([^0-9]|$)');
      return reWord.test(slug) || (arN && r.includes(arN)) || reWord.test(r);
    };

    // 1. SSC Sports (Checked first to prevent extrat collision with beIN xtra)
    if (combined.includes('ssc')) {
      if (combined.includes('news')) return { name: 'SSC News Sports HD', group: 'قنوات SSC الرياضية', order: 57 };
      if (combined.includes('extra') || combined.includes('extrat')) {
        if (hasNum(1)) return { name: 'SSC Extra 1 Sports HD', group: 'قنوات SSC الرياضية', order: 55 };
        if (hasNum(2)) return { name: 'SSC Extra 2 Sports HD', group: 'قنوات SSC الرياضية', order: 56 };
      }
      for (let n = 5; n >= 1; n--) {
        if (hasNum(n)) return { name: `SSC ${n} Sports HD`, group: 'قنوات SSC الرياضية', order: 50 + (n - 1) };
      }
    }

    // 2. Alkass (Checked first to prevent extra collision with beIN xtra)
    if (combined.includes('kass') || combined.includes('كاس') || combined.includes('كأس')) {
      if (combined.includes('extra') || combined.includes('extrat')) {
        if (hasNum(1) || combined.includes('one')) return { name: 'قناة الكأس Extra 1 HD', group: 'قنوات الكأس الرياضية', order: 75 };
        if (hasNum(2) || combined.includes('two') || slug.includes('extra-live')) return { name: 'قناة الكأس Extra 2 HD', group: 'قنوات الكأس الرياضية', order: 76 };
      }
      if (slug.includes('four') || hasNum(4)) return { name: 'قناة الكأس 4 HD', group: 'قنوات الكأس الرياضية', order: 64 };
      if (slug.includes('five') || hasNum(5)) return { name: 'قناة الكأس 5 HD', group: 'قنوات الكأس الرياضية', order: 65 };
      if (slug.includes('six') || hasNum(6)) return { name: 'قناة الكأس 6 HD', group: 'قنوات الكأس الرياضية', order: 66 };
      if (slug.includes('seven') || hasNum(7)) return { name: 'قناة الكأس 7 HD', group: 'قنوات الكأس الرياضية', order: 67 };
      if (slug.includes('eighth') || hasNum(8)) return { name: 'قناة الكأس 8 HD', group: 'قنوات الكأس الرياضية', order: 68 };
      if (slug.includes('nine') || hasNum(9)) return { name: 'قناة الكأس 9 HD', group: 'قنوات الكأس الرياضية', order: 69 };
      if (slug.includes('ten') || hasNum(10)) return { name: 'قناة الكأس 10 HD', group: 'قنوات الكأس الرياضية', order: 70 };
      if (slug.includes('eleventh') || hasNum(11)) return { name: 'قناة الكأس 11 HD', group: 'قنوات الكأس الرياضية', order: 71 };
      if (slug.includes('twelfth') || hasNum(12)) return { name: 'قناة الكأس 12 HD', group: 'قنوات الكأس الرياضية', order: 72 };
      if (slug.includes('one') || hasNum(1)) return { name: 'قناة الكأس 1 HD', group: 'قنوات الكأس الرياضية', order: 61 };
      if (slug.includes('two') || hasNum(2)) return { name: 'قناة الكأس 2 HD', group: 'قنوات الكأس الرياضية', order: 62 };
      if (slug.includes('three') || hasNum(3)) return { name: 'قناة الكأس 3 HD', group: 'قنوات الكأس الرياضية', order: 63 };
    }

    // 3. Abu Dhabi Sports
    if (combined.includes('abudhabi') || combined.includes('abu-dhabi') || combined.includes('ابوظبي') || slug.includes('ad-sport')) {
      if (combined.includes('premium')) {
        if (hasNum(1)) return { name: 'أبوظبي الرياضية 1 Premium HD', group: 'قنوات أبوظبي الرياضية', order: 87 };
        if (hasNum(2)) return { name: 'أبوظبي الرياضية 2 Premium HD', group: 'قنوات أبوظبي الرياضية', order: 88 };
      }
      for (let n = 6; n >= 1; n--) {
        if (hasNum(n)) return { name: `أبوظبي الرياضية ${n} HD`, group: 'قنوات أبوظبي الرياضية', order: 80 + (n - 1) };
      }
    }

    // 4. ON Time Sports (أون تايم سبورت)
    if (combined.includes('on-time') || combined.includes('on time') || combined.includes('on-sport') || combined.includes('on sport') || slug.includes('on-sport')) {
      if (combined.includes('plus')) return { name: 'ON Sport Plus HD', group: 'قنوات أون تايم سبورت', order: 104 };
      if (combined.includes('max')) return { name: 'ON Sport Max HD', group: 'قنوات أون تايم سبورت', order: 105 };
      if (combined.includes('time') && (hasNum(1) || combined.includes('egypt'))) return { name: 'ON Time Sports 1 HD', group: 'قنوات أون تايم سبورت', order: 100 };
      if (combined.includes('time') && hasNum(2)) return { name: 'ON Time Sports 2 HD', group: 'قنوات أون تايم سبورت', order: 101 };
      if (combined.includes('time') && hasNum(3)) return { name: 'ON Time Sports 3 HD', group: 'قنوات أون تايم سبورت', order: 102 };
      return { name: 'ON Sport HD', group: 'قنوات أون تايم سبورت', order: 103 };
    }

    // 5. Regional & Arab Specific Channels
    if (combined.includes('dubai') || slug.includes('dubai')) {
      if (hasNum(1)) return { name: 'دبي الرياضية 1 HD', group: 'قنوات رياضية عربية متنوعة', order: 116 };
      if (hasNum(2)) return { name: 'دبي الرياضية 2 HD', group: 'قنوات رياضية عربية متنوعة', order: 117 };
    }
    if (combined.includes('bahrain') || slug.includes('bahrain') || combined.includes('بحرين')) {
      if (hasNum(1)) return { name: 'البحرين الرياضية 1 HD', group: 'قنوات رياضية عربية متنوعة', order: 118 };
      if (hasNum(2)) return { name: 'البحرين الرياضية 2 HD', group: 'قنوات رياضية عربية متنوعة', order: 119 };
    }
    if (combined.includes('thmanyah') || slug.includes('thmanyah') || combined.includes('ثمانية')) {
      if (hasNum(1)) return { name: 'ثمانية 1 الرياضية HD', group: 'قنوات رياضية عربية متنوعة', order: 126 };
      if (hasNum(2)) return { name: 'ثمانية 2 الرياضية HD', group: 'قنوات رياضية عربية متنوعة', order: 127 };
      if (hasNum(3)) return { name: 'ثمانية 3 الرياضية HD', group: 'قنوات رياضية عربية متنوعة', order: 128 };
    }
    if (combined.includes('oman') || combined.includes('عمان')) return { name: 'عمان الرياضية HD', group: 'قنوات رياضية عربية متنوعة', order: 120 };
    if (combined.includes('jordan') || combined.includes('الأردن')) return { name: 'الأردن الرياضية HD', group: 'قنوات رياضية عربية متنوعة', order: 121 };
    if (combined.includes('sharjah') || combined.includes('الشارقة')) return { name: 'الشارقة الرياضية HD', group: 'قنوات رياضية عربية متنوعة', order: 122 };
    if (combined.includes('watania') || combined.includes('الوطنية')) return { name: 'الوطنية الرياضية التونسية HD', group: 'قنوات رياضية عربية متنوعة', order: 123 };
    if (combined.includes('diwan') || combined.includes('ديوان')) return { name: 'ديوان سبورت التونسية HD', group: 'قنوات رياضية عربية متنوعة', order: 124 };
    if (combined.includes('haddaf') || combined.includes('الهداف')) return { name: 'الهداف الجزائرية TV HD', group: 'قنوات رياضية عربية متنوعة', order: 125 };
    if (combined.includes('nile') || combined.includes('نايل')) return { name: 'قناة نايل سبورت المصرية HD', group: 'قنوات أون تايم سبورت', order: 106 };
    if (combined.includes('ksa') || combined.includes('السعودية الرياضية')) return { name: 'السعودية الرياضية 1 HD', group: 'قنوات رياضية عربية متنوعة', order: 111 };
    if (combined.includes('ahly') || combined.includes('الأهلي')) return { name: 'قناة الأهلي المصري HD', group: 'قنوات رياضية عربية متنوعة', order: 112 };
    if (combined.includes('zamalek') || combined.includes('الزمالك')) return { name: 'قناة الزمالك TV HD', group: 'قنوات رياضية عربية متنوعة', order: 113 };
    if (combined.includes('iraqia') || combined.includes('العراقية')) return { name: 'قناة العراقية الرياضية HD', group: 'قنوات رياضية عربية متنوعة', order: 114 };
    if (combined.includes('rabiaa') || combined.includes('الرابعة')) return { name: 'قناة الرابعة الرياضية العراقية HD', group: 'قنوات رياضية عربية متنوعة', order: 115 };
    if (combined.includes('mosari3') || combined.includes('مصارع')) return { name: 'قناة مصارع HD', group: 'قنوات رياضية عربية متنوعة', order: 129 };
    if (combined.includes('اعادة') || combined.includes('caf2024')) return { name: 'إعادة المباريات الحصرية', group: 'قنوات رياضية عربية متنوعة', order: 130 };

    // 6. Moroccan Arryadia (الرياضية المغربية)
    if (combined.includes('arryadia') || combined.includes('arriadia') || slug.includes('arryadia') || slug.includes('arriadia') || r === 'الرياضية') {
      if (combined.includes('tnt')) return { name: 'الرياضية المغربية TNT HD', group: 'قنوات الرياضية المغربية', order: 90 };
      if (combined.includes('snrt') || slug.includes('maroc')) return { name: 'الرياضية المغربية (SNRT)', group: 'قنوات الرياضية المغربية', order: 91 };
      if (hasNum(1) || slug.includes('hd-1')) return { name: 'الرياضية المغربية 1 HD', group: 'قنوات الرياضية المغربية', order: 92 };
      if (hasNum(2)) return { name: 'الرياضية المغربية 2 HD', group: 'قنوات الرياضية المغربية', order: 93 };
      if (hasNum(3)) return { name: 'الرياضية المغربية 3 HD', group: 'قنوات الرياضية المغربية', order: 94 };
      if (hasNum(4)) return { name: 'الرياضية المغربية 4 HD', group: 'قنوات الرياضية المغربية', order: 95 };
      return { name: 'الرياضية المغربية HD', group: 'قنوات الرياضية المغربية', order: 91 };
    }

    // 7. beIN Sports Premium
    if (combined.includes('premium') && (combined.includes('bein') || combined.includes('bn') || slug.includes('bein'))) {
      if (hasNum(1) || combined.includes('1')) return { name: 'beIN Sports 1 Premium HD', group: 'قنوات beIN Sports (Premium & Max)', order: 20 };
      if (hasNum(2) || combined.includes('2')) return { name: 'beIN Sports 2 Premium HD', group: 'قنوات beIN Sports (Premium & Max)', order: 21 };
      if (hasNum(3) || combined.includes('3')) return { name: 'beIN Sports 3 Premium HD', group: 'قنوات beIN Sports (Premium & Max)', order: 22 };
    }

    // 8. beIN Sports Max
    if (combined.includes('max') && (combined.includes('bein') || combined.includes('bn') || slug.includes('bein'))) {
      for (let n = 6; n >= 1; n--) {
        if (hasNum(n)) return { name: `beIN Sports Max ${n} HD`, group: 'قنوات beIN Sports (Premium & Max)', order: 24 + n };
      }
    }

    // 9. beIN Sports Xtra (Explicitly verify bein/bn)
    if ((combined.includes('bein') || combined.includes('bn') || slug.includes('bein')) && (combined.includes('xtra') || combined.includes('extra'))) {
      if (hasNum(1)) return { name: 'beIN Sports 1 Xtra HD', group: 'قنوات beIN Sports (Xtra & Events)', order: 35 };
      if (hasNum(2)) return { name: 'beIN Sports 2 Xtra HD', group: 'قنوات beIN Sports (Xtra & Events)', order: 36 };
      if (hasNum(3)) return { name: 'beIN Sports 3 Xtra HD', group: 'قنوات beIN Sports (Xtra & Events)', order: 37 };
    }

    // 10. AFCON (Checked BEFORE AFC because afcon contains afc)
    if (combined.includes('afcon')) {
      if (hasNum(1)) return { name: 'beIN Sports AFCON 1 HD', group: 'قنوات beIN Sports (Xtra & Events)', order: 44 };
      if (hasNum(2)) return { name: 'beIN Sports AFCON 2 HD', group: 'قنوات beIN Sports (Xtra & Events)', order: 45 };
    }

    // 11. AFC
    if (/\bafc\b/i.test(combined) || combined.includes('afc-')) {
      if (hasNum(1)) return { name: 'beIN Sports AFC 1 HD', group: 'قنوات beIN Sports (Xtra & Events)', order: 40 };
      if (hasNum(2)) return { name: 'beIN Sports AFC 2 HD', group: 'قنوات beIN Sports (Xtra & Events)', order: 41 };
    }

    // 12. Asian Cup
    if (combined.includes('asia')) {
      if (hasNum(1)) return { name: 'beIN Sports Asian Cup 1 HD', group: 'قنوات beIN Sports (Xtra & Events)', order: 42 };
      if (hasNum(2)) return { name: 'beIN Sports Asian Cup 2 HD', group: 'قنوات beIN Sports (Xtra & Events)', order: 43 };
    }

    if (combined.includes('4k') || slug.includes('44444')) return { name: 'beIN Sports 4K', group: 'قنوات beIN Sports', order: 15 };
    if (combined.includes('news') && (combined.includes('bein') || combined.includes('bn') || slug.includes('bein'))) return { name: 'beIN Sports الإخبارية HD', group: 'قنوات beIN Sports', order: 14 };
    if (combined.includes('open') || slug.includes('beinsport-open')) return { name: 'beIN Sports المفتوحة HD', group: 'قنوات beIN Sports', order: 13 };

    // 13. beIN Sports Main (1 to 12)
    if (combined.includes('bein') || combined.includes('bn') || slug.includes('bein')) {
      for (let n = 12; n >= 1; n--) {
        if (hasNum(n)) {
          return { name: `beIN Sports ${n} HD`, group: 'قنوات beIN Sports', order: n };
        }
      }
    }

    // 14. International Sports (Sport TV)
    if (combined.includes('sport-tv') || combined.includes('sport tv') || combined.includes('sport-tvv')) {
      for (let n = 5; n >= 1; n--) {
        if (hasNum(n)) return { name: `Sport TV ${n} HD`, group: 'قنوات رياضية دولية', order: 140 + (n - 1) };
      }
    }

    const clean = r
      .replace(/^مشاهدة\s+قناة\s+/i, '')
      .replace(/^مشاهده\s+قناه\s+/i, '')
      .replace(/^قناة\s+/i, '')
      .replace(/\s*بث\s*مباشر.*$/i, '')
      .replace(/\s*live.*$/i, '')
      .replace(/\s*[-|–]\s*(?:aflam4you|koora).*$/i, '')
      .trim() || 'قناة رياضية مباشرة';

    return { name: clean, group: 'قنوات رياضية متنوعة', order: 180 };
  }

  private extractOrderIndex(name: string): number {
    const m = name.match(/\b(\d+)\b/);
    return m ? parseInt(m[1], 10) : 99;
  }
}

export const liveHunterService = new LiveHunterService();
