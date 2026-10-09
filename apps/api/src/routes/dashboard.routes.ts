import { FastifyInstance, FastifyRequest } from 'fastify';
import { requireAdminAuth } from '../security/auth-guard';
import { sourceRepository } from '../repositories/source.repository';
import { channelRepository } from '../repositories/channel.repository';
import { jobRepository } from '../repositories/job.repository';
import { logRepository } from '../repositories/log.repository';
import { metricsRepository } from '../repositories/metrics.repository';
import { tokenRepository } from '../repositories/token.repository';
import { DashboardSummary } from '@aspreen/shared';

export async function dashboardRoutes(server: FastifyInstance) {
  server.addHook('preHandler', requireAdminAuth);

  /**
   * GET /api/dashboard/summary
   */
  server.get('/summary', async (_request: FastifyRequest): Promise<DashboardSummary> => {
    const sources = await sourceRepository.listSources();
    const channels = await channelRepository.listChannels(undefined, 2000);
    const jobs = await jobRepository.listJobs(50);
    const tokens = await tokenRepository.listTokens();
    const recentActivity = await logRepository.listLogs(10);

    const activeJobs = jobs.filter((j) => j.status === 'RUNNING');
    const queuedJobs = jobs.filter((j) => j.status === 'QUEUED' || j.status === 'STARTING');
    const failedJobs = jobs.filter((j) => j.status === 'FAILED');

    const liveMetrics = metricsRepository.getLiveSystemMetrics(activeJobs.length, queuedJobs.length);

    return {
      totalSources: sources.length,
      totalChannels: channels.length,
      activeJobs: activeJobs.length,
      queuedJobs: queuedJobs.length,
      failedJobs: failedJobs.length,
      activeOutputs: tokens.filter((t) => !t.revokedAt).length,
      system: {
        cpuUsage: liveMetrics.cpuUsage,
        memoryUsage: liveMetrics.memoryUsage,
        diskUsage: liveMetrics.diskUsage,
        networkThroughputMbps: liveMetrics.outboundBandwidthMbps || 0,
        isAvailable: true,
      },
      recentJobs: jobs.slice(0, 10),
      recentActivity,
    };
  });

  /**
   * GET /api/dashboard/activity
   */
  server.get('/activity', async (_request: FastifyRequest) => {
    return logRepository.listLogs(25);
  });

  /**
   * GET /api/dashboard/metrics
   */
  server.get('/metrics', async (_request: FastifyRequest) => {
    const activeJobs = await jobRepository.listActiveJobs();
    return metricsRepository.getLiveSystemMetrics(activeJobs.length, 0);
  });
}
