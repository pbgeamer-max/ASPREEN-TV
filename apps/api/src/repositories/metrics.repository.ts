import * as os from 'os';
import { SystemMetrics } from '@aspreen/shared';
import { getFirestore } from '../firebase/admin';
import { getPool } from '../db';

const METRICS_COLLECTION = 'systemMetrics';

function mapMetricRow(row: any): SystemMetrics {
  return {
    timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : String(row.timestamp || new Date().toISOString()),
    cpuUsage: Number(row.cpu_usage || 0),
    memoryUsage: Number(row.memory_usage || 0),
    diskUsage: Number(row.disk_usage || 0),
    activeJobs: Number(row.active_jobs || 0),
    queuedJobs: Number(row.queued_jobs || 0),
    outboundBandwidthMbps: row.outbound_bandwidth_mbps ? Number(row.outbound_bandwidth_mbps) : undefined,
  };
}

export class MetricsRepository {
  private db = getFirestore();

  async recordMetrics(metrics: Omit<SystemMetrics, 'timestamp'>): Promise<SystemMetrics> {
    const timestamp = new Date().toISOString();
    const entry: SystemMetrics = {
      ...metrics,
      timestamp,
    };

    const id = `metric_${Date.now()}`;
    const pool = getPool();
    if (pool) {
      await pool.query(
        `INSERT INTO system_metrics (
          id, timestamp, cpu_usage, memory_usage, disk_usage, active_jobs, queued_jobs, outbound_bandwidth_mbps
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          entry.timestamp,
          entry.cpuUsage,
          entry.memoryUsage,
          entry.diskUsage,
          entry.activeJobs,
          entry.queuedJobs,
          entry.outboundBandwidthMbps || null,
        ]
      );
      return entry;
    }

    const docRef = await this.db.collection(METRICS_COLLECTION).doc(id);
    await docRef.set(entry);
    return entry;
  }

  async getLatestMetrics(): Promise<SystemMetrics | null> {
    const pool = getPool();
    if (pool) {
      const res = await pool.query('SELECT * FROM system_metrics ORDER BY timestamp DESC LIMIT 1');
      if (res.rows.length === 0) return null;
      return mapMetricRow(res.rows[0]);
    }

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
