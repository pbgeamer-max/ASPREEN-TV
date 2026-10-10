import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
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
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  await server.register(cookie, {
    secret: config.sessionSecret,
    hook: 'onRequest',
  });

  await server.register(rateLimit, {
    max: 1000,
    timeWindow: '1 minute',
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

    reply.raw.writeHead(200, {
      'Content-Type': 'video/mp2t',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel', 'warning',
      '-protocol_whitelist', 'file,crypto,data,http,https,tcp,tls',
      '-fflags', '+genpts+discardcorrupt+nobuffer',
      '-err_detect', 'ignore_err',
    ];

    const settings = await settingsRepository.getSettings();
    const rawProxy = channel.proxyUrl || settings.defaultProxyUrl;
    const proxyUrl = rawProxy && !rawProxy.includes('31.59.20.176') ? rawProxy : undefined;

    if (proxyUrl) {
      ffmpegArgs.push('-http_proxy', proxyUrl);
    }

    if (/^https?:\/\//i.test(inputUrl)) {
      ffmpegArgs.push(
        '-user_agent', 'VLC/3.0.20 LibVLC/3.0.20',
        '-reconnect', '1',
        '-reconnect_at_eof', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '2',
        '-timeout', '10000000'
      );
    }

    ffmpegArgs.push('-i', inputUrl);
    ffmpegArgs.push('-avoid_negative_ts', 'make_zero');
    ffmpegArgs.push('-c', 'copy', '-f', 'mpegts', '-flush_packets', '1', '-muxdelay', '0.1', 'pipe:1');

    const proc = spawn('ffmpeg', ffmpegArgs, { windowsHide: true });
    proc.stdout.pipe(reply.raw);

    const cleanup = () => {
      try {
        proc.kill('SIGTERM');
      } catch {}
    };

    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
    proc.on('error', () => {
      try { reply.raw.end(); } catch {}
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

      // Wait up to 6 seconds for FFmpeg to produce the initial index.m3u8
      const maxWaitMs = 6000;
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
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}
