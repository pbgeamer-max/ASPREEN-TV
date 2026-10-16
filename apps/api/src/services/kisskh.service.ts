import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

// Static lookup table from KissKH deobfuscation
const shiftedArr: string[] = [
  '39aXORCP', 'toUpperCase', '87280owbbkp', '6AzawBg', 'fromCharCode',
  'toString', 'splice', 'mg3c3b04ba', 'substr', '9634ttJadP',
  'length', 'referrer', '499416bEetdB', 'platform', 'appCodeName',
  'navigator', '359664FzBQCJ', '12yJxJzi', 'userAgent', '1065160icGOUk',
  'toLowerCase', 'document', 'push', 'charCodeAt', 'undefined',
  '178276lBUtOp', 'join', '1766601DKvkfN'
];

function _0x3a8d(idx: number): string {
  return shiftedArr[idx - 0x10a];
}

const _0x54b991 = (function () {
  function _0x1b25b9(_0x3378d3: string): [number[], number] {
    const _0xb4c3 = _0x3a8d;
    const _0x186fc8 = _0x3378d3.length;
    const _0x5ac8cf: number[] = [];
    for (let _0x2ccc5f = 0; _0x2ccc5f < _0x186fc8; _0x2ccc5f++) {
      _0x5ac8cf[_0x2ccc5f >>> 2] |= (0xff & _0x3378d3.charCodeAt(_0x2ccc5f)) << (24 - (_0x2ccc5f % 4) * 8);
    }
    return [_0x5ac8cf, _0x186fc8];
  }

  function _0x1c779c(_0x3ff981: number[], _0x459037: number): string {
    const _0x220b47: string[] = [];
    for (let _0x44ccb3 = 0; _0x44ccb3 < _0x459037; _0x44ccb3++) {
      _0x220b47.push(
        (((_0x3ff981[_0x44ccb3 >>> 2] >>> (24 - (_0x44ccb3 % 4) * 8)) & 0xff).toString(16).padStart(2, '0'))
      );
    }
    return _0x220b47.join('');
  }

  function _0x12af79(_0x4dcec4: string): string {
    return (_0x4dcec4 || '').substr(0, 48);
  }

  function _0x70dbf4(_0x524c4a: string): number {
    let _0x109c6f = 0;
    const _0x5ebb16 = _0x524c4a.length;
    for (let _0x419dc5 = 0; _0x419dc5 < _0x5ebb16; _0x419dc5++) {
      _0x109c6f = (_0x109c6f << 5) - _0x109c6f + _0x524c4a.charCodeAt(_0x419dc5);
    }
    return _0x109c6f;
  }

  function _0x29e11d(_0x4440b3: string): string {
    const _0x384f5f = 16 - (_0x4440b3.length % 16);
    for (let _0x120ea8 = 0; _0x120ea8 < _0x384f5f; ++_0x120ea8) {
      _0x4440b3 += String.fromCharCode(_0x384f5f);
    }
    return _0x4440b3;
  }

  function _0xaf4f42(_0x1493a6: number[]): void {
    const _0x5c4ece = _0x1493a6.length;
    for (let _0x3835b2 = 0; _0x3835b2 < _0x5c4ece; _0x3835b2 += 4) {
      _0x3505d7(_0x1493a6, _0x3835b2);
    }
  }

  const _0x6b7b62: number[][] = [
    [
      0x4f6bdaa3, -0x61d07350, 0x7f5e722d, -0x61210cec, 0x536620a8, -0x32b653e8,
      -0x4de821cb, 0x2cc92d21, -0x73412227, 0x41f771c1, -0xc1f500c, -0x20d67d2b,
      0x2dadde47, 0x6c5aaf86, -0x6045ff8e, 0x409382a7, -0x6417db2, -0x6a1bd238,
      0xa5e2dba, 0x4acdaf1d, 0x54c72698, -0x3edcf4b0, -0x3482d916, -0x7e4f7609,
      -0x6c9fb16c, 0x524345c4, -0x66c19cd2, 0x188eead9, -0x351884c7, -0x675bc103,
      0x19a5dd3, 0x1914b70a, -0x4fb1e313, 0x28ea2210, 0x29707fc3, 0x3064c8c9,
      -0x17593e17, -0x3fb31c07, -0x16c363c6, -0x26a7ab0d, -0x4b793324, 0x74ca2f25,
      -0x62094ce1, 0x44aee7ec
    ]
  ];

  (function () {
    const _0x43be17: number[] = [];
    const _0x42a74d: number[] = [];
    const _0xb4bd43: number[] = [];
    const _0x25f5e6: number[] = [];
    const _0x5d5f77: number[] = [];
    const _0x2de806: number[] = [];
    for (let _0x21abca = 0; _0x21abca < 256; _0x21abca++) {
      _0x2de806[_0x21abca] = _0x21abca < 128 ? _0x21abca << 1 : (_0x21abca << 1) ^ 283;
    }
    let _0x2119ec = 0;
    let _0x1a0508 = 0;
    for (let _0x11eabb = 0; _0x11eabb < 256; _0x11eabb++) {
      let _0x5034cc =
        _0x1a0508 ^ (_0x1a0508 << 1) ^ (_0x1a0508 << 2) ^ (_0x1a0508 << 3) ^ (_0x1a0508 << 4);
      _0x5034cc = ((_0x5034cc >>> 8) ^ (0xff & _0x5034cc) ^ 99);
      _0x43be17[_0x2119ec] = _0x5034cc;
      const _0x580af8 = _0x2de806[_0x2119ec];
      const _0x354320 = _0x2de806[_0x2de806[_0x580af8]];
      const _0x410b1f =
        (257 * _0x2de806[_0x5034cc]) ^ (16843008 * _0x5034cc);
      _0x42a74d[_0x2119ec] = (_0x410b1f << 24) | (_0x410b1f >>> 8);
      _0xb4bd43[_0x2119ec] = (_0x410b1f << 16) | (_0x410b1f >>> 16);
      _0x25f5e6[_0x2119ec] = (_0x410b1f << 8) | (_0x410b1f >>> 24);
      _0x5d5f77[_0x2119ec] = _0x410b1f;
      if (_0x2119ec) {
        _0x2119ec = _0x580af8 ^ _0x2de806[_0x2de806[_0x2de806[_0x354320 ^ _0x580af8]]];
        _0x1a0508 ^= _0x2de806[_0x2de806[_0x1a0508]];
      } else {
        _0x2119ec = _0x1a0508 = 1;
      }
    }
    _0x6b7b62.push(_0x42a74d);
    _0x6b7b62.push(_0xb4bd43);
    _0x6b7b62.push(_0x25f5e6);
    _0x6b7b62.push(_0x5d5f77);
    _0x6b7b62.push(_0x43be17);
  })();

  function _0x3505d7(_0x13a508: number[], _0x5baaa1: number): void {
    const [_0x458390, _0x32aa26, _0x53dadc, _0x4810d1, _0x3c0f1b, _0x128bff] = _0x6b7b62;
    let _0x21ba3f: number[];
    if (_0x5baaa1 === 0) {
      _0x21ba3f = [0x1504af3, 0x56e619cf, 0x2e42bba6, -0x73c08f07];
    } else {
      _0x21ba3f = _0x13a508.slice(_0x5baaa1 - 4, _0x5baaa1);
    }
    for (let _0x5b9637 = 0; _0x5b9637 < 4; _0x5b9637++) {
      _0x13a508[_0x5baaa1 + _0x5b9637] ^= _0x21ba3f[_0x5b9637];
    }
    let _0x116405 = 10;
    let _0x4d3231 = _0x13a508[_0x5baaa1] ^ _0x458390[0];
    let _0x1f3a4f = _0x13a508[_0x5baaa1 + 1] ^ _0x458390[1];
    let _0x598b52 = _0x13a508[_0x5baaa1 + 2] ^ _0x458390[2];
    let _0x2265d4 = _0x13a508[_0x5baaa1 + 3] ^ _0x458390[3];
    let _0xcb5ec5 = 4;
    for (let _0x5e2dc7 = 1; _0x5e2dc7 < _0x116405; _0x5e2dc7++) {
      const _0x34de78 =
        _0x32aa26[_0x4d3231 >>> 24] ^
        _0x53dadc[(_0x1f3a4f >>> 16) & 0xff] ^
        _0x4810d1[(_0x598b52 >>> 8) & 0xff] ^
        _0x3c0f1b[0xff & _0x2265d4] ^
        _0x458390[_0xcb5ec5++];
      const _0x42d7a0 =
        _0x32aa26[_0x1f3a4f >>> 24] ^
        _0x53dadc[(_0x598b52 >>> 16) & 0xff] ^
        _0x4810d1[(_0x2265d4 >>> 8) & 0xff] ^
        _0x3c0f1b[0xff & _0x4d3231] ^
        _0x458390[_0xcb5ec5++];
      const _0x4a8c71 =
        _0x32aa26[_0x598b52 >>> 24] ^
        _0x53dadc[(_0x2265d4 >>> 16) & 0xff] ^
        _0x4810d1[(_0x4d3231 >>> 8) & 0xff] ^
        _0x3c0f1b[0xff & _0x1f3a4f] ^
        _0x458390[_0xcb5ec5++];
      _0x2265d4 =
        _0x32aa26[_0x2265d4 >>> 24] ^
        _0x53dadc[(_0x4d3231 >>> 16) & 0xff] ^
        _0x4810d1[(_0x1f3a4f >>> 8) & 0xff] ^
        _0x3c0f1b[0xff & _0x598b52] ^
        _0x458390[_0xcb5ec5++];
      _0x4d3231 = _0x34de78;
      _0x1f3a4f = _0x42d7a0;
      _0x598b52 = _0x4a8c71;
    }
    const _0x34de78 =
      ((_0x128bff[_0x4d3231 >>> 24] << 24) |
        (_0x128bff[(_0x1f3a4f >>> 16) & 0xff] << 16) |
        (_0x128bff[(_0x598b52 >>> 8) & 0xff] << 8) |
        _0x128bff[0xff & _0x2265d4]) ^
      _0x458390[_0xcb5ec5++];
    const _0x42d7a0 =
      ((_0x128bff[_0x1f3a4f >>> 24] << 24) |
        (_0x128bff[(_0x598b52 >>> 16) & 0xff] << 16) |
        (_0x128bff[(_0x2265d4 >>> 8) & 0xff] << 8) |
        _0x128bff[0xff & _0x4d3231]) ^
      _0x458390[_0xcb5ec5++];
    const _0x4a8c71 =
      ((_0x128bff[_0x598b52 >>> 24] << 24) |
        (_0x128bff[(_0x2265d4 >>> 16) & 0xff] << 16) |
        (_0x128bff[(_0x4d3231 >>> 8) & 0xff] << 8) |
        _0x128bff[0xff & _0x1f3a4f]) ^
      _0x458390[_0xcb5ec5++];
    _0x2265d4 =
      ((_0x128bff[_0x2265d4 >>> 24] << 24) |
        (_0x128bff[(_0x4d3231 >>> 16) & 0xff] << 16) |
        (_0x128bff[(_0x1f3a4f >>> 8) & 0xff] << 8) |
        _0x128bff[0xff & _0x598b52]) ^
      _0x458390[_0xcb5ec5++];
    _0x13a508[_0x5baaa1] = _0x34de78;
    _0x13a508[_0x5baaa1 + 1] = _0x42d7a0;
    _0x13a508[_0x5baaa1 + 2] = _0x4a8c71;
    _0x13a508[_0x5baaa1 + 3] = _0x2265d4;
  }

  return function (
    _0x3be93d: any,
    _0x3e48ea: any,
    _0xbf2c16: any,
    _0x576527: any,
    _0x454b79: any,
    _0x361753?: any,
    _0x3cdffa?: any,
    _0x2fa7de?: any,
    _0xdaf7bd?: any,
    _0x59e242?: any,
    _0x5674ce?: any
  ): string {
    const _0x5acc2f = _0x3a8d;
    if (typeof _0x361753 === 'undefined') _0x361753 = 'https://kisskh.co';
    if (typeof _0x3cdffa === 'undefined') _0x3cdffa = UA;
    if (typeof _0x2fa7de === 'undefined') _0x2fa7de = '';
    if (typeof _0xdaf7bd === 'undefined') _0xdaf7bd = 'Win32';
    if (typeof _0x59e242 === 'undefined') _0x59e242 = 'Netscape';
    if (typeof _0x5674ce === 'undefined') _0x5674ce = 'Mozilla';

    const _0x5989e7: any[] = [
      '',
      _0x3be93d,
      _0x3e48ea,
      _0x5acc2f(0x111),
      _0xbf2c16,
      _0x576527,
      _0x454b79,
      _0x12af79(_0x361753),
      _0x12af79((_0x3cdffa || '').toLowerCase()),
      _0x12af79(_0x2fa7de),
      _0xdaf7bd,
      _0x59e242,
      _0x5674ce,
      '00',
      ''
    ];
    _0x5989e7.splice(1, 0, _0x70dbf4(_0x5989e7.join('|')));
    const _0x278f64 = _0x29e11d(_0x5989e7.join('|'));
    const [_0x3db385, _0x2f9d88] = _0x1b25b9(_0x278f64);
    _0xaf4f42(_0x3db385);
    return _0x1c779c(_0x3db385, _0x2f9d88).toUpperCase();
  };
})();

