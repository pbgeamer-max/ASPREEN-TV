import fs from 'fs';
import path from 'path';
import { channelRepository } from '../repositories/channel.repository';
import { liveHunterService } from './live-hunter.service';
import { encrypt } from '../security/encryption';

export interface OscarChannelEntry {
  name: string;
  category?: string;
  streamUrl: string;
  cookie?: string;
  ua?: string;
}

const FALLBACK_OSCAR_CHANNELS: Record<string, OscarChannelEntry> = {
  "beIN Sports 1": {
    name: "beIN Sports 1",
    category: "قنوات beIN Sports",
    streamUrl: "https://still-dust-c9ae.manon-lol2000.workers.dev/t/tna55e/UN4da6RAgwsabfB9jMOfKp1xeBE/xui/assets/79768337/22315546/1319.css",
    cookie: "ot=tmz15e.aGEEY4_2V8np7ZGPFkTOHvhlkxx",
    ua: "OSCARTV2021"
  },
  "beIN Sports 2": {
    name: "beIN Sports 2",
    category: "قنوات beIN Sports",
    streamUrl: "https://still-dust-c9ae.manon-lol2000.workers.dev/t/tna5ms/ZpgoZuPWqIO5dVzFNRPU2wQrdRq/xui/assets/79768337/22315546/1328.css",
    cookie: "ot=tmz1ms.uvHSXYvEehiChnTSDqBkQUJXciM",
    ua: "OSCARTV2021"
  },
  "beIN Sports 3": {
    name: "beIN Sports 3",
    category: "قنوات beIN Sports",
    streamUrl: "https://still-dust-c9ae.manon-lol2000.workers.dev/t/tna5na/agnTX0axT_Urg_6cJdWUZVrVDhC/xui/assets/79768337/22315546/1337.css",
    cookie: "ot=tmz1na.uhMLBJMDL7_L5qEfj3QlsLPbd7g",
    ua: "OSCARTV2021"
  },
  "beIN Sports 4": {
    name: "beIN Sports 4",
    category: "قنوات beIN Sports",
    streamUrl: "https://still-dust-c9ae.manon-lol2000.workers.dev/t/tna5nn/PstEz-cqUYPVCy_gyH471jLdv9V/xui/assets/79768337/22315546/1346.css",
    cookie: "ot=tmz1nn.fDoPC0B81a_K8fxiE74JpoZpdnI",
    ua: "OSCARTV2021"
  },
  "beIN Sports 5": {
    name: "beIN Sports 5",
    category: "قنوات beIN Sports",
    streamUrl: "https://still-dust-c9ae.manon-lol2000.workers.dev/t/tna5oh/OZxmBXNEOuBiQIy2MhTddY4SXqu/xui/assets/79768337/22315546/1355.css",
    cookie: "ot=tmz1oh.upwEBWKp5DOQJ91mN-7Uq_AvnuX",
    ua: "OSCARTV2021"
  },
  "beIN Sports 6": {
    name: "beIN Sports 6",
    category: "قنوات beIN Sports",
    streamUrl: "https://still-dust-c9ae.manon-lol2000.workers.dev/t/tna5pg/8WjJ09H0qJhAl0_g4BECMYePZFa/xui/assets/79768337/22315546/1364.css",
    cookie: "ot=tmz1pg.tDLWaKooeTNWMx_zcSHRBSVbLxs",
    ua: "OSCARTV2021"
  },
  "beIN Sports 7": {
    name: "beIN Sports 7",
    category: "قنوات beIN Sports",
    streamUrl: "https://still-dust-c9ae.manon-lol2000.workers.dev/t/tna5q2/NtWxwetWIGGNA220ofPRyuDEVJu/xui/assets/79768337/22315546/1373.css",
    cookie: "ot=tmz1q2.z9kJiQGwArEvDBOZqd7HmhruSE5",
    ua: "OSCARTV2021"
  },
  "beIN Sports 8": {
    name: "beIN Sports 8",
    category: "قنوات beIN Sports",
    streamUrl: "https://still-dust-c9ae.manon-lol2000.workers.dev/t/tna5r6/Yuqe8Lhd6wbKreQBWR_F9HF92S4/xui/assets/79768337/22315546/1382.css",
    cookie: "ot=tmz1r6.T2IKnbl-eLsNdnU5FkV9ldzP91i",
    ua: "OSCARTV2021"
  },
  "beIN Sports 9": {
    name: "beIN Sports 9",
    category: "قنوات beIN Sports",
    streamUrl: "https://still-dust-c9ae.manon-lol2000.workers.dev/t/tna5rk/UsFf3lq17ePJElgMMOAur58NPIC/xui/assets/79768337/22315546/1391.css",
    cookie: "ot=tmz1rk.rgPwM0zBYyL9kjYm3rXE2eENRch",
    ua: "OSCARTV2021"
  },
  "ألوان الرياضية 1": {
    name: "ألوان الرياضية 1",
    category: "Sports",
    streamUrl: "https://still-dust-c9ae.manon-lol2000.workers.dev/t/tna5st/tn9pVnHBpYOkhuqijDZWDZScPrO/xui/assets/79768337/22315546/1643.css",
    cookie: "ot=tmz1st.X_zU4mLWmUSWMDfxu4u2XfpWku1",
    ua: "OSCARTV2021"
  }
};

