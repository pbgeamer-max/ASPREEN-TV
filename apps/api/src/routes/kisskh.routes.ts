import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { kisskhService } from '../services/kisskh.service';
import { settingsRepository } from '../repositories/settings.repository';
import * as http from 'http';
import * as https from 'https';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

export async function kisskhRoutes(server: FastifyInstance) {
  /**
   * Helper to verify Master API authorization (aligned with 3isk and Channels)
   */
  async function checkMasterAuth(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const settings = await settingsRepository.getSettings();

    // 1. Check if Master API is disabled
    if (settings.masterApiEnabled === false) {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.status(403).send({
        success: false,
        error: 'API_DISABLED',
        message: 'خدمة الـ API متوقفة حالياً بقرار من إدارة الموقع',
      });
      return false;
    }

    // 2. Check API Key
    const configuredKey = (settings.masterApiKey || '').trim();
    const incomingKey =
      (request.query as any)?.api_key ||
      request.headers['x-api-key'] ||
      (request.headers.authorization ? request.headers.authorization.replace(/^Bearer\s+/i, '') : '');

    const referer = request.headers.referer || '';
    const hasAdminCookie = Boolean(request.cookies && (request.cookies.__session || request.cookies.token));
    const isInternalWeb =
      hasAdminCookie ||
      referer.includes('/kisskh') ||
      referer.includes('/3isk') ||
      referer.includes('localhost') ||
      referer.includes('railway.app') ||
      request.ip === '127.0.0.1' ||
      request.ip === '::1' ||
      request.ip === '::ffff:127.0.0.1';

    if (configuredKey !== '' && !isInternalWeb) {
      if (!incomingKey || incomingKey !== configuredKey) {
        reply.header('Access-Control-Allow-Origin', '*');
        reply.status(401).send({
          success: false,
          error: 'UNAUTHORIZED',
          message: 'مفتاح الـ API غير صالح أو تم تغييره من لوحة التحكم',
        });
        return false;
      }
    }

    return true;
  }

  function getEffectiveBaseUrl(request: FastifyRequest, settings: any): string {
    const reqHost = (request.headers['x-forwarded-host'] as string) || (request.headers.host as string);
    const reqProto = (request.headers['x-forwarded-proto'] as string) || 'https';
    let effectiveBaseUrl = settings.publicStreamBaseUrl;
    if (
      (!effectiveBaseUrl || effectiveBaseUrl.includes('localhost') || effectiveBaseUrl.includes('@')) &&
      reqHost &&
      !reqHost.includes('127.0.0.1')
    ) {
      effectiveBaseUrl = `${reqProto}://${reqHost}`;
    }
    if (!effectiveBaseUrl) {
      effectiveBaseUrl = 'https://aspreen-tv-production.up.railway.app';
    }
    return effectiveBaseUrl;
  }

  /**
   * GET /catalog
   * Paginated Asian drama & movie catalog covering 13,000+ titles from A to Z
   */
  server.get(
    '/catalog',
    async (
      request: FastifyRequest<{
        Querystring: {
          page?: string;
          pageSize?: string;
          type?: string;
          country?: string;
          status?: string;
          order?: string;
          q?: string;
          api_key?: string;
        };
      }>,
      reply
    ) => {
      const isAuthed = await checkMasterAuth(request, reply);
      if (!isAuthed) return;

      const page = parseInt(request.query.page || '1', 10) || 1;
      const pageSize = parseInt(request.query.pageSize || '30', 10) || 30;
      const type = request.query.type !== undefined ? parseInt(request.query.type, 10) : 0;
      const country = request.query.country !== undefined ? parseInt(request.query.country, 10) : 0;
      const status = request.query.status !== undefined ? parseInt(request.query.status, 10) : 0;
      const order = request.query.order !== undefined ? parseInt(request.query.order, 10) : 1;
      const q = request.query.q || '';

      try {
        const result = await kisskhService.getCatalog({
          page,
          pageSize,
          type,
          country,
          status,
          order,
          q,
        });

        const settings = await settingsRepository.getSettings();
        const effectiveBaseUrl = getEffectiveBaseUrl(request, settings);
        const incomingKey = (request.query as any)?.api_key;
        const keyParam = incomingKey ? `?api_key=${encodeURIComponent(incomingKey)}` : '';

        const mappedItems = result.items.map((item) => {
          const proxiedPoster = item.thumbnail
            ? `${effectiveBaseUrl}/api/app/image-proxy?url=${encodeURIComponent(item.thumbnail)}`
            : null;
          return {
            id: item.id,
            title: item.title,
            thumbnail: proxiedPoster || item.thumbnail,
            raw_thumbnail: item.thumbnail,
            episodes_count: item.episodesCount,
            label: item.label,
            type: item.type,
            details_url: `${effectiveBaseUrl}/api/app/kisskh/drama/${item.id}${keyParam}`,
          };
        });

        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Cache-Control', 'public, max-age=60');

        return {
          success: true,
          section: 'دراما وآسيوية (KissKH Asian Dramas & Movies)',
          source: 'https://kisskh.co',
          total_titles: result.total,
          page: result.page,
          page_size: result.pageSize,
          total_pages: Math.ceil(result.total / result.pageSize),
          items: mappedItems,
        };
      } catch (err: any) {
        return reply.status(502).send({
          success: false,
          error: 'CATALOG_FETCH_FAILED',
          message: err.message,
        });
      }
    }
  );

  /**
   * GET /drama/:id
   * Details for a drama/movie with full episode list and direct streaming links
   */
  server.get(
    '/drama/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { api_key?: string };
      }>,
      reply
    ) => {
      const isAuthed = await checkMasterAuth(request, reply);
      if (!isAuthed) return;

      const { id } = request.params;
      try {
        const drama = await kisskhService.getDrama(id);
        const settings = await settingsRepository.getSettings();
        const effectiveBaseUrl = getEffectiveBaseUrl(request, settings);
        const incomingKey = (request.query as any)?.api_key;
        const keyParam = incomingKey ? `&api_key=${encodeURIComponent(incomingKey)}` : '';

        const proxiedPoster = drama.thumbnail
          ? `${effectiveBaseUrl}/api/app/image-proxy?url=${encodeURIComponent(drama.thumbnail)}`
          : null;

        const episodes = drama.episodes.map((ep) => ({
          id: ep.id,
          episode_number: ep.number,
          title: `الحلقة ${ep.number}`,
          subtitles_count: ep.sub,
          stream_url: `${effectiveBaseUrl}/api/app/kisskh/stream?epId=${ep.id}${keyParam}`,
          subtitles_url: `${effectiveBaseUrl}/api/app/kisskh/subtitles?epId=${ep.id}${keyParam}`,
        }));

        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Cache-Control', 'public, max-age=300');

        return {
          success: true,
          drama: {
            id: drama.id,
            title: drama.title,
            description: drama.description,
            thumbnail: proxiedPoster || drama.thumbnail,
            raw_thumbnail: drama.thumbnail,
            release_date: drama.releaseDate,
            country: drama.country,
            status: drama.status,
            type: drama.type,
            trailer: drama.trailer,
            episodes_count: episodes.length,
            episodes,
          },
        };
      } catch (err: any) {
        return reply.status(502).send({
          success: false,
          error: 'DRAMA_FETCH_FAILED',
          message: err.message,
        });
      }
    }
  );

  /**
   * GET /stream?epId=...
   * Rewrites HLS .m3u8 playlist through Aspreen TV rebroadcasting engine with CORS
   */
  server.get(
    '/stream',
    async (
      request: FastifyRequest<{
        Querystring: { epId?: string; url?: string; api_key?: string };
      }>,
      reply
    ) => {
      const epId = request.query.epId;
      let targetUrl = request.query.url;

      if (!epId && !targetUrl) {
        return reply.status(400).send({ error: 'Missing epId or url parameter' });
      }

      try {
        if (epId) {
          const resolved = await kisskhService.resolveEpisode(epId);
          targetUrl = resolved.videoUrl || resolved.backupUrl || '';
        }

        if (!targetUrl) {
          return reply.status(404).send({ error: 'Stream URL could not be resolved' });
        }

        const settings = await settingsRepository.getSettings();
        const effectiveBaseUrl = getEffectiveBaseUrl(request, settings);
        const incomingKey = (request.query as any)?.api_key;
        const keyParam = incomingKey ? `&api_key=${encodeURIComponent(incomingKey)}` : '';

        // If targetUrl is an MP4 video or direct CDN stream, stream via ts-proxy with 206 Partial Content
        if (targetUrl.toLowerCase().includes('.mp4') || targetUrl.includes('verify=')) {
          reply.header('Access-Control-Allow-Origin', '*');
          const proxiedVideo = `${effectiveBaseUrl}/api/app/kisskh/ts-proxy?url=${encodeURIComponent(targetUrl)}`;
          return reply.redirect(proxiedVideo, 302);
        }

        // Fetch upstream playlist
        const m3u8Res = await fetch(targetUrl, {
          headers: {
            'User-Agent': UA,
            Referer: 'https://kisskh.co/',
            Origin: 'https://kisskh.co',
          },
        });

        if (!m3u8Res.ok) {
          return reply.status(m3u8Res.status).send({ error: 'Upstream stream request failed' });
        }

        const rawM3u8 = await m3u8Res.text();
        if (!rawM3u8.includes('#EXTM3U')) {
          reply.header('Access-Control-Allow-Origin', '*');
          const proxiedVideo = `${effectiveBaseUrl}/api/app/kisskh/ts-proxy?url=${encodeURIComponent(targetUrl)}`;
          return reply.redirect(proxiedVideo, 302);
        }

        const baseUri = new URL(targetUrl);
        const lines = rawM3u8.split('\n');
        const rewritten = lines
          .map((line) => {
            const trimmed = line.trim();
            if (!trimmed) return line;

            // Handle URI attributes in tags (e.g. #EXT-X-KEY:METHOD=...,URI="...")
            if (trimmed.startsWith('#')) {
              if (trimmed.includes('URI="')) {
                return trimmed.replace(/URI="([^"]+)"/g, (_match, uri) => {
                  const fullUri = new URL(uri, baseUri).href;
                  return `URI="${effectiveBaseUrl}/api/app/kisskh/ts-proxy?url=${encodeURIComponent(fullUri)}"`;
                });
              }
              return line;
            }

            // Normal URI line (segment or sub-playlist)
            const absoluteUrl = new URL(trimmed, baseUri).href;
            if (absoluteUrl.toLowerCase().includes('.m3u8')) {
              return `${effectiveBaseUrl}/api/app/kisskh/stream?url=${encodeURIComponent(absoluteUrl)}${keyParam}`;
            }
            return `${effectiveBaseUrl}/api/app/kisskh/ts-proxy?url=${encodeURIComponent(absoluteUrl)}`;
          })
          .join('\n');

        reply.header('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
        reply.header('Cache-Control', 'public, max-age=10');

        return reply.send(rewritten);
      } catch (err: any) {
        return reply.status(502).send({
          error: 'STREAM_RESOLVE_FAILED',
          message: err.message,
        });
      }
    }
  );

  /**
   * GET /ts-proxy?url=...
   * High-speed proxy for .ts and media chunks with byte-range support and CORS
   */
  server.get(
    '/ts-proxy',
    async (
      request: FastifyRequest<{
        Querystring: { url: string };
      }>,
      reply: FastifyReply
    ) => {
      const chunkUrl = request.query.url;
      if (!chunkUrl || !/^https?:\/\//i.test(chunkUrl)) {
        return reply.status(400).send({ error: 'Missing or invalid url parameter' });
      }

      const clientRange = request.headers.range;
      const parsedUrl = new URL(chunkUrl);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const upstreamHeaders: Record<string, string> = {
        'User-Agent': UA,
        Referer: 'https://kisskh.co/',
        Origin: 'https://kisskh.co',
      };

      if (clientRange) {
        upstreamHeaders['Range'] = clientRange;
      }

      return new Promise<void>((resolve, reject) => {
        const req = client.request(
          chunkUrl,
          {
            method: 'GET',
            headers: upstreamHeaders,
            timeout: 25000,
          },
          (res) => {
            reply.raw.statusCode = res.statusCode || 200;

            reply.header('Access-Control-Allow-Origin', '*');
            reply.header('Access-Control-Allow-Headers', 'Range, Accept-Ranges, Content-Type');
            reply.header('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
            reply.header('Accept-Ranges', 'bytes');

            if (res.headers['content-type']) {
              reply.header('Content-Type', res.headers['content-type']);
            }
            if (res.headers['content-length']) {
              reply.header('Content-Length', res.headers['content-length']);
            }
            if (res.headers['content-range']) {
              reply.header('Content-Range', res.headers['content-range']);
            }
            reply.header('Cache-Control', 'public, max-age=86400');

            res.pipe(reply.raw);
            res.on('end', () => resolve());
            res.on('error', (err) => {
              if (!reply.raw.headersSent) {
                reply.status(502).send({ error: err.message });
              }
              resolve();
            });
          }
        );

        req.on('error', (err) => {
          if (!reply.raw.headersSent) {
            reply.status(502).send({ error: err.message });
          }
          resolve();
        });

        req.on('timeout', () => {
          req.destroy();
          if (!reply.raw.headersSent) {
            reply.status(504).send({ error: 'Upstream chunk request timed out' });
          }
          resolve();
        });

        req.end();
      });
    }
  );

  /**
   * GET /subtitles?epId=...
   * Multilingual subtitles for an episode with CORS
   */
  server.get(
    '/subtitles',
    async (
      request: FastifyRequest<{
        Querystring: { epId: string };
      }>,
      reply
    ) => {
      const epId = request.query.epId;
      if (!epId) {
        return reply.status(400).send({ error: 'Missing epId parameter' });
      }

      try {
        const tracks = await kisskhService.getSubtitles(epId);
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Cache-Control', 'public, max-age=3600');

        return {
          success: true,
          episode_id: epId,
          tracks,
        };
      } catch (err: any) {
        return reply.status(502).send({
          success: false,
          error: err.message,
        });
      }
    }
  );

  /**
   * GET /resolve?epId=...
   * JSON endpoint returning direct upstream and proxied stream URLs
   */
  server.get(
    '/resolve',
    async (
      request: FastifyRequest<{
        Querystring: { epId: string; api_key?: string };
      }>,
      reply
    ) => {
      const isAuthed = await checkMasterAuth(request, reply);
      if (!isAuthed) return;

      const epId = request.query.epId;
      if (!epId) {
        return reply.status(400).send({ error: 'Missing epId parameter' });
      }

      try {
        const resolved = await kisskhService.resolveEpisode(epId);
        const settings = await settingsRepository.getSettings();
        const effectiveBaseUrl = getEffectiveBaseUrl(request, settings);
        const incomingKey = (request.query as any)?.api_key;
        const keyParam = incomingKey ? `&api_key=${encodeURIComponent(incomingKey)}` : '';

        reply.header('Access-Control-Allow-Origin', '*');
        return {
          success: true,
          episode_id: epId,
          stream_url: `${effectiveBaseUrl}/api/app/kisskh/stream?epId=${epId}${keyParam}`,
          direct_url: resolved.videoUrl,
          backup_url: resolved.backupUrl,
          type: resolved.type,
        };
      } catch (err: any) {
        return reply.status(502).send({
          success: false,
          error: err.message,
        });
      }
    }
  );
}
