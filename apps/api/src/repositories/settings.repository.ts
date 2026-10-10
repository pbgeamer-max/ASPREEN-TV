import { AdminSettings } from '@aspreen/shared';
import { getFirestore } from '../firebase/admin';
import { cleanUndefined } from '../firebase/utils';
import { getPool } from '../db';

const SETTINGS_COLLECTION = 'adminSettings';
const GENERAL_DOC = 'general';

export const FALLBACK_DEFAULT_PROXY = '';

const DEFAULT_SETTINGS: AdminSettings = {
  appName: 'Aspreen TV',
  publicStreamBaseUrl: 'https://aspreen-tv-production.up.railway.app',
  defaultTranscodingPreset: 'COPY',
  defaultSegmentDuration: 4,
  defaultPlaylistWindow: 8, // 8 segments * 4s = 32-second rolling buffer
  maxConcurrentJobs: 2500,
  maxPlaylistChannels: 5000,
  sourceTimeoutSeconds: 15,
  defaultTokenLifetime: 0,
  outputRetentionHours: 24,
  defaultProxyUrl: '',
  updatedAt: new Date().toISOString(),
};

export class SettingsRepository {
  private db = getFirestore();

  async getSettings(): Promise<AdminSettings> {
    const pool = getPool();
    if (pool) {
      const res = await pool.query('SELECT data, updated_at FROM admin_settings WHERE key = $1', [GENERAL_DOC]);
      if (res.rows.length === 0) {
        await pool.query(
          'INSERT INTO admin_settings (key, data, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING',
          [GENERAL_DOC, JSON.stringify(DEFAULT_SETTINGS), DEFAULT_SETTINGS.updatedAt]
        );
        return DEFAULT_SETTINGS;
      }

      const row = res.rows[0];
      const parsedData = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      const current = { ...DEFAULT_SETTINGS, ...parsedData } as AdminSettings;
      if (current.publicStreamBaseUrl && current.publicStreamBaseUrl.includes('@')) {
        current.publicStreamBaseUrl = 'https://aspreen-tv-production.up.railway.app';
      }
      if (current.defaultProxyUrl && current.defaultProxyUrl.includes('31.59.20.176')) {
        current.defaultProxyUrl = '';
      }
      if (!current.defaultPlaylistWindow || current.defaultPlaylistWindow < 8) {
        current.defaultPlaylistWindow = 8;
      }
      if (!current.maxConcurrentJobs || current.maxConcurrentJobs < 1000) {
        current.maxConcurrentJobs = 2500;
      }
      return current;
    }

    const docRef = await this.db.collection(SETTINGS_COLLECTION).doc(GENERAL_DOC);
    const snap = await docRef.get();

    if (!snap.exists) {
      await docRef.set(cleanUndefined(DEFAULT_SETTINGS));
      return DEFAULT_SETTINGS;
    }

    const current = { ...DEFAULT_SETTINGS, ...snap.data() } as AdminSettings;
    if (current.publicStreamBaseUrl && current.publicStreamBaseUrl.includes('@')) {
      current.publicStreamBaseUrl = 'https://aspreen-tv-production.up.railway.app';
    }
    if (current.defaultProxyUrl && current.defaultProxyUrl.includes('31.59.20.176')) {
      current.defaultProxyUrl = '';
      docRef.set({ defaultProxyUrl: '' }, { merge: true }).catch(() => {});
    }
    if (!current.defaultPlaylistWindow || current.defaultPlaylistWindow < 8) {
      current.defaultPlaylistWindow = 8;
    }
    if (!current.maxConcurrentJobs || current.maxConcurrentJobs < 1000) {
      current.maxConcurrentJobs = 2500;
    }
    return current;
  }

  async updateSettings(data: Partial<AdminSettings>): Promise<AdminSettings> {
    const existing = await this.getSettings();
    const updated: AdminSettings = {
      ...existing,
      ...data,
      updatedAt: new Date().toISOString(),
    };

    const pool = getPool();
    if (pool) {
      await pool.query(
        `INSERT INTO admin_settings (key, data, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET data = $2, updated_at = $3`,
        [GENERAL_DOC, JSON.stringify(updated), updated.updatedAt]
      );
      return updated;
    }

    const docRef = await this.db.collection(SETTINGS_COLLECTION).doc(GENERAL_DOC);
    await docRef.set(cleanUndefined(updated), { merge: true });
    return updated;
  }
}

export const settingsRepository = new SettingsRepository();