export interface KisskhDramaSummary {
  id: number;
  title: string;
  thumbnail: string;
  episodesCount: number;
  label: string | null;
  type: string;
  country?: string;
  status?: string;
}

export interface KisskhDramaDetail {
  id: number;
  title: string;
  description: string;
  thumbnail: string;
  releaseDate: string;
  country: string;
  status: string;
  type: string;
  trailer: string | null;
  episodes: Array<{
    id: number;
    number: number;
    sub: number;
  }>;
}

export interface KisskhResolvedEpisode {
  videoUrl: string;
  backupUrl: string | null;
  type: number;
}

export interface KisskhSubtitleTrack {
  src: string;
  label: string;
  land: string;
  default: boolean;
}

class KisskhService {
  private cache = new Map<string, { data: any; expiresAt: number }>();
  private localCatalog: { updatedAt: string; totalCount: number; items: any[] } | null = null;
  private localDramas: Record<string, any> | null = null;
  private localStreams: Record<string, { videoUrl: string; backupUrl: string | null; type: number }> | null = null;
  private localSubtitles: Record<string, KisskhSubtitleTrack[]> | null = null;

  private getCatalogFilePath(): string {
    const candidates = [
      path.join(process.cwd(), 'data', 'kisskh_catalog.json'),
      path.join(process.cwd(), '..', '..', 'data', 'kisskh_catalog.json'),
      path.join(__dirname, '..', '..', 'data', 'kisskh_catalog.json'),
      path.join(__dirname, '..', '..', '..', 'data', 'kisskh_catalog.json'),
      '/app/data/kisskh_catalog.json',
    ];

    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return path.join(process.cwd(), 'data', 'kisskh_catalog.json');
  }

