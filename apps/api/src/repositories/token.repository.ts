import * as crypto from 'crypto';
import { StreamToken } from '@aspreen/shared';
import { getFirestore } from '../firebase/admin';
import { cleanUndefined } from '../firebase/utils';
import { getPool } from '../db';

const TOKENS_COLLECTION = 'streamTokens';

function mapTokenRow(row: any): StreamToken {
  return {
    id: row.id,
    channelId: row.channel_id,
    name: row.name,
    tokenHash: row.token_hash,
    publicOutputId: row.public_output_id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || new Date().toISOString()),
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : undefined,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : undefined,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : undefined,
  };
}

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

    const pool = getPool();
    if (pool) {
      await pool.query(
        `INSERT INTO stream_tokens (
          id, channel_id, name, token_hash, public_output_id, created_at,
          expires_at, revoked_at, last_used_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          token.id,
          token.channelId,
          token.name,
          token.tokenHash,
          token.publicOutputId,
          token.createdAt,
          token.expiresAt || null,
          token.revokedAt || null,
          token.lastUsedAt || null,
        ]
      );
      return token;
    }

    const docRef = await this.db.collection(TOKENS_COLLECTION).doc(id);
    await docRef.set(cleanUndefined(token));
    return token;
  }

  async createTokensBatch(
    tokensData: Omit<StreamToken, 'id' | 'createdAt'>[]
  ): Promise<number> {
    if (tokensData.length === 0) return 0;
    const now = new Date().toISOString();
    const pool = getPool();

    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const CHUNK_SIZE = 200;
        for (let i = 0; i < tokensData.length; i += CHUNK_SIZE) {
          const chunk = tokensData.slice(i, i + CHUNK_SIZE);
          const values: any[] = [];
          const placeholders: string[] = [];

          chunk.forEach((item, index) => {
            const id = crypto.randomUUID();
            const offset = index * 9;
            placeholders.push(
              `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`
            );
            values.push(
              id,
              item.channelId,
              item.name,
              item.tokenHash,
              item.publicOutputId,
              now,
              item.expiresAt || null,
              item.revokedAt || null,
              item.lastUsedAt || null
            );
          });

          await client.query(
            `INSERT INTO stream_tokens (
              id, channel_id, name, token_hash, public_output_id, created_at,
              expires_at, revoked_at, last_used_at
            ) VALUES ${placeholders.join(', ')}`,
            values
          );
        }
        await client.query('COMMIT');
        return tokensData.length;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    let total = 0;
    const BATCH_SIZE = 400;
    for (let i = 0; i < tokensData.length; i += BATCH_SIZE) {
      const chunk = tokensData.slice(i, i + BATCH_SIZE);
      const batch = this.db.batch();
      for (const item of chunk) {
        const id = crypto.randomUUID();
        const token: StreamToken = {
          ...item,
          id,
          createdAt: now,
        };
        const docRef = this.db.collection(TOKENS_COLLECTION).doc(id);
        batch.set(docRef, cleanUndefined(token));
      }
      await batch.commit();
      total += chunk.length;
    }
    return total;
  }

  async getTokenByHash(tokenHash: string): Promise<StreamToken | null> {
    const pool = getPool();
    if (pool) {
      const res = await pool.query('SELECT * FROM stream_tokens WHERE token_hash = $1 LIMIT 1', [tokenHash]);
      if (res.rows.length === 0) return null;
      return mapTokenRow(res.rows[0]);
    }

    const colRef = this.db.collection(TOKENS_COLLECTION);
    const snap = await colRef.where('tokenHash', '==', tokenHash).limit(1).get();
    if (snap.empty || snap.docs.length === 0) return null;
    return snap.docs[0].data() as StreamToken;
  }

  async getToken(id: string): Promise<StreamToken | null> {
    const pool = getPool();
    if (pool) {
      const res = await pool.query('SELECT * FROM stream_tokens WHERE id = $1', [id]);
      if (res.rows.length === 0) return null;
      return mapTokenRow(res.rows[0]);
    }

    const docRef = await this.db.collection(TOKENS_COLLECTION).doc(id);
    const snap = await docRef.get();
    if (!snap.exists) return null;
    return snap.data() as StreamToken;
  }

  async listTokens(channelId?: string, limitCount: number = 100): Promise<StreamToken[]> {
    const pool = getPool();
    if (pool) {
      let res;
      if (channelId) {
        res = await pool.query(
          'SELECT * FROM stream_tokens WHERE channel_id = $1 ORDER BY created_at DESC LIMIT $2',
          [channelId, limitCount]
        );
      } else {
        res = await pool.query('SELECT * FROM stream_tokens ORDER BY created_at DESC LIMIT $1', [limitCount]);
      }
      return res.rows.map(mapTokenRow);
    }

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
    const now = new Date().toISOString();
    const pool = getPool();
    if (pool) {
      const res = await pool.query('UPDATE stream_tokens SET revoked_at = $2 WHERE id = $1', [id, now]);
      return (res.rowCount ?? 0) > 0;
    }

    const docRef = await this.db.collection(TOKENS_COLLECTION).doc(id);
    const snap = await docRef.get();
    if (!snap.exists) return false;

    await docRef.update({
      revokedAt: now,
    });
    return true;
  }

  async updateLastUsed(id: string): Promise<void> {
    const now = new Date().toISOString();
    const pool = getPool();
    if (pool) {
      await pool.query('UPDATE stream_tokens SET last_used_at = $2 WHERE id = $1', [id, now]);
      return;
    }

    const docRef = await this.db.collection(TOKENS_COLLECTION).doc(id);
    await docRef.update({
      lastUsedAt: now,
    });
  }

  async deleteToken(id: string): Promise<boolean> {
    const pool = getPool();
    if (pool) {
      const res = await pool.query('DELETE FROM stream_tokens WHERE id = $1', [id]);
      return (res.rowCount ?? 0) > 0;
    }

    const docRef = await this.db.collection(TOKENS_COLLECTION).doc(id);
    const snap = await docRef.get();
    if (!snap.exists) return false;
    await docRef.delete();
    return true;
  }
}

export const tokenRepository = new TokenRepository();
