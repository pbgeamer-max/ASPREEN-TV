import * as crypto from 'crypto';
import { Source } from '@aspreen/shared';
import { getFirestore } from '../firebase/admin';
import { cleanUndefined } from '../firebase/utils';
import { getPool } from '../db';

const SOURCES_COLLECTION = 'sources';

function mapSourceRow(row: any): Source {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    sanitizedHostname: row.sanitized_hostname,
    encryptedUrl: row.encrypted_url,
    encryptedCredentials: row.encrypted_credentials ?? undefined,
    enabled: Boolean(row.enabled),
    connectionStatus: row.connection_status,
    channelCount: Number(row.channel_count || 0),
    lastCheckedAt: row.last_checked_at ? new Date(row.last_checked_at).toISOString() : undefined,
    lastErrorCode: row.last_error_code ?? undefined,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || new Date().toISOString()),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || new Date().toISOString()),
  };
}

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

    const pool = getPool();
    if (pool) {
      await pool.query(
        `INSERT INTO sources (
          id, name, type, sanitized_hostname, encrypted_url, encrypted_credentials,
          enabled, connection_status, channel_count, last_checked_at, last_error_code,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          source.id,
          source.name,
          source.type,
          source.sanitizedHostname,
          source.encryptedUrl,
          source.encryptedCredentials || null,
          source.enabled,
          source.connectionStatus,
          source.channelCount,
          source.lastCheckedAt || null,
          source.lastErrorCode || null,
          source.createdAt,
          source.updatedAt,
        ]
      );
      return source;
    }

    const docRef = await this.db.collection(SOURCES_COLLECTION).doc(id);
    await docRef.set(cleanUndefined(source));
    return source;
  }

  async getSource(id: string): Promise<Source | null> {
    const pool = getPool();
    if (pool) {
      const res = await pool.query('SELECT * FROM sources WHERE id = $1', [id]);
      if (res.rows.length === 0) return null;
      return mapSourceRow(res.rows[0]);
    }

    const docRef = await this.db.collection(SOURCES_COLLECTION).doc(id);
    const snap = await docRef.get();
    if (!snap.exists) return null;
    return snap.data() as Source;
  }

  async listSources(limitCount: number = 100): Promise<Source[]> {
    const pool = getPool();
    let sources: Source[] = [];
    if (pool) {
      const res = await pool.query('SELECT * FROM sources ORDER BY created_at ASC LIMIT $1', [limitCount]);
      sources = res.rows.map(mapSourceRow);
    } else {
      try {
        const colRef = this.db.collection(SOURCES_COLLECTION);
        const snap = await colRef.limit(limitCount).get();
        sources = snap.docs.map((d: any) => d.data() as Source);
      } catch {}
    }

    if (sources.length === 0) {
      sources = [
        {
          id: 'yacine-website',
          name: 'Yacine TV (325 قنوات)',
          type: 'M3U',
          sanitizedHostname: 'yacine.website',
          encryptedUrl: '',
          enabled: true,
          connectionStatus: 'ONLINE',

          channelCount: 325,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
    }
    return sources;
  }


  async updateSource(id: string, data: Partial<Source>): Promise<Source | null> {
    const existing = await this.getSource(id);
    if (!existing) return null;

    const updated: Source = {
      ...existing,
      ...data,
      updatedAt: new Date().toISOString(),
    };

    const pool = getPool();
    if (pool) {
      await pool.query(
        `UPDATE sources SET
          name = $2,
          type = $3,
          sanitized_hostname = $4,
          encrypted_url = $5,
          encrypted_credentials = $6,
          enabled = $7,
          connection_status = $8,
          channel_count = $9,
          last_checked_at = $10,
          last_error_code = $11,
          updated_at = $12
        WHERE id = $1`,
        [
          updated.id,
          updated.name,
          updated.type,
          updated.sanitizedHostname,
          updated.encryptedUrl,
          updated.encryptedCredentials || null,
          updated.enabled,
          updated.connectionStatus,
          updated.channelCount,
          updated.lastCheckedAt || null,
          updated.lastErrorCode || null,
          updated.updatedAt,
        ]
      );
      return updated;
    }

    const docRef = await this.db.collection(SOURCES_COLLECTION).doc(id);
    await docRef.update(cleanUndefined(updated));
    return updated;
  }

  async deleteSource(id: string): Promise<boolean> {
    const pool = getPool();
    if (pool) {
      const res = await pool.query('DELETE FROM sources WHERE id = $1', [id]);
      return (res.rowCount ?? 0) > 0;
    }

    const docRef = await this.db.collection(SOURCES_COLLECTION).doc(id);
    const snap = await docRef.get();
    if (!snap.exists) return false;
    await docRef.delete();
    return true;
  }
}

export const sourceRepository = new SourceRepository();
