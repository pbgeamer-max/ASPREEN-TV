import fs from 'fs';
import path from 'path';
import { channelRepository } from '../repositories/channel.repository';
import { liveHunterService } from './live-hunter.service';
import { encrypt } from '../security/encryption';

export interface OscarChannelEntry {
  name: string;
  category?: string;
  streamUrl: string;
  ua?: string;
}

export class OscarSyncService {
  /**
   * Syncs extracted Oscar TV channels from data/oscar_channels_live.json into the DB
   */
  public async syncChannelsToDb(): Promise<{ total: number; added: number; updated: number }> {
    const candidates = [
      path.resolve(process.cwd(), 'data/oscar_channels_live.json'),
      path.resolve(__dirname, '../../../data/oscar_channels_live.json'),
      path.resolve(__dirname, '../../data/oscar_channels_live.json'),
      path.resolve(__dirname, '../data/oscar_channels_live.json'),
    ];
    const jsonPath = candidates.find((p) => fs.existsSync(p));
    if (!jsonPath) {
      console.log('[OscarSync] No oscar_channels_live.json file found');
      return { total: 0, added: 0, updated: 0 };
    }

    try {
      const raw = fs.readFileSync(jsonPath, 'utf-8');
      const data: Record<string, OscarChannelEntry> = JSON.parse(raw);
      const entries = Object.values(data);

      console.log(`[OscarSync] 📡 Starting sync for ${entries.length} channels from Oscar TV...`);

      const existingChannels = await channelRepository.listChannels();
      const existingMap = new Map(existingChannels.map((c) => [c.normalizedName, c]));

      let added = 0;
      let updated = 0;

      for (const entry of entries) {
        if (!entry.name || !entry.streamUrl) continue;

        const normalized = entry.name.toLowerCase().trim();
        const baseName = normalized.replace(/\s*hd\s*$/i, '').trim();
        const existing =
          existingMap.get(normalized) ||
          existingMap.get(baseName) ||
          existingMap.get(`${baseName} hd`) ||
          existingMap.get(`${baseName} 1080p`);

        const logo = liveHunterService.getKnownLogo(entry.name);

        // Format stream URL with pipe headers if user agent is required
        let finalStreamUrl = entry.streamUrl;
        const ua = entry.ua || 'OSCARTV2021';
        if (!finalStreamUrl.includes('|')) {
          finalStreamUrl = `${finalStreamUrl}|User-Agent=${ua}&Referer=http://speedcdn.me:8080/`;
        }
        const encrypted = encrypt(finalStreamUrl);

        if (existing) {
          await channelRepository.updateChannel(existing.id, {
            encryptedInputUrl: encrypted,
            enabled: true,
            inputStatus: 'ONLINE',
            logoUrl: logo || existing.logoUrl,
            groupTitle: entry.category || existing.groupTitle || 'Live TV',
          }).catch((err) => {
            console.error(`[OscarSync] Error updating ${entry.name}:`, err.message);
          });
          updated++;
        } else {
          await channelRepository.createChannel({
            sourceId: 'oscar-tv-live',
            externalIdentifier: `oscar-${normalized.replace(/\s+/g, '-')}`,
            name: entry.name,
            normalizedName: normalized,
            groupTitle: entry.category || 'Live TV',
            logoUrl: logo,
            inputType: 'HLS',
            encryptedInputUrl: encrypted,
            enabled: true,
            inputStatus: 'ONLINE',
            transcodingStatus: 'STOPPED',
            preset: 'COPY',
            orderIndex: 100 + added,
          }).catch((err) => {
            console.error(`[OscarSync] Error creating ${entry.name}:`, err.message);
          });
          added++;
        }
      }

      console.log(`[OscarSync] ✅ Finished sync: ${added} added, ${updated} updated (Total: ${entries.length})`);
      return { total: entries.length, added, updated };
    } catch (err: any) {
      console.error('[OscarSync] Sync error:', err.message);
      return { total: 0, added: 0, updated: 0 };
    }
  }
}

export const oscarSyncService = new OscarSyncService();
