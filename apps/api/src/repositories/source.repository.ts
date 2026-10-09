import * as crypto from 'crypto';
import { Source } from '@aspreen/shared';
import { getFirestore } from '../firebase/admin';
import { cleanUndefined } from '../firebase/utils';

const SOURCES_COLLECTION = 'sources';

export class SourceRepository {
  private db = getFirestore();

  async createSource(sourceData: Omit<Source, 'id' | 'createdAt' | 'updatedAt'>): Promise<Source> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const source: Source = {
      ...sourceData,
      id,
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await this.db.collection(SOURCES_COLLECTION).doc(id);
    await docRef.set(cleanUndefined(source));
    return source;
  }

  async getSource(id: string): Promise<Source | null> {
    const docRef = await this.db.collection(SOURCES_COLLECTION).doc(id);
    const snap = await docRef.get();
    if (!snap.exists) return null;
    return snap.data() as Source;
  }

  async listSources(limitCount: number = 100): Promise<Source[]> {
    const colRef = this.db.collection(SOURCES_COLLECTION);
    const snap = await colRef.limit(limitCount).get();
    return snap.docs.map((d: any) => d.data() as Source);
  }

  async updateSource(id: string, data: Partial<Source>): Promise<Source | null> {
    const existing = await this.getSource(id);
    if (!existing) return null;

    const updated: Source = {
      ...existing,
      ...data,
      updatedAt: new Date().toISOString(),
    };

    const docRef = await this.db.collection(SOURCES_COLLECTION).doc(id);
    await docRef.update(cleanUndefined(updated));
    return updated;
  }

  async deleteSource(id: string): Promise<boolean> {
    const docRef = await this.db.collection(SOURCES_COLLECTION).doc(id);
    const snap = await docRef.get();
    if (!snap.exists) return false;
    await docRef.delete();
    return true;
  }
}

export const sourceRepository = new SourceRepository();
