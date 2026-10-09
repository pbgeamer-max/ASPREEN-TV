import * as crypto from 'crypto';
import { StreamToken } from '@aspreen/shared';
import { getFirestore } from '../firebase/admin';

const TOKENS_COLLECTION = 'streamTokens';

export class TokenRepository {
  private db = getFirestore();

  async createToken(tokenData: Omit<StreamToken, 'id' | 'createdAt'>): Promise<StreamToken> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const token: StreamToken = {
      ...tokenData,
      id,
      createdAt: now,
    };

    const docRef = await this.db.collection(TOKENS_COLLECTION).doc(id);
    await docRef.set(token);
    return token;
  }

  async getTokenByHash(tokenHash: string): Promise<StreamToken | null> {
    const colRef = this.db.collection(TOKENS_COLLECTION);
    const snap = await colRef.where('tokenHash', '==', tokenHash).limit(1).get();
    if (snap.empty || snap.docs.length === 0) return null;
    return snap.docs[0].data() as StreamToken;
  }

  async getToken(id: string): Promise<StreamToken | null> {
    const docRef = await this.db.collection(TOKENS_COLLECTION).doc(id);
    const snap = await docRef.get();
    if (!snap.exists) return null;
    return snap.data() as StreamToken;
  }

  async listTokens(channelId?: string, limitCount: number = 100): Promise<StreamToken[]> {
    const colRef = this.db.collection(TOKENS_COLLECTION);
    let snap: any;

    if (channelId) {
      snap = await colRef.where('channelId', '==', channelId).limit(limitCount).get();
    } else {
      snap = await colRef.limit(limitCount).get();
    }

    const tokens = snap.docs.map((d: any) => d.data() as StreamToken);
    return tokens.sort((a: StreamToken, b: StreamToken) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async revokeToken(id: string): Promise<boolean> {
    const docRef = await this.db.collection(TOKENS_COLLECTION).doc(id);
    const snap = await docRef.get();
    if (!snap.exists) return false;

    await docRef.update({
      revokedAt: new Date().toISOString(),
    });
    return true;
  }

  async updateLastUsed(id: string): Promise<void> {
    const docRef = await this.db.collection(TOKENS_COLLECTION).doc(id);
    await docRef.update({
      lastUsedAt: new Date().toISOString(),
    });
  }

  async deleteToken(id: string): Promise<boolean> {
    const docRef = await this.db.collection(TOKENS_COLLECTION).doc(id);
    const snap = await docRef.get();
    if (!snap.exists) return false;
    await docRef.delete();
    return true;
  }
}

export const tokenRepository = new TokenRepository();