  private getDramasFilePath(): string {
    const candidates = [
      path.join(process.cwd(), 'data', 'kisskh_dramas.json'),
      path.join(process.cwd(), '..', '..', 'data', 'kisskh_dramas.json'),
      path.join(__dirname, '..', '..', 'data', 'kisskh_dramas.json'),
      path.join(__dirname, '..', '..', '..', 'data', 'kisskh_dramas.json'),
      '/app/data/kisskh_dramas.json',
    ];

    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return path.join(process.cwd(), 'data', 'kisskh_dramas.json');
  }

  private getStreamsFilePath(): string {
    const candidates = [
      path.join(process.cwd(), 'data', 'kisskh_streams.json'),
      path.join(process.cwd(), '..', '..', 'data', 'kisskh_streams.json'),
      path.join(__dirname, '..', '..', 'data', 'kisskh_streams.json'),
      path.join(__dirname, '..', '..', '..', 'data', 'kisskh_streams.json'),
      '/app/data/kisskh_streams.json',
    ];

    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return path.join(process.cwd(), 'data', 'kisskh_streams.json');
  }

  private getSubtitlesFilePath(): string {
    const candidates = [
      path.join(process.cwd(), 'data', 'kisskh_subtitles.json'),
      path.join(process.cwd(), '..', '..', 'data', 'kisskh_subtitles.json'),
      path.join(__dirname, '..', '..', 'data', 'kisskh_subtitles.json'),
      path.join(__dirname, '..', '..', '..', 'data', 'kisskh_subtitles.json'),
      '/app/data/kisskh_subtitles.json',
    ];

    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return path.join(process.cwd(), 'data', 'kisskh_subtitles.json');
  }

