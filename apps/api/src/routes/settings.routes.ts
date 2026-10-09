import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAdminAuth } from '../security/auth-guard';
import { settingsRepository } from '../repositories/settings.repository';
import { logRepository } from '../repositories/log.repository';
import { checkFirebaseHealth } from '../firebase/admin';
import { AdminSettingsUpdateSchema } from '@aspreen/shared';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { config } from '../config';

const execAsync = promisify(exec);

export async function settingsRoutes(server: FastifyInstance) {
  /**
   * GET /api/health (Public endpoint for container orchestrators and monitoring)
   */
  server.get('/health', async (_request: FastifyRequest) => {
    const firebaseHealth = await checkFirebaseHealth();

    // Check FFmpeg binary
    let ffmpegOk = false;
    try {
      await execAsync('ffmpeg -version');
      ffmpegOk = true;
    } catch {}

    // Check storage writable
    let storageOk = false;
    try {
      await fs.mkdir(config.streamStoragePath, { recursive: true });
      storageOk = true;
    } catch {}

    const isHealthy = firebaseHealth.status !== 'ERROR' && storageOk;

    return {
      status: isHealthy ? 'OK' : 'DEGRADED',
      timestamp: new Date().toISOString(),
      services: {
        api: 'UP',
        firebase: firebaseHealth,
        ffmpeg: ffmpegOk ? 'INSTALLED' : 'UNAVAILABLE',
        storage: storageOk ? 'WRITABLE' : 'UNWRITABLE',
      },
    };
  });

  // Protected Settings & Logs
  server.register(async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', requireAdminAuth);

    protectedRoutes.get('/settings', async (_request: FastifyRequest) => {
      return settingsRepository.getSettings();
    });

    protectedRoutes.patch('/settings', async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = AdminSettingsUpdateSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({ error: 'Validation Error', details: parseResult.error.format() });
      }

      const updated = await settingsRepository.updateSettings(parseResult.data);

      await logRepository.addLog({
        eventType: 'SETTINGS_UPDATED',
        entityType: 'SETTINGS',
        result: 'SUCCESS',
        safeDetails: { updatedFields: Object.keys(parseResult.data) },
      });

      return updated;
    });

    protectedRoutes.get('/activity-logs', async (request: FastifyRequest<{ Querystring: { limit?: string } }>) => {
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
      return logRepository.listLogs(limit);
    });
  });
}
