import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { channelRepository } from '../repositories/channel.repository';
import { tokenRepository } from '../repositories/token.repository';
import { settingsRepository } from '../repositories/settings.repository';
import { generateStreamToken, hashStreamToken, buildPlaybackUrl, buildTsPlaybackUrl } from '../security/token';
import { telegramService } from '../services/telegram.service';

export async function appRoutes(server: FastifyInstance) {
  /**
   * GET /api/app/image-proxy
   * High-speed proxy for channel logos to bypass third-party hotlinking & 403 Forbidden checks
   */
  server.get('/image-proxy', async (request: FastifyRequest<{ Querystring: { url: string } }>, reply: FastifyReply) => {
    const rawUrl = request.query.url;
    if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
      return reply.status(400).send({ error: 'Missing or invalid url query parameter' });
    }

    try {
      const parsed = new URL(rawUrl);
      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? await import('https') : await import('http');

      return new Promise<void>((resolve) => {
        const req = lib.request(
          {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'GET',
            rejectUnauthorized: false,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              Referer: parsed.origin + '/',
              Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            },
            timeout: 8000,
          },
          (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              reply.redirect(res.headers.location);
              resolve();
              return;
            }

            reply.header('Content-Type', res.headers['content-type'] || 'image/jpeg');
            reply.header('Cache-Control', 'public, max-age=86400, s-maxage=86400');
            reply.header('Access-Control-Allow-Origin', '*');
            reply.status(res.statusCode || 200);
            res.pipe(reply.raw);
            res.on('end', () => resolve());
            res.on('error', () => {
              if (!reply.raw.writableEnded) reply.status(502).send({ error: 'Proxy error' });
              resolve();
            });
          }
        );

        req.on('timeout', () => {
          req.destroy();
          if (!reply.raw.writableEnded) reply.status(504).send({ error: 'Image fetch timeout' });
          resolve();
        });
        req.on('error', () => {
          if (!reply.raw.writableEnded) reply.status(502).send({ error: 'Upstream connection failed' });
          resolve();
        });
        req.end();
      });
    } catch (err: any) {
      return reply.status(500).send({ error: 'Image proxy exception: ' + err.message });
    }
  });

  /**
   * GET /api/app/status
   * Healthcheck for Android app startup
   */
  server.get('/status', async (_request, reply) => {
    return {
      status: 'ONLINE',
      app: 'Aspreen TV API',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    };
  });

  /**
   * GET /api/app/channels
   * Returns clean, structured JSON channels for Android / Mobile clients
   */
  server.get('/channels', async (request: FastifyRequest<{ Querystring: { group?: string; limit?: string } }>, reply) => {
    const limitNum = request.query.limit ? parseInt(request.query.limit, 10) : 5000;
    const channels = await channelRepository.listChannels(undefined, limitNum);
    const enabled = channels.filter((c) => c.enabled !== false);

    const settings = await settingsRepository.getSettings();
    const reqHost = (request.headers['x-forwarded-host'] as string) || (request.headers.host as string);
    const reqProto = (request.headers['x-forwarded-proto'] as string) || 'https';
    let effectiveBaseUrl = settings.publicStreamBaseUrl;
    if ((!effectiveBaseUrl || effectiveBaseUrl.includes('localhost') || effectiveBaseUrl.includes('@')) && reqHost && !reqHost.includes('127.0.0.1')) {
      effectiveBaseUrl = `${reqProto}://${reqHost}`;
    }

    const appChannels = await Promise.all(
      enabled.map(async (ch) => {
        const publicOutputId = ch.activeOutputId || ch.id;
        const rawToken = generateStreamToken();
        const tokenHash = hashStreamToken(rawToken);

        await tokenRepository.createToken({
          channelId: ch.id,
          name: `App Token - ${ch.name}`,
          tokenHash,
          publicOutputId,
        });

        const liveStreamUrl = buildTsPlaybackUrl(effectiveBaseUrl, publicOutputId, rawToken);
        const hlsStreamUrl = buildPlaybackUrl(effectiveBaseUrl, publicOutputId, rawToken);

        const logoUrl = ch.logoUrl ? `${effectiveBaseUrl}/api/app/image-proxy?url=${encodeURIComponent(ch.logoUrl)}` : null;

        return {
          id: ch.id,
          name: ch.name,
          category: ch.groupTitle || 'عام',
          logo: logoUrl,
          streamUrl: liveStreamUrl,
          hlsUrl: hlsStreamUrl,
          status: ch.transcodingStatus || 'RUNNING',
        };
      })
    );

    return {
      total: appChannels.length,
      serverTime: new Date().toISOString(),
      channels: appChannels,
    };
  });

  /**
   * GET /api/app/playlist.m3u
   * Dynamic M3U playlist for Android players (ExoPlayer, VLC, TiviMate)
   */
  server.get('/playlist.m3u', async (request, reply: FastifyReply) => {
    const channels = await channelRepository.listChannels();
    const enabled = channels.filter((c) => c.enabled !== false);

    const settings = await settingsRepository.getSettings();
    const reqHost = (request.headers['x-forwarded-host'] as string) || (request.headers.host as string);
    const reqProto = (request.headers['x-forwarded-proto'] as string) || 'https';
    let effectiveBaseUrl = settings.publicStreamBaseUrl;
    if ((!effectiveBaseUrl || effectiveBaseUrl.includes('localhost') || effectiveBaseUrl.includes('@')) && reqHost && !reqHost.includes('127.0.0.1')) {
      effectiveBaseUrl = `${reqProto}://${reqHost}`;
    }

    const lines: string[] = ['#EXTM3U'];

    for (const ch of enabled) {
      const publicOutputId = ch.activeOutputId || ch.id;
      const rawToken = generateStreamToken();
      const tokenHash = hashStreamToken(rawToken);

      await tokenRepository.createToken({
        channelId: ch.id,
        name: `App M3U - ${ch.name}`,
        tokenHash,
        publicOutputId,
      });

      const liveStreamUrl = buildTsPlaybackUrl(effectiveBaseUrl, publicOutputId, rawToken);
      const proxiedLogo = ch.logoUrl ? `${effectiveBaseUrl}/api/app/image-proxy?url=${encodeURIComponent(ch.logoUrl)}` : '';
      const tvgLogo = proxiedLogo ? ` tvg-logo="${proxiedLogo}"` : '';
      const groupTitle = ch.groupTitle ? ` group-title="${ch.groupTitle.replace(/"/g, "'")}"` : '';

      lines.push(`#EXTINF:-1 tvg-id="" tvg-name="${ch.name.replace(/"/g, "'")}"${tvgLogo}${groupTitle},${ch.name}`);
      lines.push(liveStreamUrl);
    }

    const m3uContent = lines.join('\n');
    reply.header('Content-Type', 'audio/x-mpegurl; charset=utf-8');
    reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    return reply.send(m3uContent);
  });

  /**
   * POST /api/app/report-channel
   * Allows the Android app to report a broken channel, notifying Telegram bot immediately
   */
  server.post('/report-channel', async (request: FastifyRequest<{ Body: { channelId?: string; channelName?: string; error?: string } }>, reply) => {
    const { channelId, channelName, error } = (request.body as any) || {};

    const alertText =
      `⚠️ <b>تنبيه من تطبيق الأندرويد:</b>\n\n` +
      `📺 القناة: <b>${channelName || channelId || 'غير معروف'}</b>\n` +
      `❌ الخطأ المُبلّغ: <code>${error || 'انقطاع البث'}</code>\n` +
      `⏱️ التوقيت: ${new Date().toLocaleTimeString('ar-EG')}`;

    telegramService.notifyAdmin(alertText).catch(() => {});

    return { received: true };
  });
}