  private loadLocalData(): void {
    if (!this.localCatalog) {
      const catPath = this.getCatalogFilePath();
      if (fs.existsSync(catPath)) {
        try {
          this.localCatalog = JSON.parse(fs.readFileSync(catPath, 'utf8'));
        } catch (e: any) {
          console.error('[KissKH Service] Error loading local catalog:', e.message);
        }
      }
    }

    if (!this.localDramas) {
      const dramaPath = this.getDramasFilePath();
      if (fs.existsSync(dramaPath)) {
        try {
          this.localDramas = JSON.parse(fs.readFileSync(dramaPath, 'utf8'));
        } catch (e: any) {
          console.error('[KissKH Service] Error loading local dramas:', e.message);
        }
      }
    }

    if (!this.localStreams) {
      const streamPath = this.getStreamsFilePath();
      if (fs.existsSync(streamPath)) {
        try {
          this.localStreams = JSON.parse(fs.readFileSync(streamPath, 'utf8'));
        } catch (e: any) {
          console.error('[KissKH Service] Error loading local streams:', e.message);
        }
      }
    }

    if (!this.localSubtitles) {
      const subPath = this.getSubtitlesFilePath();
      if (fs.existsSync(subPath)) {
        try {
          this.localSubtitles = JSON.parse(fs.readFileSync(subPath, 'utf8'));
        } catch (e: any) {
          console.error('[KissKH Service] Error loading local subtitles:', e.message);
        }
      }
    }
  }

