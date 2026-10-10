import * as crypto from 'crypto';
import { Channel } from '@aspreen/shared';
import { getFirestore } from '../firebase/admin';
import { cleanUndefined } from '../firebase/utils';

const CHANNELS_COLLECTION = 'channels';

export class ChannelRepository {
  private db = getFirestore();

  async createChannel(channelData: Omit<Channel, 'id' | 'createdAt' | 'updatedAt'>): Promise<Channel> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const channel: Channel = {
      ...channelData,
      id,
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await this.db.collection(CHANNELS_COLLECTION).doc(id);
    await docRef.set(cleanUndefined(channel));
    return channel;
  }

  async getChannel(id: string): Promise<Channel | null> {
    const docRef = await this.db.collection(CHANNELS_COLLECTION).doc(id);
    const snap = await docRef.get();
    if (!snap.exists) return null;
    return snap.data() as Channel;
  }

  async listChannels(sourceId?: string, limitCount: number = 200): Promise<Channel[]> {
    const colRef = this.db.collection(CHANNELS_COLLECTION);
    let snap: any;

    if (sourceId) {
      snap = await colRef.where('sourceId', '==', sourceId).limit(limitCount).get();
    } else {
      snap = await colRef.limit(limitCount).get();
    }

    return snap.docs.map((d: any) => d.data() as Channel);
  }

  async updateChannel(id: string, data: Partial<Channel>): Promise<Channel | null> {
    const existing = await this.getChannel(id);
    if (!existing) return null;

    const updated: Channel = {
      ...existing,
      ...data,
      updatedAt: new Date().toISOString(),
    };

    const docRef = await this.db.collection(CHANNELS_COLLECTION).doc(id);
    await docRef.update(cleanUndefined(updated));
    return updated;
  }

  async createChannelsBatch(
    channelsData: Omit<Channel, 'id' | 'createdAt' | 'updatedAt'>[]
  ): Promise<number> {
    if (channelsData.length === 0) return 0;

    const now = new Date().toISOString();
    let totalCreated = 0;

    // Firestore batch limit is 500 operations per batch
    const BATCH_SIZE = 400;
    for (let i = 0; i < channelsData.length; i += BATCH_SIZE) {
      const chunk = channelsData.slice(i, i + BATCH_SIZE);
      const batch = this.db.batch();

      for (const item of chunk) {
        const id = crypto.randomUUID();
        const channel: Channel = {
          ...item,
          id,
          createdAt: now,
          updatedAt: now,
        };
        const docRef = this.db.collection(CHANNELS_COLLECTION).doc(id);
        batch.set(docRef, cleanUndefined(channel));
      }

      await batch.commit();
      totalCreated += chunk.length;
    }

    return totalCreated;
  }

  async deleteChannel(id: string): Promise<boolean> {
    const docRef = await this.db.collection(CHANNELS_COLLECTION).doc(id);
    const snap = await docRef.get();
    if (!snap.exists) return false;
    await docRef.delete();
    return true;
  }

  async deleteChannelsBySourceId(sourceId: string): Promise<number> {
    const colRef = this.db.collection(CHANNELS_COLLECTION);
    const snap = await colRef.where('sourceId', '==', sourceId).get();
    if (snap.empty) return 0;

    const BATCH_SIZE = 400;
    const docs = snap.docs;
    let count = 0;

    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const chunk = docs.slice(i, i + BATCH_SIZE);
      const batch = this.db.batch();
      for (const doc of chunk) {
        batch.delete(doc.ref);
      }
      await batch.commit();
      count += chunk.length;
    }

    return count;
  }
}

export const channelRepository = new ChannelRepository();
