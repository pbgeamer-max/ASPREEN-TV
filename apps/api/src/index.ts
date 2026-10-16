import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import { spawn } from 'child_process';

// Shield process from unhandled async scraper or stream disconnect crashes
process.on('uncaughtException', (err: any) => {
  console.error('[Process] Intercepted uncaughtException:', err?.message || err);
});
process.on('unhandledRejection', (reason: any) => {
  console.error('[Process] Intercepted unhandledRejection:', reason?.message || reason);
});
import { config } from './config';
import { initFirebaseAdmin } from './firebase/admin';
import { authRoutes } from './routes/auth.routes';
import { dashboardRoutes } from './routes/dashboard.routes';
import { sourceRoutes } from './routes/source.routes';
import { channelRoutes } from './routes/channel.routes';
import { jobRoutes } from './routes/job.routes';
import { tokenRoutes } from './routes/token.routes';
import { settingsRoutes } from './routes/settings.routes';
import { hlsAuthRoutes } from './routes/hls-auth.routes';
import { appRoutes } from './routes/app.routes';
import { telegramService } from './services/telegram.service';
import { tokenRepository } from './repositories/token.repository';
import { channelRepository } from './repositories/channel.repository';
import { settingsRepository } from './repositories/settings.repository';
import { jobRepository } from './repositories/job.repository';
import { hashStreamToken } from './security/token';
import { decrypt } from './security/encryption';
import { transcodingService } from './services/transcoding.service';
import { initDatabase } from './db';