export class OscarSyncService {
  /**
   * Syncs extracted Oscar TV channels from data/oscar_channels_live.json (or fallback) into the DB
   */
  public async syncChannelsToDb(): Promise<{ total: number; added: number; updated: number }> {
    let data: Record<string, OscarChannelEntry> = FALLBACK_OSCAR_CHANNELS;

    const candidates = [
      path.resolve(process.cwd(), 'data/oscar_channels_live.json'),
      path.resolve(__dirname, '../../../data/oscar_channels_live.json'),
      path.resolve(__dirname, '../../data/oscar_channels_live.json'),
      path.resolve(__dirname, '../data/oscar_channels_live.json'),
    ];
    const jsonPath = candidates.find((p) => fs.existsSync(p));

    if (jsonPath) {
      try {
        const raw = fs.readFileSync(jsonPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && Object.keys(parsed).length > 0) {
          data = parsed;
          console.log(`[OscarSync] 📂 Loaded live channels file from: ${jsonPath}`);
        }
      } catch (err: any) {
        console.warn('[OscarSync] Failed reading live file, using embedded fallback:', err.message);
      }
    } else {
      console.log('[OscarSync] ⚡ Live file not found on disk, using embedded verified Oscar channels fallback');
    }

    try {
      const entries = Object.values(data);
      console.log(`[OscarSync] 📡 Starting sync for ${entries.length} genuine Oscar TV channels...`);

      const existingChannels = await channelRepository.listChannels();

      // Clean up any channels that were previously misattributed to oscar-tv-live (e.g. from live hunter)
      const validOscarNames = new Set(entries.map((e) => e.name.toLowerCase().trim()));
      for (const ch of existingChannels) {
        if (ch.sourceId === 'oscar-tv-live') {
          const isRealOscar = validOscarNames.has(ch.name.toLowerCase().trim()) || ch.externalIdentifier?.startsWith('oscar-');
          if (!isRealOscar) {
            console.log(`[OscarSync] 🧹 Reverting misattributed channel "${ch.name}" from oscar-tv-live`);
            await channelRepository.updateChannel(ch.id, { sourceId: 'aflam4you/koora' }).catch(() => {});
          }
        }
      }

      let added = 0;
      let updated = 0;

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!entry.name || !entry.streamUrl) continue;

        const normalized = entry.name.toLowerCase().trim();
        const slug = normalized.replace(/[^a-z0-9\u0600-\u06FF]/gi, '-').replace(/-+/g, '-').trim();
        const extId = `oscar-${slug}`;
        const oscarNormalizedName = `oscar-${normalized}`;

        // Strictly locate existing Oscar TV channel
        const existing = existingChannels.find(
          (c) =>
            (c.sourceId === 'oscar-tv-live' || c.externalIdentifier?.startsWith('oscar-')) &&
            (c.externalIdentifier === extId || c.normalizedName === oscarNormalizedName || c.name.toLowerCase().trim() === normalized)
        );

        const logo = liveHunterService.getKnownLogo(entry.name);

        // Format stream URL with pipe headers if user agent is required
        let finalStreamUrl = entry.streamUrl;
        const ua = entry.ua || 'OSCARTV2021';
        if (!finalStreamUrl.includes('|')) {
          finalStreamUrl = `${finalStreamUrl}|User-Agent=${ua}&Referer=http://speedcdn.me:8080/`;
          if (entry.cookie) {
            finalStreamUrl += `&Cookie=${entry.cookie}`;
          }
        }
        const encrypted = encrypt(finalStreamUrl);

        if (existing) {
          await channelRepository.updateChannel(existing.id, {
            sourceId: 'oscar-tv-live',
            externalIdentifier: extId,
            name: entry.name,
            normalizedName: oscarNormalizedName,
            encryptedInputUrl: encrypted,
            enabled: true,
            inputStatus: 'ONLINE',
            logoUrl: logo || existing.logoUrl,
            groupTitle: entry.category || 'قنوات أوسكار',
            orderIndex: 1 + i,
          }).catch((err) => {
            console.error(`[OscarSync] Error updating ${entry.name}:`, err.message);
          });
          updated++;
        } else {
          await channelRepository.createChannel({
            sourceId: 'oscar-tv-live',
            externalIdentifier: extId,
            name: entry.name,
            normalizedName: oscarNormalizedName,
            groupTitle: entry.category || 'قنوات أوسكار',
            logoUrl: logo,
            inputType: 'HLS',
            encryptedInputUrl: encrypted,
            enabled: true,
            inputStatus: 'ONLINE',
            transcodingStatus: 'STOPPED',
            preset: 'COPY',
            orderIndex: 1 + i,
          }).catch((err) => {
            console.error(`[OscarSync] Error creating ${entry.name}:`, err.message);
          });
          added++;
        }
      }

      console.log(`[OscarSync] ✅ Finished Oscar sync: ${added} added, ${updated} updated (Total genuine: ${entries.length})`);
      return { total: entries.length, added, updated };
    } catch (err: any) {
      console.error('[OscarSync] Sync error:', err.message);
      return { total: 0, added: 0, updated: 0 };
    }
  }
}

export const oscarSyncService = new OscarSyncService();
