import { channelRepository } from '../repositories/channel.repository';
import { liveHunterService } from './live-hunter.service';
import { transcodingService } from './transcoding.service';
import { decrypt } from '../security/encryption';

export interface AutoPilotStatus {
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt?: string;
  isCycleRunning: boolean;
  activeRebroadcastsCount: number;
  activeChannels: Array<{ id: string; name: string; orderIndex: number; startedAt?: string }>;
  totalChannels: number;
}

export class AutoPilotService {
  private timer?: NodeJS.Timeout;
  private isCycleRunning = false;
  private intervalMinutes = 3;
  private lastRunAt?: string;
  private enabled = true;
  private maxConcurrentRebroadcasts = 25;

  /**
   * Starts the autonomous auto-pilot daemon
   */
  public start(intervalMinutes = 3) {
    this.intervalMinutes = intervalMinutes;
    this.enabled = true;
    console.log(`[AutoPilot] 🤖 تم تشغيل نظام الطيار الآلي المستمر (فحص وتحديث وإعادة بث تلقائي كل ${intervalMinutes} دقائق).`);

    // First cycle runs 8 seconds after boot to give server time to initialize DB and listen
    setTimeout(() => {
      this.runCycle().catch((err) => {
        console.error('[AutoPilot] Initial boot cycle error:', err.message);
      });
    }, 8000);

    this.timer = setInterval(() => {
      if (this.enabled) {
        this.runCycle().catch((err) => {
          console.error('[AutoPilot] Periodic cycle error:', err.message);
        });
      }
    }, this.intervalMinutes * 60 * 1000);

    this.timer.unref();
  }

  public stop() {
    this.enabled = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    console.log('[AutoPilot] ⏸️ تم إيقاف نظام الطيار الآلي مؤقتاً.');
  }

  /**
   * Main autonomous cycle:
   * 1. Auto-hunts & refreshes all channels and upstream CDN tokens from AFLAM4YOU from A to Z.
   * 2. Automatically launches server-side HLS rebroadcast for any channel with an active live stream.
   * 3. Gracefully stops rebroadcasting when a match concludes to conserve server resources.
   */
  public async runCycle(): Promise<{ updated: number; started: number; stopped: number }> {
    if (this.isCycleRunning) {
      console.log('[AutoPilot] ⏳ دورة الطيار الآلي جارية بالفعل — تخطي التكرار');
      return { updated: 0, started: 0, stopped: 0 };
    }

    this.isCycleRunning = true;
    this.lastRunAt = new Date().toISOString();
    let startedCount = 0;
    let stoppedCount = 0;

    console.log('[AutoPilot] 🔄 بدء دورة الطيار الآلي: فحص الروابط الأصلية وتحديث البثوث التلقائية...');

    try {
      // 1. Refresh & hunt channels from upstream (re-syncs tokens, names, rankings, and logos)
      const huntResult = await liveHunterService.huntKooraLive().catch((err) => {
        console.warn('[AutoPilot] Hunt sync warning:', err.message);
        return null;
      });

      // 2. Fetch all current channels from DB
      const channels = await channelRepository.listChannels();
      const enabledChannels = channels.filter((c) => c.enabled !== false);

      for (const ch of enabledChannels) {
        try {
          const rawUrl = decrypt(ch.encryptedInputUrl);
          if (!rawUrl) continue;

          const cleanUrl = rawUrl.split('|')[0].trim();
          const isLiveStream =
            cleanUrl.includes('.m3u8') &&
            !/playeraf\.php|embed\.php|\.html(?:\?|$)/i.test(cleanUrl);

          const isCurrentlyRunning = transcodingService.isChannelRunning(ch.id);

          // CASE A: Channel has an active live match broadcast
          if (isLiveStream) {
            if (!isCurrentlyRunning) {
              const currentActive = transcodingService.getActiveChannelsCount();
              if (currentActive < this.maxConcurrentRebroadcasts) {
                console.log(`[AutoPilot] ⚽ اكتشاف مباراة مباشرة! بدء إعادة البث التلقائي لقناة: "${ch.name}" (#${ch.orderIndex})...`);
                transcodingService.setContinuousChannel(ch.id, true);
                await transcodingService.startChannel(ch.id, { preset: 'COPY' }).catch((err) => {
                  console.warn(`[AutoPilot] Could not auto-start "${ch.name}":`, err.message);
                });
                startedCount++;
              }
            } else {
              // Keep continuous & touch access
              transcodingService.setContinuousChannel(ch.id, true);
              transcodingService.touchChannelAccess(ch.id);
            }
          }

          // CASE B: Channel was running, but match has concluded (fallback player or offline)
          if (!isLiveStream && isCurrentlyRunning) {
            console.log(`[AutoPilot] 🏁 انتهت المباراة لقناة: "${ch.name}" — إيقاف إعادة البث تلقائياً لتوفير موارد السيرفر.`);
            transcodingService.setContinuousChannel(ch.id, false);
            await transcodingService.stopChannel(ch.id).catch(() => {});
            stoppedCount++;
          }
        } catch (itemErr: any) {
          // ignore single item errors to let remaining channels process smoothly
        }
      }

      console.log(
        `[AutoPilot] ✅ اكتملت دورة الطيار الآلي: تم تحديث ${huntResult?.streams?.length || 0} قناة، بدء إعادة بث ${startedCount} قناة جديدة، إيقاف ${stoppedCount} قناة منتهية.`
      );

      return {
        updated: huntResult?.streams?.length || 0,
        started: startedCount,
        stopped: stoppedCount,
      };
    } finally {
      this.isCycleRunning = false;
    }
  }

  /**
   * Returns current real-time status of AutoPilot daemon
   */
  public async getStatus(): Promise<AutoPilotStatus> {
    const channels = await channelRepository.listChannels();
    const activeChannels: Array<{ id: string; name: string; orderIndex: number }> = [];

    for (const ch of channels) {
      if (transcodingService.isChannelRunning(ch.id)) {
        activeChannels.push({
          id: ch.id,
          name: ch.name,
          orderIndex: ch.orderIndex || 0,
        });
      }
    }

    activeChannels.sort((a, b) => a.orderIndex - b.orderIndex);

    return {
      enabled: this.enabled,
      intervalMinutes: this.intervalMinutes,
      lastRunAt: this.lastRunAt,
      isCycleRunning: this.isCycleRunning,
      activeRebroadcastsCount: activeChannels.length,
      activeChannels,
      totalChannels: channels.length,
    };
  }
}

export const autoPilotService = new AutoPilotService();
