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
   * GET /api/app/oscar/playlist.m3u
   * Dedicated M3U playlist for Oscar TV channels only
   */
  server.get('/oscar/playlist.m3u', async (request, reply: FastifyReply) => {
    let channels = await channelRepository.listChannels();
    let oscarChannels = channels.filter(
      (c) => c.enabled !== false && (c.sourceId === 'oscar-tv-live' || c.externalIdentifier?.startsWith('oscar-'))
    );

    if (oscarChannels.length === 0) {
      try {
        const { oscarSyncService } = await import('../services/oscar-sync.service');
        await oscarSyncService.syncChannelsToDb();
        channels = await channelRepository.listChannels();
        oscarChannels = channels.filter(
          (c) => c.enabled !== false && (c.sourceId === 'oscar-tv-live' || c.externalIdentifier?.startsWith('oscar-'))
        );
      } catch {}
    }

    const settings = await settingsRepository.getSettings();
    const reqHost = (request.headers['x-forwarded-host'] as string) || (request.headers.host as string);
    const reqProto = (request.headers['x-forwarded-proto'] as string) || 'https';
    let effectiveBaseUrl = settings.publicStreamBaseUrl;
    if ((!effectiveBaseUrl || effectiveBaseUrl.includes('localhost') || effectiveBaseUrl.includes('@')) && reqHost && !reqHost.includes('127.0.0.1')) {
      effectiveBaseUrl = `${reqProto}://${reqHost}`;
    }

    const lines: string[] = ['#EXTM3U'];

    for (const ch of oscarChannels) {
      const publicOutputId = ch.activeOutputId || ch.id;
      const rawToken = generateStreamToken();
      const tokenHash = hashStreamToken(rawToken);

      await tokenRepository.createToken({
        channelId: ch.id,
        name: `Oscar M3U - ${ch.name}`,
        tokenHash,
        publicOutputId,
      });

      const liveStreamUrl = buildTsPlaybackUrl(effectiveBaseUrl, publicOutputId, rawToken);
      const proxiedLogo = ch.logoUrl ? `${effectiveBaseUrl}/api/app/image-proxy?url=${encodeURIComponent(ch.logoUrl)}` : '';
      const tvgLogo = proxiedLogo ? ` tvg-logo="${proxiedLogo}"` : '';
      const groupTitle = ch.groupTitle ? ` group-title="${ch.groupTitle.replace(/"/g, "'")}"` : ' group-title="Oscar TV"';

      lines.push(`#EXTINF:-1 tvg-id="" tvg-name="${ch.name.replace(/"/g, "'")}"${tvgLogo}${groupTitle},${ch.name}`);
      lines.push(liveStreamUrl);
    }

    const m3uContent = lines.join('\n');
    reply.header('Content-Type', 'audio/x-mpegurl; charset=utf-8');
    reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    return reply.send(m3uContent);
  });

  /**
   * GET /api/app/oscar/channels
   * Returns clean, structured JSON of Oscar TV channels only for Android & web apps
   */
  server.get('/oscar/channels', async (request, reply) => {
    let channels = await channelRepository.listChannels();
    let oscarChannels = channels.filter(
      (c) => c.enabled !== false && (c.sourceId === 'oscar-tv-live' || c.externalIdentifier?.startsWith('oscar-'))
    );

    if (oscarChannels.length === 0) {
      try {
        const { oscarSyncService } = await import('../services/oscar-sync.service');
        await oscarSyncService.syncChannelsToDb();
        channels = await channelRepository.listChannels();
        oscarChannels = channels.filter(
          (c) => c.enabled !== false && (c.sourceId === 'oscar-tv-live' || c.externalIdentifier?.startsWith('oscar-'))
        );
      } catch {}
    }

    const settings = await settingsRepository.getSettings();
    const reqHost = (request.headers['x-forwarded-host'] as string) || (request.headers.host as string);
    const reqProto = (request.headers['x-forwarded-proto'] as string) || 'https';
    let effectiveBaseUrl = settings.publicStreamBaseUrl;
    if ((!effectiveBaseUrl || effectiveBaseUrl.includes('localhost') || effectiveBaseUrl.includes('@')) && reqHost && !reqHost.includes('127.0.0.1')) {
      effectiveBaseUrl = `${reqProto}://${reqHost}`;
    }

    const appChannels = await Promise.all(
      oscarChannels.map(async (ch) => {
        const publicOutputId = ch.activeOutputId || ch.id;
        const rawToken = generateStreamToken();
        const tokenHash = hashStreamToken(rawToken);

        await tokenRepository.createToken({
          channelId: ch.id,
          name: `Oscar App - ${ch.name}`,
          tokenHash,
          publicOutputId,
        });

        const liveStreamUrl = buildTsPlaybackUrl(effectiveBaseUrl, publicOutputId, rawToken);
        const hlsStreamUrl = buildPlaybackUrl(effectiveBaseUrl, publicOutputId, rawToken);
        const logoUrl = ch.logoUrl ? `${effectiveBaseUrl}/api/app/image-proxy?url=${encodeURIComponent(ch.logoUrl)}` : null;

        return {
          id: ch.id,
          name: ch.name,
          category: ch.groupTitle || 'قنوات أوسكار',
          logo: logoUrl,
          streamUrl: liveStreamUrl,
          hlsUrl: hlsStreamUrl,
          status: ch.transcodingStatus || 'RUNNING',
        };
      })
    );

    return {
      total: appChannels.length,
      source: 'Oscar TV Hub',
      serverTime: new Date().toISOString(),
      channels: appChannels,
    };
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

  /**
   * POST /api/app/sniff
   * Extracts hidden m3u8 stream from any live match page URL
   */
  server.post(
    '/sniff',
    async (request: FastifyRequest<{ Body: { pageUrl: string; channelName?: string; autoSave?: boolean } }>, reply) => {
      const { pageUrl, channelName, autoSave } = (request.body as any) || {};
      if (!pageUrl || !/^https?:\/\//i.test(pageUrl)) {
        return reply.status(400).send({ error: 'pageUrl is required and must start with http:// or https://' });
      }

      const { snifferService } = await import('../services/sniffer.service');
      const sniffResult = await snifferService.sniffWebpage(pageUrl);

      if (!sniffResult.success || !sniffResult.streamUrl) {
        return reply.status(422).send({ success: false, error: sniffResult.error || 'No stream found' });
      }

      let createdChannel = null;
      if (autoSave && channelName) {
        const { encrypt } = await import('../security/encryption');
        createdChannel = await channelRepository.createChannel({
          sourceId: 'web-sniffed',
          name: channelName,
          normalizedName: channelName.trim().toLowerCase(),
          inputType: 'HLS',
          inputStatus: 'ONLINE',
          transcodingStatus: 'STOPPED',
          encryptedInputUrl: encrypt(sniffResult.streamUrl),
          groupTitle: 'Sniffed Streams',
          enabled: true,
          preset: 'COPY',
        });
      }

      return {
        success: true,
        streamUrl: sniffResult.streamUrl,
        headers: sniffResult.headers,
        channel: createdChannel,
      };
    }
  );

  /**
   * POST /api/app/sync-sports
   * Scans live sports index and synchronizes active sports/beIN channels
   */
  server.post('/sync-sports', async (_request, reply) => {
    const { snifferService } = await import('../services/sniffer.service');
    const result = await snifferService.superScan('sports', 60);
    return {
      success: true,
      ...result,
    };
  });

  /**
   * POST /api/app/scan
   * Full super scanner for iraqi, arabic, and sports channels
   */
  server.post('/scan', async (request: FastifyRequest<{ Body: { category?: 'all' | 'sports' | 'iraq' | 'arabic'; limit?: number } }>, reply) => {
    const { category, limit } = (request.body as any) || {};
    const { snifferService } = await import('../services/sniffer.service');
    const result = await snifferService.superScan(category || 'all', limit || 60);
    return {
      success: true,
      ...result,
    };
  });

  /**
   * POST /api/app/clean
   * Cleans foreign spam channels and reorganizes channels into clean packages (1, 2, 3...)
   */
  server.post('/clean', async (_request, reply) => {
    const { snifferService } = await import('../services/sniffer.service');
    const cleaned = await snifferService.purgeForeignSpam();
    return {
      success: true,
      cleanedCount: cleaned,
    };
  });

  // ─────────────────────────────────────────────────────────────
  //  LIVE HUNTER ENDPOINTS
  // ─────────────────────────────────────────────────────────────

  /**
   * POST /api/app/hunt/alokal
   * Hunts live TV channels from alokalive.com, extracts & saves streams
   */
  server.post('/hunt/alokal', async (_request, reply) => {
    const { liveHunterService } = await import('../services/live-hunter.service');
    const result = await liveHunterService.huntAlokalive();
    return { success: true, ...result };
  });

  /**
   * POST /api/app/hunt/koora
   * Hunts live football matches from aflam4you/koora_live, extracts & saves streams
   */
  server.post('/hunt/koora', async (_request, reply) => {
    const { liveHunterService } = await import('../services/live-hunter.service');
    const result = await liveHunterService.huntKooraLive();
    return { success: true, ...result };
  });

  /**
   * POST /api/app/hunt/reset-and-hunt
   * Wipes ALL existing channels and runs clean fresh hunt for koora_live
   */
  server.post('/hunt/reset-and-hunt', async (_request, reply) => {
    const { liveHunterService } = await import('../services/live-hunter.service');
    const { channelRepository } = await import('../repositories/channel.repository');
    const deletedTotal = await channelRepository.deleteAllChannels();
    const result = await liveHunterService.huntKooraLive();
    return {
      success: true,
      deletedTotal,
      ...result,
      message: `تم حذف كافة الـ ${deletedTotal} قناة السابقة بنجاح، وإعادة استيراد وترتيب ${result.addedCount} قناة جديدة.`
    };
  });

  /**
   * POST /api/app/hunt/all
   * Hunts ALL sources: alokalive.com + koora_live simultaneously
   */
  server.post('/hunt/all', async (_request, reply) => {
    const { liveHunterService } = await import('../services/live-hunter.service');
    const { alokal, koora, alreadyRunning } = await liveHunterService.huntAll();
    if (alreadyRunning) {
      return {
        success: true,
        message: 'عملية الصيد جارية بالفعل في الخلفية...',
        summary: { totalAdded: 0, totalUpdated: 0, totalDeleted: 0, totalSkipped: 0 },
      };
    }
    return {
      success: true,
      summary: {
        totalAdded: (alokal?.addedCount || 0) + (koora?.addedCount || 0),
        totalUpdated: (alokal?.updatedCount || 0) + (koora?.updatedCount || 0),
        totalDeleted: (alokal?.deletedOldCount || 0) + (koora?.deletedOldCount || 0),
        totalSkipped: (alokal?.skippedCount || 0) + (koora?.skippedCount || 0),
      },
      alokal,
      koora,
    };
  });

  // ─────────────────────────────────────────────────────────────
  //  AUTOPILOT (AUTONOMOUS REBROADCAST & CONTINUOUS SYNC)
  // ─────────────────────────────────────────────────────────────

  /**
   * GET /api/app/auto-pilot/status
   */
  server.get('/auto-pilot/status', async (_request, reply) => {
    const { autoPilotService } = await import('../services/auto-pilot.service');
    return autoPilotService.getStatus();
  });

  /**
   * POST /api/app/auto-pilot/trigger
   */
  server.post('/auto-pilot/trigger', async (_request, reply) => {
    const { autoPilotService } = await import('../services/auto-pilot.service');
    const result = await autoPilotService.runCycle();
    return { success: true, ...result };
  });
}

