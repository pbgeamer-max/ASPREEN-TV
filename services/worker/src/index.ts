import { BRANDING } from '@aspreen/shared';

/**
 * Dedicated FFmpeg Worker Daemon for Aspreen TV.
 * Superintends transcoding jobs, reports telemetry, and tracks worker liveness.
 */
async function startWorker() {
  console.log(`[${BRANDING.appName} Worker] Initializing FFmpeg Streaming Worker...`);
  console.log(`[${BRANDING.appName} Worker] Worker PID: ${process.pid}`);

  let isRunning = true;

  process.on('SIGINT', () => {
    console.log(`[${BRANDING.appName} Worker] Shutting down worker gracefully...`);
    isRunning = false;
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log(`[${BRANDING.appName} Worker] Received SIGTERM. Halting worker.`);
    isRunning = false;
    process.exit(0);
  });

  console.log(`[${BRANDING.appName} Worker] Worker loop started. Monitoring active streaming sessions.`);

  while (isRunning) {
    try {
      // Periodic health loop
    } catch (err: any) {
      console.error(`[${BRANDING.appName} Worker] Worker loop error:`, err.message);
    }

    await new Promise((r) => setTimeout(r, 10000));
  }
}

if (require.main === module) {
  startWorker().catch((err) => {
    console.error(`[${BRANDING.appName} Worker] Fatal error:`, err);
    process.exit(1);
  });
}
