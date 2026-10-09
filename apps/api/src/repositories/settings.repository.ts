import { AdminSettings } from '@aspreen/shared';
import { getFirestore } from '../firebase/admin';
import { cleanUndefined } from '../firebase/utils';

const SETTINGS_COLLECTION = 'adminSettings';
const GENERAL_DOC = 'general';

export const FALLBACK_DEFAULT_PROXY = 'http://avxkxvqi:kfq49mj05vbr@31.59.20.176:6754';

const DEFAULT_SETTINGS: AdminSettings = {
  appName: 'Aspreen TV',
  publicStreamBaseUrl: 'https://aspreen-tv-production.up.railway.app',
  defaultTranscodingPreset: 'COPY',
  defaultSegmentDuration: 4,
  defaultPlaylistWindow: 5,
  maxConcurrentJobs: 8,
  maxPlaylistChannels: 1000,
  sourceTimeoutSeconds: 15,
  defaultTokenLifetime: 0,
  outputRetentionHours: 24,
  defaultProxyUrl: FALLBACK_DEFAULT_PROXY,
  updatedAt: new Date().toISOString(),
};

export class SettingsRepository {
  private db = getFirestore();

  async getSettings(): Promise<AdminSettings> {
    const docRef = await this.db.collection(SETTINGS_COLLECTION).doc(GENERAL_DOC);
    const snap = await docRef.get();

    if (!snap.exists) {
      // Initialize with default settings
      await docRef.set(cleanUndefined(DEFAULT_SETTINGS));
      return DEFAULT_SETTINGS;
    }

    const current = { ...DEFAULT_SETTINGS, ...snap.data() } as AdminSettings;
    if (current.publicStreamBaseUrl && current.publicStreamBaseUrl.includes('@')) {
      if (!current.defaultProxyUrl) {
        current.defaultProxyUrl = current.publicStreamBaseUrl;
      }
      current.publicStreamBaseUrl = 'https://aspreen-tv-production.up.railway.app';
    }
    if (!current.defaultProxyUrl || current.defaultProxyUrl.trim() === '') {
      current.defaultProxyUrl = FALLBACK_DEFAULT_PROXY;
    }
    return current;
  }

  async updateSettings(data: Partial<AdminSettings>): Promise<AdminSettings> {
    const docRef = await this.db.collection(SETTINGS_COLLECTION).doc(GENERAL_DOC);
    const existing = await this.getSettings();

    const updated: AdminSettings = {
      ...existing,
      ...data,
      updatedAt: new Date().toISOString(),
    };

    await docRef.set(cleanUndefined(updated), { merge: true });
    return updated;
  }
}

export const settingsRepository = new SettingsRepository();
