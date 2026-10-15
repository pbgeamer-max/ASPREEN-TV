import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Channel } from '@aspreen/shared';
import { getFirestore } from '../firebase/admin';
import { cleanUndefined } from '../firebase/utils';
import { getPool } from '../db';
import { encrypt } from '../security/encryption';

const CHANNELS_COLLECTION = 'channels';

function findChannelsJsonPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'channels.json'),
    path.resolve(process.cwd(), 'apps/api/channels.json'),
    path.resolve(process.cwd(), '../../channels.json'),
    path.resolve(__dirname, '../../../../channels.json'),
    path.resolve(__dirname, '../../../channels.json'),
    path.resolve('/app/channels.json'),
    path.resolve('/app/apps/api/channels.json'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

let cachedJsonChannels: Channel[] | null = null;
let lastJsonLoadTime = 0;

function getChannelsFromJson(): Channel[] {
  const p = findChannelsJsonPath();
  if (!p) return [];

  const now = Date.now();
  if (cachedJsonChannels && now - lastJsonLoadTime < 60000) {
    return cachedJsonChannels;
  }

  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const list = JSON.parse(raw);
    cachedJsonChannels = list.map((item: any, idx: number): Channel => {
      const cid = String(item.id || item.vid);
      const stream = item.streamUrl || item.directM3u8 || '';
      return {
        id: cid,
        sourceId: 'yacine-website',
        name: item.name || 'قناة غير معنونة',
        normalizedName: (item.name || '').toLowerCase().trim(),
        groupTitle: item.groupTitle || 'عام',
        logoUrl: item.logoUrl || undefined,
        inputType: 'HLS',
        encryptedInputUrl: encrypt(stream),
        enabled: true,
        inputStatus: 'ONLINE',
        transcodingStatus: 'RUNNING',
        proxyUrl: `/live/${cid}.m3u8`,
        preset: 'COPY',
        orderIndex: item.orderIndex || (idx + 1),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });
    lastJsonLoadTime = now;
    return cachedJsonChannels || [];
  } catch {
    return cachedJsonChannels || [];
  }
}

function mapChannelRow(row: any): Channel {
  const cid = String(row.id);
  return {
    id: cid,
    sourceId: row.source_id,
    externalIdentifier: row.external_identifier ?? undefined,
    name: row.name,
    normalizedName: row.normalized_name,
    groupTitle: row.group_title ?? undefined,
    logoUrl: row.logo_url ?? undefined,
    inputType: row.input_type,
    encryptedInputUrl: row.encrypted_input_url,
    enabled: Boolean(row.enabled),
    inputStatus: row.input_status || 'ONLINE',
    transcodingStatus: row.transcoding_status || 'RUNNING',
    preset: row.preset,
    proxyUrl: row.proxy_url || `/live/${cid}.m3u8`,
    activeJobId: row.active_job_id ?? undefined,
    activeOutputId: row.active_output_id ?? undefined,
    orderIndex: row.order_index !== null && row.order_index !== undefined ? Number(row.order_index) : 0,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || new Date().toISOString()),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || new Date().toISOString()),
  };
}


export class ChannelRepository {
  private db = getFirestore();

  async createChannel(channelData: Omit<Channel, 'id' | 'createdAt' | 'updatedAt'>): Promise<Channel> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const channel: Channel = {
      ...channelData,
      id,
      orderIndex: channelData.orderIndex ?? 0,
      createdAt: now,
      updatedAt: now,
    };

