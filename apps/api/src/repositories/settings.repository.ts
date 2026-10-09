import { AdminSettings } from '@aspreen/shared';
import { getFirestore } from '../firebase/admin';
import { cleanUndefined } from '../firebase/utils';

const SETTINGS_COLLECTION = 'adminSettings';
const GENERAL_DOC = 'general';

const DEFAULT_SETTINGS: AdminSettings = {
  appName: 'Aspreen TV',
  publicStreamBaseUrl: 'http://localhost:8080',
  defaultTranscodingPreset: 'COPY',
  defaultSegmentDuration: 4,
  defaultPlaylistWindow: 5,
  maxConcurrentJobs: 8,
  maxPlaylistChannels: 1000,
  sourceTimeoutSeconds: 15,
  defaultTokenLifetime: 0,
  outputRetentionHours: 24,
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

    return { ...DEFAULT_SETTINGS, ...snap.data() } as AdminSettings;
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