  public generateVideoKKey(episodeId: number | string): string {
    const appVer = '2.8.10';
    const viGuid = '62f176f3bb1b5b8e70e39932ad34a0c7';
    const platformVer = 4830201;
    const appName = 'kisskh';
    return _0x54b991(
      episodeId,
      null,
      appVer,
      viGuid,
      platformVer,
      appName,
      appName,
      appName,
      appName,
      appName,
      appName
    );
  }

  public generateSubKKey(episodeId: number | string): string {
    const appVer = '2.8.10';
    const subGuid = 'VgV52sWhwvBSf8BsM3BRY9weWiiCbtGp';
    const platformVer = 4830201;
    const appName = 'kisskh';
    return _0x54b991(
      episodeId,
      null,
      appVer,
      subGuid,
      platformVer,
      appName,
      appName,
      appName,
      appName,
      appName,
      appName
    );
  }

  private mirrorIndex = 0;

  /**
   * Helper that requests active KissKH mirrors with mobile Dart UA (kisskh.co -> kisskh.is -> kisskh.do -> kisskh.ovh)
   */
  private async fetchFromMirror(endpoint: string, isImage = false): Promise<Response> {
    const allDomains = ['kisskh.do', 'kisskh.la', 'kisskh.id', 'kisskh.is', 'kisskh.ovh', 'kisskh.co'];
    const startIndex = (this.mirrorIndex++) % allDomains.length;
    const domains = [...allDomains.slice(startIndex), ...allDomains.slice(0, startIndex)];
    const mobileUas = ['Dart/3.0 (dart:io)', 'okhttp/4.9.3', UA];
    let lastError: Error | null = null;

    for (const domain of domains) {
      for (const userAgent of mobileUas) {
        try {
          const fullUrl = `https://${domain}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
          const headers: Record<string, string> = {
            'User-Agent': userAgent,
            Accept: '*/*',
          };

          if (!userAgent.includes('Dart') && !userAgent.includes('okhttp')) {
            headers['Referer'] = `https://${domain}/`;
          }

          const res = await fetch(fullUrl, { headers, signal: AbortSignal.timeout(3500) });
          if (res.ok) {
            return res;
          }

          const errText = await res.text().catch(() => '');
          lastError = new Error(`${domain} returned HTTP ${res.status}: ${errText.substring(0, 100)}`);
          if (res.status === 403 || res.status === 429) {
            // WAF or Rate limit on this domain: immediately switch to the next mirror
            break;
          }
        } catch (err: any) {
          lastError = err;
        }
      }
    }

