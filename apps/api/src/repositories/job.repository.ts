import * as crypto from 'crypto';
import { TranscodingJob, JobStatus } from '@aspreen/shared';
import { getFirestore } from '../firebase/admin';
import { cleanUndefined } from '../firebase/utils';
import { getPool } from '../db';

const JOBS_COLLECTION = 'transcodingJobs';

function mapJobRow(row: any): TranscodingJob {
  const config = typeof row.validated_configuration === 'string'
    ? JSON.parse(row.validated_configuration)
    : row.validated_configuration;

  return {
    id: row.id,
    channelId: row.channel_id,
    sourceId: row.source_id,
    status: row.status as JobStatus,
    preset: row.preset,
    validatedConfiguration: config,
    workerId: row.worker_id ?? undefined,
    processId: row.process_id ?? undefined,
    outputDirectoryId: row.output_directory_id,
    queuedAt: row.queued_at instanceof Date ? row.queued_at.toISOString() : String(row.queued_at || new Date().toISOString()),
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : undefined,
    stoppedAt: row.stopped_at ? new Date(row.stopped_at).toISOString() : undefined,
    lastHeartbeatAt: row.last_heartbeat_at ? new Date(row.last_heartbeat_at).toISOString() : undefined,
    lastErrorCode: row.last_error_code ?? undefined,
    sanitizedErrorMessage: row.sanitized_error_message ?? undefined,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || new Date().toISOString()),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || new Date().toISOString()),
  };
}

export class JobRepository {
  private db = getFirestore();

  async createJob(jobData: Omit<TranscodingJob, 'id' | 'createdAt' | 'updatedAt'>): Promise<TranscodingJob> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const job: TranscodingJob = {
      ...jobData,
      id,
      createdAt: now,
      updatedAt: now,
    };

    const pool = getPool();
    if (pool) {
      await pool.query(
        `INSERT INTO transcoding_jobs (
          id, channel_id, source_id, status, preset, validated_configuration,
          worker_id, process_id, output_directory_id, queued_at, started_at,
          stopped_at, last_heartbeat_at, last_error_code, sanitized_error_message,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          job.id,
          job.channelId,
          job.sourceId,
          job.status,
          job.preset,
          JSON.stringify(job.validatedConfiguration),
          job.workerId || null,
          job.processId || null,
          job.outputDirectoryId,
          job.queuedAt,
          job.startedAt || null,
          job.stoppedAt || null,
          job.lastHeartbeatAt || null,
          job.lastErrorCode || null,
          job.sanitizedErrorMessage || null,
          job.createdAt,
          job.updatedAt,
        ]
      );
      return job;
    }

    const docRef = await this.db.collection(JOBS_COLLECTION).doc(id);
    await docRef.set(cleanUndefined(job));
    return job;
  }

  async getJob(id: string): Promise<TranscodingJob | null> {
    const pool = getPool();
    if (pool) {
      const res = await pool.query('SELECT * FROM transcoding_jobs WHERE id = $1', [id]);
      if (res.rows.length === 0) return null;
      return mapJobRow(res.rows[0]);
    }

    const docRef = await this.db.collection(JOBS_COLLECTION).doc(id);
    const snap = await docRef.get();
    if (!snap.exists) return null;
    return snap.data() as TranscodingJob;
  }

  async getActiveJobForChannel(channelId: string): Promise<TranscodingJob | null> {
    const activeStatuses: JobStatus[] = ['QUEUED', 'VALIDATING', 'STARTING', 'RUNNING'];
    const pool = getPool();
    if (pool) {
      const res = await pool.query(
        'SELECT * FROM transcoding_jobs WHERE channel_id = $1 AND status = ANY($2::varchar[]) ORDER BY created_at DESC LIMIT 1',
        [channelId, activeStatuses]
      );
      if (res.rows.length === 0) return null;
      return mapJobRow(res.rows[0]);
    }

    const colRef = this.db.collection(JOBS_COLLECTION);
    const snap = await colRef.where('channelId', '==', channelId).get();

    for (const doc of snap.docs) {
      const job = doc.data() as TranscodingJob;
      if (activeStatuses.includes(job.status)) {
        return job;
      }
    }
    return null;
  }

  async listJobs(limitCount: number = 50): Promise<TranscodingJob[]> {
    const pool = getPool();
    if (pool) {
      const res = await pool.query('SELECT * FROM transcoding_jobs ORDER BY created_at DESC LIMIT $1', [limitCount]);
      return res.rows.map(mapJobRow);
    }

    const colRef = this.db.collection(JOBS_COLLECTION);
    const snap = await colRef.limit(limitCount).get();
    const jobs = snap.docs.map((d: any) => d.data() as TranscodingJob);
    return jobs.sort((a: TranscodingJob, b: TranscodingJob) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async listActiveJobs(): Promise<TranscodingJob[]> {
    const activeStatuses: JobStatus[] = ['QUEUED', 'VALIDATING', 'STARTING', 'RUNNING'];
    const pool = getPool();
    if (pool) {
      const res = await pool.query(
        'SELECT * FROM transcoding_jobs WHERE status = ANY($1::varchar[]) ORDER BY created_at DESC LIMIT 100',
        [activeStatuses]
      );
      return res.rows.map(mapJobRow);
    }

    const jobs = await this.listJobs(100);
    return jobs.filter((j) => activeStatuses.includes(j.status));
  }

  async updateJob(id: string, data: Partial<TranscodingJob>): Promise<TranscodingJob | null> {
    const existing = await this.getJob(id);
    if (!existing) return null;

    const updated: TranscodingJob = {
      ...existing,
      ...data,
      updatedAt: new Date().toISOString(),
    };

    const pool = getPool();
    if (pool) {
      await pool.query(
        `UPDATE transcoding_jobs SET
          channel_id = $2,
          source_id = $3,
          status = $4,
          preset = $5,
          validated_configuration = $6,
          worker_id = $7,
          process_id = $8,
          output_directory_id = $9,
          queued_at = $10,
          started_at = $11,
          stopped_at = $12,
          last_heartbeat_at = $13,
          last_error_code = $14,
          sanitized_error_message = $15,
          updated_at = $16
        WHERE id = $1`,
        [
          updated.id,
          updated.channelId,
          updated.sourceId,
          updated.status,
          updated.preset,
          JSON.stringify(updated.validatedConfiguration),
          updated.workerId || null,
          updated.processId || null,
          updated.outputDirectoryId,
          updated.queuedAt,
          updated.startedAt || null,
          updated.stoppedAt || null,
          updated.lastHeartbeatAt || null,
          updated.lastErrorCode || null,
          updated.sanitizedErrorMessage || null,
          updated.updatedAt,
        ]
      );
      return updated;
    }

    const docRef = await this.db.collection(JOBS_COLLECTION).doc(id);
    await docRef.update(cleanUndefined(updated));
    return updated;
  }
}

export const jobRepository = new JobRepository();
