import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAdminAuth } from '../security/auth-guard';
import { channelRepository } from '../repositories/channel.repository';
import { transcodingService } from '../services/transcoding.service';
import { probeStream } from '../services/probe.service';
import { ChannelUpdateSchema, StartTranscodingSchema, BulkStartChannelsSchema } from '@aspreen/shared';
import { decrypt } from '../security/encryption';

export async function channelRoutes(server: FastifyInstance) {
  server.addHook('preHandler', requireAdminAuth);

  function sanitizeChannel(ch: any) {
    const { encryptedInputUrl, ...rest } = ch;
    const isOff = ch.inputStatus === 'OFFLINE' || ch.status === 'event_only' || ch.manual_stopped === true;
    const isActuallyRunning = transcodingService.isChannelRunning(ch.id);
    return {
      ...rest,
      status: isOff ? 'event_only' : (ch.status || 'live'),
      inputStatus: isOff ? 'OFFLINE' : 'ONLINE',
      status_message: isOff ? 'لا يوجد حدث حالياً' : (ch.status_message || 'بث مباشر فائق الدقة'),
      transcodingStatus: isOff ? 'STOPPED' : (isActuallyRunning ? 'RUNNING' : (ch.transcodingStatus === 'FAILED' ? 'FAILED' : 'RUNNING')),
    };
  }

  /**
   * GET /api/channels/bein-status
   * Realtime counter and list of active beIN Sports channels (Limit: 2 max)
   */
  server.get('/bein-status', async () => {
    return channelRepository.getBeinActiveStatus();
  });

  /**
   * POST /api/channels/:id/toggle-broadcast
   * Toggles channel between LIVE and NO-EVENT (event_only).
   * Enforces max 2 active channels for beIN Sports!
   */
  server.post('/:id/toggle-broadcast', async (request: FastifyRequest<{
    Params: { id: string };
    Body: { isLive: boolean };
  }>, reply: FastifyReply) => {
    const { isLive } = (request.body as any) || {};
    if (typeof isLive !== 'boolean') {
      return reply.status(400).send({ error: 'Validation Error', message: 'isLive boolean field is required' });
    }

    try {
      const result = await channelRepository.toggleChannelBroadcast(request.params.id, isLive);

      // If channel was stopped, kill active FFmpeg/engine sessions immediately
      if (!isLive) {
        await transcodingService.stopChannel(request.params.id).catch(() => {});
        try {
          const proxyPort = process.env.STREAM_PROXY_PORT || '8088';
          await fetch(`http://127.0.0.1:${proxyPort}/live/control/stop?id=${encodeURIComponent(request.params.id)}`, {
            signal: AbortSignal.timeout(3000),
          }).catch(() => {});
        } catch {}
      } else {
        try {
          const proxyPort = process.env.STREAM_PROXY_PORT || '8088';
          await fetch(`http://127.0.0.1:${proxyPort}/live/control/reload`, {
            signal: AbortSignal.timeout(3000),
          }).catch(() => {});
        } catch {}
      }

      return {
        success: true,
        channel: sanitizeChannel(result.channel),
        activeBeinCount: result.activeBeinCount,
        activeBeinChannels: result.activeBeinChannels,
      };
    } catch (err: any) {
      if (err.message && err.message.includes('BEIN_LIMIT_REACHED')) {
        return reply.status(400).send({
          error: 'BEIN_LIMIT_REACHED',
          message: err.message.replace(/^BEIN_LIMIT_REACHED:\s*/, ''),
        });
      }
      return reply.status(400).send({
        error: 'Failed to update channel broadcast status',
        message: err.message,
      });
    }
  });

  /**
   * GET /api/channels
   */
  server.get('/', async (request: FastifyRequest<{
    Querystring: { sourceId?: string; q?: string; group?: string; limit?: string };
  }>) => {
    const { sourceId, q, group, limit } = request.query;
    const limitNum = limit && parseInt(limit, 10) > 0 ? parseInt(limit, 10) : undefined;
    let channels = await channelRepository.listChannels(sourceId, limitNum);

    if (group) {
      channels = channels.filter((c) => c.groupTitle?.toLowerCase() === group.toLowerCase());
    }

    if (q) {
      const query = q.toLowerCase();
      channels = channels.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.normalizedName.includes(query) ||
          c.groupTitle?.toLowerCase().includes(query)
      );
    }

    return channels.map(sanitizeChannel);
  });

  /**
   * POST /api/channels/bulk/start
   * Starts all channels (or filtered by sourceId) using COPY preset.
   */
  server.post('/bulk/start', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = BulkStartChannelsSchema.safeParse(request.body || {});
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation Error', details: parseResult.error.format() });
    }

    try {
      const result = await transcodingService.bulkStartChannels(parseResult.data);
      return result;
    } catch (err: any) {
      return reply.status(500).send({ error: 'Bulk start failed', message: err.message });
    }
  });

  /**
   * POST /api/channels/bulk/stop
   * Stops all active transcoding jobs (or filtered by sourceId).
   */
  server.post('/bulk/stop', async (request: FastifyRequest<{ Body: { sourceId?: string } }>, reply: FastifyReply) => {
    try {
      const sourceId = (request.body as any)?.sourceId;
      const result = await transcodingService.bulkStopChannels(sourceId);
      return result;
    } catch (err: any) {
      return reply.status(500).send({ error: 'Bulk stop failed', message: err.message });
    }
  });

  /**
   * GET /api/channels/:id
   */
  server.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const channel = await channelRepository.getChannel(request.params.id);
    if (!channel) {
      return reply.status(404).send({ error: 'Channel not found' });
    }
    return sanitizeChannel(channel);
  });

  /**
   * PATCH /api/channels/:id
   */
  server.patch('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const parseResult = ChannelUpdateSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation Error', details: parseResult.error.format() });
    }

    const updated = await channelRepository.updateChannel(request.params.id, parseResult.data);
    if (!updated) {
      return reply.status(404).send({ error: 'Channel not found' });
    }
    return sanitizeChannel(updated);
  });

  /**
   * DELETE /api/channels/all
   * Stops all streams and completely wipes all channels from the database
   */
  server.delete('/all', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const all = await channelRepository.listChannels();
      for (const ch of all) {
        if (ch.transcodingStatus === 'RUNNING') {
          await transcodingService.stopChannel(ch.id).catch(() => {});
        }
      }
      const count = await channelRepository.deleteAllChannels();
      return { success: true, count, message: `تم حذف جميع القنوات (${count}) بالكامل.` };
    } catch (err: any) {
      return reply.status(500).send({ error: 'Failed to delete all channels', message: err.message });
    }
  });

  /**
   * DELETE /api/channels/:id
   */
  server.delete('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    await transcodingService.stopChannel(request.params.id);
    const success = await channelRepository.deleteChannel(request.params.id);
    if (!success) {
      return reply.status(404).send({ error: 'Channel not found' });
    }
    return { success: true };
  });

  /**
   * POST /api/channels/:id/inspect
   */
  server.post('/:id/inspect', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const channel = await channelRepository.getChannel(request.params.id);
    if (!channel) {
      return reply.status(404).send({ error: 'Channel not found' });
    }

    const rawUrl = decrypt(channel.encryptedInputUrl);
    if (!rawUrl) {
      return reply.status(400).send({ error: 'Failed to decrypt channel source URL' });
    }

    try {
      const probeInfo = await probeStream(rawUrl, 10000);
      return { success: true, probe: probeInfo };
    } catch (err: any) {
      return reply.status(400).send({
        error: 'Stream inspection failed',
        message: err.message,
      });
    }
  });

  /**
   * POST /api/channels/:id/start
   */
  server.post('/:id/start', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const parseResult = StartTranscodingSchema.safeParse(request.body || {});
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation Error', details: parseResult.error.format() });
    }

    try {
      const job = await transcodingService.startChannel(request.params.id, parseResult.data);
      return { success: true, job };
    } catch (err: any) {
      return reply.status(400).send({
        error: 'Failed to start transcoding',
        message: err.message,
      });
    }
  });

  /**
   * POST /api/channels/:id/stop
   */
  server.post('/:id/stop', async (request: FastifyRequest<{ Params: { id: string } }>) => {
    const stopped = await transcodingService.stopChannel(request.params.id);
    return { success: stopped };
  });

  /**
   * POST /api/channels/:id/restart
   */
  server.post('/:id/restart', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    await transcodingService.stopChannel(request.params.id);
    // Short pause for clean cleanup
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const job = await transcodingService.startChannel(request.params.id);
      return { success: true, job };
    } catch (err: any) {
      return reply.status(400).send({ error: 'Failed to restart', message: err.message });
    }
  });
}


