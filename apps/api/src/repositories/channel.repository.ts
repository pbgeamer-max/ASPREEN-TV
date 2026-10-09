import * as crypto from 'crypto';
import { Channel } from '@aspreen/shared';
import { getFirestore } from '../firebase/admin';

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
    await docRef.set(channel);
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
    await docRef.update(updated);
    return updated;
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
    let count = 0;
    for (const doc of snap.docs) {
      const docRef = await this.db.collection(CHANNELS_COLLECTION).doc(doc.id);
      await docRef.delete();
      count++;
    }
    return count;
  }
}

export const channelRepository = new ChannelRepository();