    throw lastError || new Error('All KissKH mirror endpoints failed');
  }

  /**
   * Retrieves paginated Asian drama & movie catalog or searches titles
   */
  public async getCatalog(params: {
    page?: number;
    type?: number;
    country?: number;
    status?: number;
    order?: number;
    pageSize?: number;
    q?: string;
  }): Promise<{ total: number; page: number; pageSize: number; items: KisskhDramaSummary[] }> {
    const page = params.page || 1;
    const pageSize = params.pageSize || 30;
    const type = params.type ?? 0;
    const country = params.country ?? 0;
    const status = params.status ?? 0;
    const order = params.order ?? 1;
    const q = (params.q || '').trim();

    const cacheKey = `cat_${page}_${pageSize}_${type}_${country}_${status}_${order}_${q}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    this.loadLocalData();

    // 1. If local harvested catalog is present, serve with 0ms latency and 100% reliability
    if (this.localCatalog && this.localCatalog.items && this.localCatalog.items.length > 0) {
      let filtered = this.localCatalog.items;
      if (q) {
        const queryLower = q.toLowerCase();
        filtered = filtered.filter((item: any) => item.title && item.title.toLowerCase().includes(queryLower));
      } else {
        // Prioritize titles with working cached episodes so EVERY PAGE user visits works 100%
        filtered = [...filtered].sort((a: any, b: any) => {
          const aDrama = this.localDramas?.[String(a.id)];
          const bDrama = this.localDramas?.[String(b.id)];
          const aCount = aDrama?.episodes?.filter((e: any) => this.localStreams?.[String(e.id)]).length || 0;
          const bCount = bDrama?.episodes?.filter((e: any) => this.localStreams?.[String(e.id)]).length || 0;
          return bCount - aCount;
        });
      }

      const total = filtered.length;
      const start = (page - 1) * pageSize;
      const paginated = filtered.slice(start, start + pageSize);

      const items: KisskhDramaSummary[] = paginated.map((item: any) => ({
        id: item.id,
        title: item.title,
        thumbnail: item.thumbnail,
        episodesCount: item.episodesCount || 1,
        label: item.label || null,
        type: item.episodesCount > 1 ? 'TVSeries' : 'Movie',
      }));

      const result = {
        total,
        page,
        pageSize,
        items,
      };

      this.cache.set(cacheKey, {
        data: result,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

      return result;
    }

    // 2. Fallback to live mirror if local catalog is not yet loaded
    let endpoint: string;
    if (q) {
      endpoint = `/api/DramaList/Search?q=${encodeURIComponent(q)}`;
    } else {
      endpoint = `/api/DramaList/List?page=${page}&type=${type}&sub=0&country=${country}&status=${status}&order=${order}&pageSize=${pageSize}`;
    }

    const res = await this.fetchFromMirror(endpoint);
    const json = await res.json();
    let total = 0;
    let items: KisskhDramaSummary[] = [];

    if (q) {
      const rawList = Array.isArray(json) ? json : json.data || [];
      total = rawList.length;
      items = rawList.map((d: any) => ({
        id: d.id,
        title: d.title,
        thumbnail: d.thumbnail,
        episodesCount: d.episodesCount || 1,
        label: d.label || null,
        type: d.type || (d.episodesCount > 1 ? 'TVSeries' : 'Movie'),
      }));
    } else {
      total = json.totalCount || 0;
      items = (json.data || []).map((d: any) => ({
        id: d.id,
        title: d.title,
        thumbnail: d.thumbnail,
        episodesCount: d.episodesCount || 1,
        label: d.label || null,
        type: d.type || (d.episodesCount > 1 ? 'TVSeries' : 'Movie'),
      }));
    }

    const result = {
      total,
      page,
      pageSize,
      items,
    };

    this.cache.set(cacheKey, {
      data: result,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    return result;
  }

  /**
   * Retrieves single drama details and full episode list
   */
  public async getDrama(id: number | string): Promise<KisskhDramaDetail> {
    const cacheKey = `drama_${id}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    this.loadLocalData();
    const strId = String(id);

    // 1. Check local pre-harvested dramas
    if (this.localDramas && this.localDramas[strId]) {
      const d = this.localDramas[strId];
      const result: KisskhDramaDetail = {
        id: d.id,
        title: d.title,
        description: d.description || '',
        thumbnail: d.thumbnail,
        releaseDate: d.releaseDate || '2024',
        country: d.country || 'Asian',
        status: d.status || 'Completed',
        type: d.type || 'TVSeries',
        trailer: d.trailer || null,
        episodes: (d.episodes || []).map((ep: any) => ({
          id: ep.id,
          number: ep.number,
          sub: ep.sub,
        })),
      };

      this.cache.set(cacheKey, {
        data: result,
        expiresAt: Date.now() + 30 * 60 * 1000,
      });

      return result;
    }

    // 2. Try fetching from live mirror
    try {
      const res = await this.fetchFromMirror(`/api/DramaList/Drama/${id}`);
      const drama = await res.json();
      const result: KisskhDramaDetail = {
        id: drama.id,
        title: drama.title,
        description: drama.description || '',
        thumbnail: drama.thumbnail,
        releaseDate: drama.releaseDate || '',
        country: drama.country || 'Asian',
        status: drama.status || 'Completed',
        type: drama.type || 'TVSeries',
        trailer: drama.trailer || null,
        episodes: (drama.episodes || []).map((ep: any) => ({
          id: ep.id,
          number: ep.number,
          sub: ep.sub,
        })),
      };

      this.cache.set(cacheKey, {
        data: result,
        expiresAt: Date.now() + 30 * 60 * 1000,
      });

      return result;
    } catch (err: any) {
      // 3. Graceful fallback from catalog metadata if upstream is blocked
      if (this.localCatalog) {
        const item = this.localCatalog.items.find((x: any) => String(x.id) === strId);
        if (item) {
          const fallbackEpisodes = [];
          const count = item.episodesCount || 1;
          for (let i = 1; i <= count; i++) {
            fallbackEpisodes.push({
              id: item.id * 1000 + i,
              number: i,
              sub: 1,
            });
          }
          const result: KisskhDramaDetail = {
            id: item.id,
            title: item.title,
            description: `مشاهدة وتحميل ${item.title} بجودة عالية مع الترجمة الكاملة على Aspreen TV.`,
            thumbnail: item.thumbnail,
            releaseDate: '2024',
            country: 'Asian',
            status: 'Completed',
            type: count > 1 ? 'TVSeries' : 'Movie',
            trailer: null,
            episodes: fallbackEpisodes,
          };
          return result;
        }
      }
      throw err;
    }
  }

  /**
   * Resolves episode streaming URL by generating kkey and fetching .png endpoint
   */
  public async resolveEpisode(episodeId: number | string): Promise<KisskhResolvedEpisode> {
    const cacheKey = `ep_stream_${episodeId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    this.loadLocalData();
    const strId = String(episodeId);
    if (this.localStreams && this.localStreams[strId]) {
      const s = this.localStreams[strId];
      const result: KisskhResolvedEpisode = {
        videoUrl: s.videoUrl,
        backupUrl: s.backupUrl || null,
        type: s.type || 0,
      };
      this.cache.set(cacheKey, {
        data: result,
        expiresAt: Date.now() + 2 * 60 * 60 * 1000,
      });
      return result;
    }

    // Auto-map fallback composite episode IDs (e.g. 954016 -> drama 954, ep 16 or 13581001 -> drama 13581, ep 1)
    const numId = Number(episodeId);
    if (!isNaN(numId) && numId >= 1000) {
      const dramaId = Math.floor(numId / 1000);
      const epNum = numId % 1000;
      let dramaObj = this.localDramas?.[String(dramaId)];
      if (!dramaObj) {
        try {
          dramaObj = await this.getDrama(dramaId);
        } catch {}
      }
      if (dramaObj && Array.isArray(dramaObj.episodes)) {
        const matchingEp = dramaObj.episodes.find((e: any) => Math.floor(Number(e.number)) === epNum);
        if (matchingEp && matchingEp.id && String(matchingEp.id) !== strId) {
          const resolved = await this.resolveEpisode(matchingEp.id);
          this.cache.set(cacheKey, {
            data: resolved,
            expiresAt: Date.now() + 2 * 60 * 60 * 1000,
          });
          return resolved;
        }
      }
    }

    const kkey = this.generateVideoKKey(episodeId);
    const res = await this.fetchFromMirror(`/api/DramaList/Episode/${episodeId}.png?kkey=${kkey}`, true);
    const data = await res.json();
    let videoUrl = data.Video || '';
    const backupUrl = data.ThirdParty || null;
    const type = data.Type || 1;

    // In case Video is AES encrypted, decrypt using known KissKH AES key & IV
    if (videoUrl && !videoUrl.startsWith('http://') && !videoUrl.startsWith('https://')) {
      try {
        const key = Buffer.from('8056483646328763', 'utf8');
        const iv = Buffer.from('6852612370185273', 'utf8');
        const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
        let decrypted = decipher.update(videoUrl, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        if (decrypted.startsWith('http')) {
          videoUrl = decrypted;
        }
      } catch (err) {
        console.warn('KissKH AES decryption fallback failed:', err);
      }
    }

    if (!videoUrl && !backupUrl) {
      throw new Error('Episode stream source is currently unavailable or expired');
    }

    const result: KisskhResolvedEpisode = {
      videoUrl,
      backupUrl,
      type,
    };

    // Cache stream for 2 hours
    this.cache.set(cacheKey, {
      data: result,
      expiresAt: Date.now() + 2 * 60 * 60 * 1000,
    });

    return result;
  }

  /**
   * Fetches multilingual subtitles for an episode
   */
  public async getSubtitles(episodeId: number | string): Promise<KisskhSubtitleTrack[]> {
    const cacheKey = `sub_${episodeId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    this.loadLocalData();
    const strId = String(episodeId);
    if (this.localSubtitles && this.localSubtitles[strId]) {
      const tracks = this.localSubtitles[strId];
      this.cache.set(cacheKey, {
        data: tracks,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      });
      return tracks;
    }

    // Auto-map fallback composite episode IDs (e.g. 954016 -> drama 954, ep 16 or 13581001 -> drama 13581, ep 1)
    const numId = Number(episodeId);
    if (!isNaN(numId) && numId >= 1000) {
      const dramaId = Math.floor(numId / 1000);
      const epNum = numId % 1000;
      let dramaObj = this.localDramas?.[String(dramaId)];
      if (!dramaObj) {
        try {
          dramaObj = await this.getDrama(dramaId);
        } catch {}
      }
      if (dramaObj && Array.isArray(dramaObj.episodes)) {
        const matchingEp = dramaObj.episodes.find((e: any) => Math.floor(Number(e.number)) === epNum);
        if (matchingEp && matchingEp.id && String(matchingEp.id) !== strId) {
          return this.getSubtitles(matchingEp.id);
        }
      }
    }

    try {
      const subKey = this.generateSubKKey(episodeId);
      const res = await this.fetchFromMirror(`/api/Sub/${episodeId}?kkey=${subKey}`);
      const list = await res.json();
      if (!Array.isArray(list)) return [];

      const tracks: KisskhSubtitleTrack[] = list.map((item: any) => ({
        src: item.src,
        label: item.label || 'Sub',
        land: item.land || 'en',
        default: Boolean(item.default),
      }));

      this.cache.set(cacheKey, {
        data: tracks,
        expiresAt: Date.now() + 4 * 60 * 60 * 1000,
      });

      return tracks;
    } catch {
      return [];
    }
  }
}

export const kisskhService = new KisskhService();
