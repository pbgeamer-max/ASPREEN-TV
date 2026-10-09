import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAdminAuth } from '../security/auth-guard';
import { jobRepository } from '../repositories/job.repository';
import { transcodingService } from '../services/transcoding.service';

export async function jobRoutes(server: FastifyInstance) {
  server.addHook('preHandler', requireAdminAuth);

  /**
   * GET /api/jobs
   */
  server.get('/', async (request: FastifyRequest<{ Querystring: { limit?: string } }>) => {
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
    return jobRepository.listJobs(limit);
  });

  /**
   * GET /api/jobs/:id
   */
  server.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const job = await jobRepository.getJob(request.params.id);
    if (!job) {
      return reply.status(404).send({ error: 'Job not found' });
    }
    return job;
  });

  /**
   * GET /api/jobs/:id/logs
   */
  server.get('/:id/logs', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const job = await jobRepository.getJob(request.params.id);
    if (!job) {
      return reply.status(404).send({ error: 'Job not found' });
    }
    return {
      jobId: job.id,
      status: job.status,
      processId: job.processId,
      lastHeartbeatAt: job.lastHeartbeatAt,
      lastErrorCode: job.lastErrorCode,
      sanitizedErrorMessage: job.sanitizedErrorMessage,
    };
  });

  /**
   * POST /api/jobs/:id/stop
   */
  server.post('/:id/stop', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const stopped = await transcodingService.stopJob(request.params.id);
    if (!stopped) {
      return reply.status(404).send({ error: 'Job not found or already stopped' });
    }
    return { success: true };
  });

  /**
   * POST /api/jobs/:id/retry
   */
  server.post('/:id/retry', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const job = await jobRepository.getJob(request.params.id);
    if (!job) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    try {
      const newJob = await transcodingService.startChannel(job.channelId, {
        preset: job.preset,
      });
      return { success: true, job: newJob };
    } catch (err: any) {
      return reply.status(400).send({ error: 'Retry failed', message: err.message });
    }
  });
}