    const pool = getPool();
    if (pool) {
      await pool.query(
        `INSERT INTO channels (
          id, source_id, external_identifier, name, normalized_name, group_title, logo_url,
          input_type, encrypted_input_url, enabled, input_status, transcoding_status,
          preset, proxy_url, active_job_id, active_output_id, order_index, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [
          channel.id,
          channel.sourceId,
          channel.externalIdentifier || null,
          channel.name,
          channel.normalizedName,
          channel.groupTitle || null,
          channel.logoUrl || null,
          channel.inputType,
          channel.encryptedInputUrl,
          channel.enabled,
          channel.inputStatus,
          channel.transcodingStatus,
          channel.preset,
          channel.proxyUrl || null,
          channel.activeJobId || null,
          channel.activeOutputId || null,
          channel.orderIndex || 0,
          channel.createdAt,
          channel.updatedAt,
        ]
      );
      return channel;
    }

    const docRef = await this.db.collection(CHANNELS_COLLECTION).doc(id);
    await docRef.set(cleanUndefined(channel));
    return channel;
  }

  async getChannel(id: string): Promise<Channel | null> {
    const pool = getPool();
    if (pool) {
      const res = await pool.query('SELECT * FROM channels WHERE id = $1', [id]);
      if (res.rows.length > 0) return mapChannelRow(res.rows[0]);
    } else {
      try {
        const docRef = await this.db.collection(CHANNELS_COLLECTION).doc(id);
        const snap = await docRef.get();
        if (snap.exists) return snap.data() as Channel;
      } catch {}
    }

    // Fallback to channels.json
    const jsonChannels = getChannelsFromJson();
    return jsonChannels.find((c) => c.id === id || (c as any).externalIdentifier === id) || null;
  }

  async listChannels(sourceId?: string, limitCount?: number): Promise<Channel[]> {
    const pool = getPool();
    let channels: Channel[] = [];

    if (pool) {
      let res;
      if (sourceId) {
        if (limitCount && limitCount > 0) {
          res = await pool.query(
            'SELECT * FROM channels WHERE source_id = $1 ORDER BY order_index ASC, created_at ASC, id ASC LIMIT $2',
            [sourceId, limitCount]
          );
        } else {
          res = await pool.query(
            'SELECT * FROM channels WHERE source_id = $1 ORDER BY order_index ASC, created_at ASC, id ASC',
            [sourceId]
          );
        }
      } else {
        if (limitCount && limitCount > 0) {
          res = await pool.query('SELECT * FROM channels ORDER BY order_index ASC, created_at ASC, id ASC LIMIT $1', [limitCount]);
        } else {
          res = await pool.query('SELECT * FROM channels ORDER BY order_index ASC, created_at ASC, id ASC');
        }
      }
      channels = res.rows.map(mapChannelRow);
    } else {
      try {
        const colRef = this.db.collection(CHANNELS_COLLECTION);
        let snap: any;
        if (sourceId) {
          if (limitCount && limitCount > 0) {
            snap = await colRef.where('sourceId', '==', sourceId).limit(limitCount).get();
          } else {
            snap = await colRef.where('sourceId', '==', sourceId).get();
          }
        } else {
          if (limitCount && limitCount > 0) {
            snap = await colRef.limit(limitCount).get();
          } else {
            snap = await colRef.get();
          }
        }
        channels = snap.docs.map((d: any) => d.data() as Channel);
      } catch {}
    }

    // If database has 0 channels, seamlessly serve from channels.json
    if (channels.length === 0) {
      channels = getChannelsFromJson();
      if (sourceId) {
        channels = channels.filter((c) => c.sourceId === sourceId);
      }
      if (limitCount && limitCount > 0) {
        channels = channels.slice(0, limitCount);
      }
    }

    return channels;
  }


  async updateChannel(id: string, data: Partial<Channel>): Promise<Channel | null> {
    const existing = await this.getChannel(id);
    if (!existing) return null;

    const updated: Channel = {
      ...existing,
      ...data,
      updatedAt: new Date().toISOString(),
    };

    const pool = getPool();
    if (pool) {
      await pool.query(
        `UPDATE channels SET
          source_id = $2,
          external_identifier = $3,
          name = $4,
          normalized_name = $5,
          group_title = $6,
          logo_url = $7,
          input_type = $8,
          encrypted_input_url = $9,
          enabled = $10,
          input_status = $11,
          transcoding_status = $12,
          preset = $13,
          proxy_url = $14,
          active_job_id = $15,
          active_output_id = $16,
          updated_at = $17
        WHERE id = $1`,
        [
          updated.id,
          updated.sourceId,
          updated.externalIdentifier || null,
          updated.name,
          updated.normalizedName,
          updated.groupTitle || null,
          updated.logoUrl || null,
          updated.inputType,
          updated.encryptedInputUrl,
          updated.enabled,
          updated.inputStatus,
          updated.transcodingStatus,
          updated.preset,
          updated.proxyUrl || null,
          updated.activeJobId || null,
          updated.activeOutputId || null,
          updated.updatedAt,
        ]
      );
      return updated;
    }

    const docRef = await this.db.collection(CHANNELS_COLLECTION).doc(id);
    await docRef.update(cleanUndefined(updated));
    return updated;
  }

  async createChannelsBatch(
    channelsData: Omit<Channel, 'id' | 'createdAt' | 'updatedAt'>[]
  ): Promise<number> {
    if (channelsData.length === 0) return 0;

    const now = new Date().toISOString();
    const pool = getPool();

    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const CHUNK_SIZE = 100;
        for (let i = 0; i < channelsData.length; i += CHUNK_SIZE) {
          const chunk = channelsData.slice(i, i + CHUNK_SIZE);
          const values: any[] = [];
          const placeholders: string[] = [];

          chunk.forEach((item, index) => {
            const id = crypto.randomUUID();
            const orderIndex = item.orderIndex !== undefined ? item.orderIndex : (i + index);
            const offset = index * 19;
            placeholders.push(
              `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16}, $${offset + 17}, $${offset + 18}, $${offset + 19})`
            );
            values.push(
              id,
              item.sourceId,
              item.externalIdentifier || null,
              item.name,
              item.normalizedName,
              item.groupTitle || null,
              item.logoUrl || null,
              item.inputType,
              item.encryptedInputUrl,
              item.enabled ?? true,
              item.inputStatus || 'UNKNOWN',
              item.transcodingStatus || 'STOPPED',
              item.preset || 'COPY',
              item.proxyUrl || null,
              item.activeJobId || null,
              item.activeOutputId || null,
              orderIndex,
              now,
              now
            );
          });

          await client.query(
            `INSERT INTO channels (
              id, source_id, external_identifier, name, normalized_name, group_title, logo_url,
              input_type, encrypted_input_url, enabled, input_status, transcoding_status,
              preset, proxy_url, active_job_id, active_output_id, order_index, created_at, updated_at
            ) VALUES ${placeholders.join(', ')}`,
            values
          );
        }
        await client.query('COMMIT');
        return channelsData.length;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    let totalCreated = 0;
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
    const pool = getPool();
    if (pool) {
      const res = await pool.query('DELETE FROM channels WHERE id = $1', [id]);
      return (res.rowCount ?? 0) > 0;
    }

    const docRef = await this.db.collection(CHANNELS_COLLECTION).doc(id);
    const snap = await docRef.get();
    if (!snap.exists) return false;
    await docRef.delete();
    return true;
  }

  async deleteChannelsBySource(sourceId: string): Promise<number> {
    const pool = getPool();
    if (pool) {
      const res = await pool.query('DELETE FROM channels WHERE source_id = $1 OR source_id = $2', [
        sourceId,
        sourceId === 'aflam4you/koora_live' ? 'aflam4you/koora' : sourceId,
      ]);
      return res.rowCount ?? 0;
    }

    const colRef = this.db.collection(CHANNELS_COLLECTION);
    const snap = await colRef.where('sourceId', '==', sourceId).get();
    const batch = this.db.batch();
    snap.docs.forEach((d: any) => batch.delete(d.ref));
    await batch.commit();
    return snap.docs.length;
  }

  async deleteAllChannels(): Promise<number> {
    const pool = getPool();
    if (pool) {
      const res = await pool.query('DELETE FROM channels');
      return res.rowCount ?? 0;
    }

    const colRef = this.db.collection(CHANNELS_COLLECTION);
    const snap = await colRef.get();
    const batch = this.db.batch();
    snap.docs.forEach((d: any) => batch.delete(d.ref));
    await batch.commit();
    return snap.docs.length;
  }

  async findChannelByNormalizedName(normalizedName: string): Promise<Channel | null> {
    const pool = getPool();
    if (pool) {
      const res = await pool.query('SELECT * FROM channels WHERE normalized_name = $1 LIMIT 1', [normalizedName]);
      if (res.rows.length === 0) return null;
      return mapChannelRow(res.rows[0]);
    }

    const colRef = this.db.collection(CHANNELS_COLLECTION);
    const snap = await colRef.where('normalizedName', '==', normalizedName).limit(1).get();
    if (snap.empty) return null;
    return snap.docs[0].data() as Channel;
  }

  async deleteChannelsBySourceId(sourceId: string): Promise<number> {
    const pool = getPool();
    if (pool) {
      const res = await pool.query('DELETE FROM channels WHERE source_id = $1', [sourceId]);
      return res.rowCount ?? 0;
    }

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
