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
   * GET /api/app/channels (or /api/v1/channels)
   * High-speed, professional JSON API endpoint for Android & iOS apps
   * Returns all channels with permanent rebroadcast URLs, proxied logos, and categories.
   */
  server.get('/channels', async (request: FastifyRequest<{ Querystring: { group?: string; category?: string; q?: string; limit?: string } }>, reply) => {
    const { group, category, q, limit } = request.query;
    const limitNum = limit ? parseInt(limit, 10) : 5000;
    const channels = await channelRepository.listChannels(undefined, limitNum);
    let enabled = channels.filter((c) => c.enabled !== false);

    // Filter by group or category
    const filterCat = category || group;
    if (filterCat) {
      enabled = enabled.filter((c) => c.groupTitle?.toLowerCase() === filterCat.toLowerCase());
    }

    // Filter by search query
    if (q) {
      const query = q.toLowerCase();
      enabled = enabled.filter((c) =>
        c.name.toLowerCase().includes(query) ||
        (c.normalizedName && c.normalizedName.includes(query)) ||
        (c.groupTitle && c.groupTitle.toLowerCase().includes(query))
      );
    }

    const settings = await settingsRepository.getSettings();
    const reqHost = (request.headers['x-forwarded-host'] as string) || (request.headers.host as string);
    const reqProto = (request.headers['x-forwarded-proto'] as string) || 'https';
    let effectiveBaseUrl = settings.publicStreamBaseUrl;
    if ((!effectiveBaseUrl || effectiveBaseUrl.includes('localhost') || effectiveBaseUrl.includes('@')) && reqHost && !reqHost.includes('127.0.0.1')) {
      effectiveBaseUrl = `${reqProto}://${reqHost}`;
    }
    if (!effectiveBaseUrl) {
      effectiveBaseUrl = 'https://aspreen-tv-production.up.railway.app';
    }

    // Extract unique categories with channel counts
    const categoryCounts: Record<string, number> = {};
    channels.forEach((c) => {
      const grp = c.groupTitle || 'عام';
      categoryCounts[grp] = (categoryCounts[grp] || 0) + 1;
    });

    const categoriesList = Object.keys(categoryCounts).map((catName) => ({
      name: catName,
      count: categoryCounts[catName],
    }));

    const appChannels = enabled.map((ch, idx) => {
      const permStreamUrl = `${effectiveBaseUrl}/live/${ch.id}.m3u8`;
      const proxiedLogo = ch.logoUrl ? `${effectiveBaseUrl}/api/app/image-proxy?url=${encodeURIComponent(ch.logoUrl)}` : null;
      const order = ch.orderIndex || (idx + 1);

      return {
        id: ch.id,
        name: ch.name,
        category: ch.groupTitle || 'عام',
        group: ch.groupTitle || 'عام',
        logo: proxiedLogo,
        raw_logo: ch.logoUrl || null,
        stream_url: permStreamUrl,
        streamUrl: permStreamUrl,
        playback_url: permStreamUrl,
        status: ch.inputStatus === 'OFFLINE' ? 'OFFLINE' : 'ONLINE',
        order,
      };
    });

    reply.header('Cache-Control', 'public, max-age=30, s-maxage=30');
    reply.header('Access-Control-Allow-Origin', '*');

    return {
      success: true,
      server: 'Aspreen TV Production API',
      timestamp: new Date().toISOString(),
      total_channels: appChannels.length,
      total_categories: categoriesList.length,
      categories: categoriesList,
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
    if (!effectiveBaseUrl) {
      effectiveBaseUrl = 'https://aspreen-tv-production.up.railway.app';
    }

    const lines: string[] = ['#EXTM3U'];

    for (const ch of enabled) {
      const liveStreamUrl = `${effectiveBaseUrl}/live/${ch.id}.m3u8`;
      const proxiedLogo = ch.logoUrl ? `${effectiveBaseUrl}/api/app/image-proxy?url=${encodeURIComponent(ch.logoUrl)}` : '';
      const tvgLogo = proxiedLogo ? ` tvg-logo="${proxiedLogo}"` : '';
      const groupTitle = ch.groupTitle ? ` group-title="${ch.groupTitle.replace(/"/g, "'")}"` : '';

      lines.push(`#EXTINF:-1 tvg-id="${ch.id}" tvg-name="${ch.name.replace(/"/g, "'")}"${tvgLogo}${groupTitle},${ch.name}`);
      lines.push(liveStreamUrl);
    }

    const m3uContent = lines.join('\n');
    reply.header('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    reply.header('Cache-Control', 'public, max-age=60');
    reply.header('Access-Control-Allow-Origin', '*');
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
