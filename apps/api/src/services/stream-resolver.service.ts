import https from 'https';
import http from 'http';

export function unpackJs(packed: string): string | null {
  try {
    const match = packed.match(/}\s*\(\s*'([\s\S]+?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]+?)'\.split\('\|'\)/);
    if (!match) return null;
    let p = match[1];
    const a = parseInt(match[2], 10);
    let c = parseInt(match[3], 10);
    const k = match[4].split('|');

    while (c--) {
      if (k[c]) {
        const reg = new RegExp('\\b' + c.toString(a) + '\\b', 'g');
        p = p.replace(reg, k[c]);
      }
    }
    return p;
  } catch {
    return null;
  }
}

export class StreamResolverService {
  private readonly USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  private fetchHtml(url: string, referer?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const parsed = new URL(url);
        const isHttps = parsed.protocol === 'https:';
        const client = isHttps ? https : http;

        const req = client.get(
          {
            protocol: parsed.protocol,
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            rejectUnauthorized: false,
            headers: {
              'User-Agent': this.USER_AGENT,
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Referer': referer || `${parsed.protocol}//${parsed.hostname}/`,
            },
          },
          (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              let loc = res.headers.location;
              if (!loc.startsWith('http')) {
                loc = new URL(loc, url).toString();
              }
              return this.fetchHtml(loc, referer).then(resolve).catch(reject);
            }

            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => resolve(data));
          }
        );

        req.on('error', reject);
        req.setTimeout(9000, () => {
          req.destroy();
          reject(new Error('Timeout'));
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Resolves any embed or stream URL into the pure underlying .mp4 or .m3u8 stream URL
   */
  public async resolveDirectStream(url: string): Promise<{ directUrl: string | null; title?: string }> {
    if (!url) return { directUrl: null };

    // 1. If it's already a direct video file
    if (url.includes('.mp4') || url.includes('.m3u8')) {
      return { directUrl: url };
    }

    // 2. FiveTV / 71stream.one -> Cloudflare R2 MP4
    if (url.includes('71stream.one')) {
      try {
        const html = await this.fetchHtml(url);
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
      } catch {}
    }

    // 3. Packed JS host (updown, vidmoly, etc.)
    if (
      url.includes('updown') ||
      url.includes('vidmoly') ||
      url.includes('ult4vid') ||
      url.includes('morencius')
    ) {
      try {
        const html = await this.fetchHtml(url);
        const packedMatch = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)\)\)/);
        if (packedMatch) {
          const unpacked = unpackJs(packedMatch[0]);
          if (unpacked) {
            const streamMatch =
              unpacked.match(/https?:\/\/[^\s"'<>]+\.(?:mp4|m3u8)[^\s"'<>]*/i) ||
              unpacked.match(/file\s*:\s*["']([^"']+)["']/i);
            if (streamMatch) {
              return { directUrl: streamMatch[1] || streamMatch[0] };
            }
          }
        }
      } catch {}
    }

    // 4. Streamtape direct link extraction
    if (url.includes('streamtape')) {
      try {
        const html = await this.fetchHtml(url);
        const m = html.match(/document\.getElementById\(['"]robotlink['"]\)\.innerHTML\s*=\s*['"]([^'"]+)['"]\s*\+\s*\((['"][^'"]+['"])\)\.substring\((\d+)\)\.substring\((\d+)\)/);
        if (m) {
          const part1 = m[1];
          const rawPart2 = m[2].replace(/^['"]|['"]$/g, '');
          const sub1 = parseInt(m[3], 10);
          const sub2 = parseInt(m[4], 10);
          const part2 = rawPart2.substring(sub1).substring(sub2);
          const finalUrl = (part1.startsWith('//') ? 'https:' : '') + part1 + part2;
          return { directUrl: finalUrl };
        }
        const m2 = html.match(/document\.getElementById\(['"]robotlink['"]\)\.innerHTML\s*=\s*['"]([^'"]+)['"]\s*\+\s*['"]([^'"]+)['"]/);
        if (m2) {
          const finalUrl = (m2[1].startsWith('//') ? 'https:' : '') + m2[1] + m2[2];
          return { directUrl: finalUrl };
        }
      } catch {}
    }

    // 5. OK.ru metadata
    if (url.includes('ok.ru')) {
      try {
        const html = await this.fetchHtml(url);
        const dataOptions = html.match(/data-options="([^"]+)"/i);
        if (dataOptions) {
          const decoded = JSON.parse(dataOptions[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
          if (decoded?.flashvars?.metadata) {
            const meta = JSON.parse(decoded.flashvars.metadata);
            if (meta.hlsManifestUrl) {
              return { directUrl: meta.hlsManifestUrl };
            }
            if (Array.isArray(meta.videos) && meta.videos.length > 0) {
              const best = meta.videos[meta.videos.length - 1];
              return { directUrl: best.url };
            }
          }
        }
      } catch {}
    }

    // 5. Generic HTML5 <video> or <source> or file: "..." extraction for any host
    try {
      const html = await this.fetchHtml(url);
      const videoSrcMatch =
        html.match(/<video[^>]+src=["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i) ||
        html.match(/<source[^>]+src=["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i) ||
        html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)["']/i) ||
        html.match(/source\s*:\s*["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)["']/i) ||
        html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
      if (videoSrcMatch) {
        return { directUrl: videoSrcMatch[1] };
      }
    } catch {}

    return { directUrl: null };
  }
}

export const streamResolverService = new StreamResolverService();
