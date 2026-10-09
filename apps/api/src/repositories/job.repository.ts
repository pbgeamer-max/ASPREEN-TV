import * as crypto from 'crypto';
import { TranscodingJob, JobStatus } from '@aspreen/shared';
import { getFirestore } from '../firebase/admin';
import { cleanUndefined } from '../firebase/utils';

const JOBS_COLLECTION = 'transcodingJobs';

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

    const docRef = await this.db.collection(JOBS_COLLECTION).doc(id);
    await docRef.set(cleanUndefined(job));
    return job;
  }

  async getJob(id: string): Promise<TranscodingJob | null> {
    const docRef = await this.db.collection(JOBS_COLLECTION).doc(id);
    const snap = await docRef.get();
    if (!snap.exists) return null;
    return snap.data() as TranscodingJob;
  }

  async getActiveJobForChannel(channelId: string): Promise<TranscodingJob | null> {
    const activeStatuses: JobStatus[] = ['QUEUED', 'VALIDATING', 'STARTING', 'RUNNING'];
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
    const colRef = this.db.collection(JOBS_COLLECTION);
    const snap = await colRef.limit(limitCount).get();
    const jobs = snap.docs.map((d: any) => d.data() as TranscodingJob);
    // Sort descending by queuedAt or createdAt
    return jobs.sort((a: TranscodingJob, b: TranscodingJob) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async listActiveJobs(): Promise<TranscodingJob[]> {
    const activeStatuses: JobStatus[] = ['QUEUED', 'VALIDATING', 'STARTING', 'RUNNING'];
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

    const docRef = await this.db.collection(JOBS_COLLECTION).doc(id);
    await docRef.update(cleanUndefined(updated));
    return updated;
  }
}

export const jobRepository = new JobRepository();