export async function createServer() {
  const server = Fastify({
    logger: {
      level: config.nodeEnv === 'production' ? 'info' : 'warn',
    },
    trustProxy: true,
    bodyLimit: 50 * 1024 * 1024, // 50MB for large M3U playlist uploads
  });

  // Security & Plugins
  await server.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Range',
      'Accept-Ranges',
      'Origin',
      'Accept',
      'X-Api-Key',
      'If-Modified-Since',
      'If-None-Match',
      'Cache-Control',
    ],
    exposedHeaders: [
      'Content-Range',
      'Content-Length',
      'Accept-Ranges',
      'Content-Type',
      'ETag',
    ],
  });

  await server.register(cookie, {
    secret: config.sessionSecret,
    hook: 'onRequest',
  });

  await server.register(rateLimit, {
    global: false,
    max: 100000,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'],
  });

  // Gracefully handle empty JSON bodies from proxies/rewrites, allow up to 50MB
  server.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 50 * 1024 * 1024 }, (_req, body, defaultDone) => {
    if (!body || (typeof body === 'string' && body.trim() === '')) {
      defaultDone(null, {});
      return;
    }
    try {
      defaultDone(null, JSON.parse(body as string));
    } catch (err: any) {
      defaultDone(err, null);
    }
  });

  // Initialize Database (PostgreSQL if DATABASE_URL is set, or in-memory fallback)
  await initDatabase();

  // Initialize Firebase Admin
  initFirebaseAdmin();

  // Register API Routes
  await server.register(authRoutes, { prefix: '/api/auth' });
  await server.register(dashboardRoutes, { prefix: '/api/dashboard' });
  await server.register(sourceRoutes, { prefix: '/api/sources' });
  await server.register(channelRoutes, { prefix: '/api/channels' });
  await server.register(jobRoutes, { prefix: '/api/jobs' });
  await server.register(tokenRoutes, { prefix: '/api/stream-tokens' });
  await server.register(settingsRoutes, { prefix: '/api' });
  await server.register(hlsAuthRoutes, { prefix: '/api' });
  await server.register(appRoutes, { prefix: '/api/app' });
  await server.register(appRoutes, { prefix: '/api/v1' });

  // Helper function to stream live MPEG-TS relay using FFmpeg
  async function streamLiveMpegTs(
    outputId: string,
    rawToken: string,
    request: any,
    reply: any
  ) {
    const tokenHash = hashStreamToken(rawToken);
    const tokenDoc = await tokenRepository.getTokenByHash(tokenHash);

    if (!tokenDoc) {
      return reply.status(403).send('Forbidden: Invalid stream token');
    }

    if (tokenDoc.revokedAt) {
      return reply.status(403).send('Forbidden: Token has been revoked');
    }

    if (tokenDoc.expiresAt && Date.now() > new Date(tokenDoc.expiresAt).getTime()) {
      return reply.status(403).send('Forbidden: Token has expired');
    }

    tokenRepository.updateLastUsed(tokenDoc.id).catch(() => {});

    const channel = await channelRepository.getChannel(tokenDoc.channelId);
    if (!channel || !channel.enabled) {
      return reply.status(404).send('Channel not found or disabled');
    }

    if (
      tokenDoc.publicOutputId !== outputId &&
      channel.activeOutputId !== outputId &&
      channel.id !== outputId
    ) {
      return reply.status(403).send('Forbidden: Invalid stream token or output');
    }

    const inputUrl = decrypt(channel.encryptedInputUrl);
    if (!inputUrl) {
      return reply.status(500).send('Unable to decrypt channel stream input');
    }

    // Stop any other channel on the same source to release single-connection IPTV line
    await transcodingService.stopOtherChannelsOnSource(channel.sourceId, channel.id);

    // Direct, instant HTTP/HTTPS streaming relay for raw TS streams (<50ms delay, zero FFmpeg overhead)
    // If input is an HLS playlist (.m3u8 or disguised .css), delegate to FFmpeg remuxer below so players receive continuous MPEG-TS
    if (/^https?:\/\//i.test(inputUrl) && !inputUrl.includes('.m3u8') && !inputUrl.includes('.css')) {
      return new Promise<void>((resolve) => {
        let isResolved = false;
        const done = () => {
          if (!isResolved) {
            isResolved = true;
            resolve();
          }
        };

        function makeRequest(targetUrl: string, redirectCount = 0) {
          if (redirectCount > 5) {
            if (!reply.raw.headersSent) {
              reply.status(502).send('Too many redirects from upstream IPTV provider');
            }
            return done();
          }

          let parsedUrl: URL;
          try {
            parsedUrl = new URL(targetUrl);
          } catch {
            if (!reply.raw.headersSent) {
              reply.status(400).send('Invalid stream input URL');
            }
            return done();
          }

          const isHttps = parsedUrl.protocol === 'https:';
          const lib = isHttps ? https : http;

          const reqOptions: http.RequestOptions = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (isHttps ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers: {
              'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
              'Accept': '*/*',
              'Connection': 'keep-alive',
            },
            timeout: 15000,
          };

          const clientReq = lib.request(reqOptions, (upstreamRes) => {
            const statusCode = upstreamRes.statusCode || 200;

            // Handle HTTP Redirects
            if (statusCode >= 300 && statusCode < 400 && upstreamRes.headers.location) {
              upstreamRes.resume();
              const nextUrl = new URL(upstreamRes.headers.location, targetUrl).toString();
              return makeRequest(nextUrl, redirectCount + 1);
            }

            if (statusCode >= 200 && statusCode < 300) {
              reply.raw.writeHead(200, {
                'Content-Type': 'video/mp2t',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
              });

              upstreamRes.pipe(reply.raw);

              upstreamRes.on('end', () => {
                try { reply.raw.end(); } catch {}
                done();
              });

              upstreamRes.on('error', (err) => {
                if (err && err.message !== 'aborted') {
                  console.error('[Stream Relay] Upstream socket error:', err.message);
                }
                try { reply.raw.end(); } catch {}
                done();
              });
            } else {
              // Upstream returned error (403, 401, 404, 500)
              if (!reply.raw.headersSent) {
                if (statusCode === 403 || statusCode === 401) {
                  reply.status(403).send('Upstream IPTV provider returned HTTP 403 Forbidden: Line in use or account expired');
                } else if (statusCode === 404) {
                  reply.status(404).send('Upstream stream channel not found (HTTP 404)');
                } else {
                  reply.status(statusCode).send(`Upstream returned HTTP ${statusCode}`);
                }
              }
              upstreamRes.resume();
              done();
            }
          });

          clientReq.on('timeout', () => {
            console.error('[Stream Relay] Upstream request timeout');
            clientReq.destroy(new Error('Connection timeout'));
            if (!reply.raw.headersSent) {
              reply.status(504).send('Gateway Timeout: Upstream IPTV provider did not respond');
            }
            done();
          });

          clientReq.on('error', (err) => {
            console.error('[Stream Relay] Connection error:', err.message);
            if (!reply.raw.headersSent) {
              reply.status(502).send(`Bad Gateway: Unable to connect to upstream (${err.message})`);
            }
            done();
          });

          const cleanup = () => {
            clientReq.destroy();
            done();
          };

          request.raw.on('close', cleanup);
          request.raw.on('error', cleanup);

          clientReq.end();
        }

        makeRequest(inputUrl);
      });
    }

    // Fallback for HLS (.m3u8) or non-HTTP streams (RTMP, RTSP, UDP): Spawn optimized FFmpeg
    return new Promise<void>((resolve) => {
      let actualUrl = inputUrl;
      const effectiveHeaders: Record<string, string> = {};

      if (actualUrl.includes('|')) {
        const pipeIdx = actualUrl.indexOf('|');
        const headerPart = actualUrl.substring(pipeIdx + 1);
        actualUrl = actualUrl.substring(0, pipeIdx);

        const pairs = headerPart.split(/[|&]/);
        for (const pair of pairs) {
          const eq = pair.indexOf('=');
          if (eq !== -1) {
            const k = pair.substring(0, eq).trim();
            const v = pair.substring(eq + 1).trim();
            if (k && v) effectiveHeaders[k] = v;
          }
        }
      }

      if (effectiveHeaders['Referer'] && !effectiveHeaders['Origin']) {
        try {
          effectiveHeaders['Origin'] = new URL(effectiveHeaders['Referer']).origin;
        } catch {}
      }

      let headersStr = 'Connection: keep-alive\r\n';
      for (const [k, v] of Object.entries(effectiveHeaders)) {
        const lower = k.toLowerCase();
        if (lower !== 'user-agent' && lower !== 'pageurl') {
          headersStr += `${k}: ${v}\r\n`;
        }
      }

      const uaToUse = effectiveHeaders['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

      const ffmpegArgs = [
        '-hide_banner',
        '-loglevel', 'warning',
        '-protocol_whitelist', 'file,crypto,data,http,https,tcp,tls',
        '-icy', '0',
        '-seekable', '0',
        '-multiple_requests', '1',
        '-user_agent', uaToUse,
        '-headers', headersStr,
        '-probesize', '1000000',
        '-analyzeduration', '1000000',
        '-fflags', '+genpts+discardcorrupt+nobuffer',
        '-err_detect', 'ignore_err',
        '-i', actualUrl,
        '-avoid_negative_ts', 'make_zero',
        '-c', 'copy',
        '-f', 'mpegts',
        '-flush_packets', '1',
        '-muxdelay', '0.1',
        'pipe:1',
      ];

      const proc = spawn('ffmpeg', ffmpegArgs, { windowsHide: true });
      let headersSent = false;
      let ffmpegStderr = '';

      proc.stderr?.on('data', (d) => {
        ffmpegStderr += d.toString();
        if (ffmpegStderr.length > 4000) ffmpegStderr = ffmpegStderr.slice(-4000);
      });

      proc.stdout.once('data', (chunk) => {
        if (!reply.raw.headersSent) {
          headersSent = true;
          reply.raw.writeHead(200, {
            'Content-Type': 'video/mp2t',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
          });
        }
        reply.raw.write(chunk);
        proc.stdout.pipe(reply.raw);
      });

      const cleanup = () => {
        try { proc.kill('SIGTERM'); } catch {}
        resolve();
      };

      request.raw.on('close', cleanup);
      request.raw.on('error', cleanup);
      proc.on('close', (code) => {
        if (!headersSent && !reply.raw.headersSent) {
          console.error(`[Stream Relay] FFmpeg failed with exit code ${code}. Stderr:\n${ffmpegStderr}`);
          reply.status(502).send(`FFmpeg input failed (exit code ${code}): ${ffmpegStderr.slice(-300)}`);
        }
        cleanup();
      });
    });
  }

  // Direct Live MPEG-TS Relay endpoint (/live/:outputId/:token.ts or /live/:outputId/:token)
  server.get('/live/:outputId/:token', async (request, reply) => {
    let { outputId, token: rawToken } = request.params as {
      outputId: string;
      token: string;
    };

    if (rawToken.endsWith('.ts')) {
      rawToken = rawToken.slice(0, -3);
    }

    return streamLiveMpegTs(outputId, rawToken, request, reply);
  });

  // Direct HLS Static Serving Handler for local development / testing without Nginx
  // Verifies the stream token on every playlist (.m3u8) and segment (.ts) request!
  server.get('/hls/:outputId/:token/:file', async (request, reply) => {
    const { outputId, token: rawToken, file } = request.params as {
      outputId: string;
      token: string;
      file: string;
    };

    // Sanitize filename to prevent directory traversal
    const safeFile = path.basename(file);
    if (!safeFile || safeFile !== file) {
      return reply.status(400).send('Invalid filename');
    }

    // Support /hls/:outputId/:token/live.ts as direct live TS stream
    if (safeFile === 'live.ts' || safeFile === 'stream.ts') {
      return streamLiveMpegTs(outputId, rawToken, request, reply);
    }

    // Verify token
    const tokenHash = hashStreamToken(rawToken);
    const tokenDoc = await tokenRepository.getTokenByHash(tokenHash);

    if (!tokenDoc) {
      return reply.status(403).send('Forbidden: Invalid stream token');
    }

    if (tokenDoc.revokedAt) {
      return reply.status(403).send('Forbidden: Token has been revoked');
    }

    if (tokenDoc.expiresAt && Date.now() > new Date(tokenDoc.expiresAt).getTime()) {
      return reply.status(403).send('Forbidden: Token has expired');
    }

    const channel = await channelRepository.getChannel(tokenDoc.channelId);
    if (!channel || !channel.enabled) {
      return reply.status(404).send('Channel not found or disabled');
    }

    if (
      tokenDoc.publicOutputId !== outputId &&
      channel.activeOutputId !== outputId &&
      channel.id !== outputId
    ) {
      return reply.status(403).send('Forbidden: Invalid stream token or output');
    }

    // Update last used asynchronously
    tokenRepository.updateLastUsed(tokenDoc.id).catch(() => {});
    transcodingService.touchChannelAccess(tokenDoc.channelId);

    // Look for file in active output directory or requested outputId
    const effectiveDirId = channel.activeOutputId || outputId;
    let filePath = path.resolve(config.streamStoragePath, effectiveDirId, safeFile);
    if (!fs.existsSync(filePath) && outputId !== effectiveDirId) {
      const fallbackPath = path.resolve(config.streamStoragePath, outputId, safeFile);
      if (fs.existsSync(fallbackPath)) {
        filePath = fallbackPath;
      }
    }

    // If playlist is requested and does not exist yet on disk, trigger on-demand HLS segmentation!
    if (!fs.existsSync(filePath) && safeFile.endsWith('.m3u8')) {
      transcodingService.ensureChannelRunning(tokenDoc.channelId).catch(() => {});

      // Wait up to 12 seconds for FFmpeg to produce the initial index.m3u8
      const maxWaitMs = 12000;
      const intervalMs = 250;
      let waited = 0;
      while (!fs.existsSync(filePath) && waited < maxWaitMs) {
        await new Promise((r) => setTimeout(r, intervalMs));
        waited += intervalMs;
      }
    }

    if (!fs.existsSync(filePath)) {
      return reply.status(404).send('Stream file not found or not yet generated');
    }

    // Set appropriate MIME types and cache headers
    if (safeFile.endsWith('.m3u8')) {
      reply.header('Content-Type', 'application/vnd.apple.mpegurl');
      reply.header('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
      reply.header('Pragma', 'no-cache');
      reply.header('Expires', '0');
      reply.header('Access-Control-Allow-Origin', '*');
      let content = await fs.promises.readFile(filePath, 'utf8');
      // For continuous live streaming, strip any transient #EXT-X-ENDLIST tags
      // so players (VLC, Safari, HLS.js, ExoPlayer) never stop, seek-limit, or loop the stream
      content = content.replace(/#EXT-X-ENDLIST\r?\n?/g, '');
      return reply.send(content);
    } else if (safeFile.endsWith('.ts')) {
      reply.header('Content-Type', 'video/mp2t');
      reply.header('Cache-Control', 'public, max-age=86400');
      reply.header('Access-Control-Allow-Origin', '*');
      const stream = fs.createReadStream(filePath);
      return reply.send(stream);
    }
  });

  return server;
}

async function start() {
  const server = await createServer();
  try {
    // Reset any stale jobs from previous container crash or restart
    try {
      const activeJobs = await jobRepository.listActiveJobs();
      for (const job of activeJobs) {
        if (!transcodingService.isJobActive(job.id)) {
          await jobRepository.updateJob(job.id, {
            status: 'STOPPED',
            stoppedAt: new Date().toISOString(),
          });
        }
      }
    } catch {}

    await server.listen({ port: config.port, host: config.host });
    console.log(`[Aspreen TV API] Server running at http://${config.host}:${config.port}`);



    // Initialize Telegram Bot (if configured)
    try {
      telegramService.init();
    } catch (e: any) {
      console.warn('[Services] Telegram init warning:', e.message);
    }
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}
