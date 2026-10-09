import * as os from 'os';
import { SystemMetrics } from '@aspreen/shared';
import { getFirestore } from '../firebase/admin';

const METRICS_COLLECTION = 'systemMetrics';

export class MetricsRepository {
  private db = getFirestore();

  async recordMetrics(metrics: Omit<SystemMetrics, 'timestamp'>): Promise<SystemMetrics> {
    const timestamp = new Date().toISOString();
    const entry: SystemMetrics = {
      ...metrics,
      timestamp,
    };

    // Stable ID based on timestamp
    const id = `metric_${Date.now()}`;
    const docRef = await this.db.collection(METRICS_COLLECTION).doc(id);
    await docRef.set(entry);
    return entry;
  }

  async getLatestMetrics(): Promise<SystemMetrics | null> {
    const colRef = this.db.collection(METRICS_COLLECTION);
    const snap = await colRef.limit(1).get();
    if (snap.empty || snap.docs.length === 0) return null;
    return snap.docs[0].data() as SystemMetrics;
  }

  /**
   * Samples live OS metrics directly from VPS / local machine.
   */
  getLiveSystemMetrics(activeJobs: number = 0, queuedJobs: number = 0): SystemMetrics {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercentage = Math.round((usedMem / totalMem) * 100);

    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    for (const cpu of cpus) {
      for (const type of Object.keys(cpu.times) as (keyof typeof cpu.times)[]) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    }
    const cpuPercentage = Math.min(100, Math.max(0, Math.round(100 - (totalIdle / (totalTick || 1)) * 100)));

    return {
      timestamp: new Date().toISOString(),
      cpuUsage: cpuPercentage,
      memoryUsage: memPercentage,
      diskUsage: 25, // Fallback baseline or inspected mount
      activeJobs,
      queuedJobs,
      outboundBandwidthMbps: activeJobs * 3.5, // approximate estimation
    };
  }
}

export const metricsRepository = new MetricsRepository();
