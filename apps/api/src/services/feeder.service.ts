import http from 'http';
import https from 'https';
import { channelRepository } from '../repositories/channel.repository';
import { decrypt, encrypt } from '../security/encryption';
import { telegramService } from './telegram.service';
import { snifferService } from './sniffer.service';

export class FeederService {
  private checkInterval?: NodeJS.Timeout;
  private isChecking = false;

  public start(intervalMinutes = 15) {
    console.log(`[Feeder Service] Auto Health Feeder started (runs every ${intervalMinutes}m).`);
    this.checkInterval = setInterval(() => {
      this.probeAndAutoHealChannels().catch(() => {});
    }, intervalMinutes * 60 * 1000);
    this.checkInterval.unref();
  }

  public stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }

  /**
   * Continuous Health & Auto-Healing Daemon:
   * Probes active channels, and if any channel fails, automatically searches
   * verified stream seeds to find an active fallback and updates the database!
   */
  public async probeAndAutoHealChannels(limit = 50): Promise<{ checked: number; active: number; healed: number; failed: number }> {
    if (this.isChecking) return { checked: 0, active: 0, healed: 0, failed: 0 };
    this.isChecking = true;

    let activeCount = 0;
    let healedCount = 0;
    let failedCount = 0;

    try {
      const channels = await channelRepository.listChannels();
      const enabled = channels.filter((c) => c.enabled !== false).slice(0, limit);

      for (const ch of enabled) {
        const inputUrl = decrypt(ch.encryptedInputUrl);
        if (!inputUrl || !/^https?:\/\//i.test(inputUrl)) continue;

        const isAlive = await this.testStreamUrl(inputUrl);
        if (isAlive) {
          activeCount++;
          if (ch.inputStatus !== 'ONLINE') {
            await channelRepository.updateChannel(ch.id, { inputStatus: 'ONLINE' });
          }
        } else {
          // Channel is down -> Attempt Auto-Healing from verified seeds!
          console.warn(`[Feeder Service] Channel "${ch.name}" (${ch.id}) is down. Searching for alternative live stream...`);

          const alternative = snifferService.DIRECT_SEEDS.find(
            (s) => s.name.trim().toLowerCase() === ch.name.trim().toLowerCase() && s.url !== inputUrl
          );

          let recovered = false;
          if (alternative) {
            const isAltAlive = await this.testStreamUrl(alternative.url);
            if (isAltAlive) {
              await channelRepository.updateChannel(ch.id, {
                encryptedInputUrl: encrypt(alternative.url),
                inputStatus: 'ONLINE',
              });
              healedCount++;
              recovered = true;
              console.log(`[Feeder Service] Channel "${ch.name}" AUTO-HEALED with fresh stream!`);
            }
          }

          if (!recovered) {
            failedCount++;
            await channelRepository.updateChannel(ch.id, { inputStatus: 'OFFLINE' });
          }
        }
      }

      if (healedCount > 0 || failedCount > 0) {
        let alertMsg =
          `📡 <b>تقرير فحص وتحديث القنوات الدوري:</b>\n\n` +
          `📊 تم فحص: ${enabled.length} قناة\n` +
          `🟢 قنوات شغالة ومستقرة: ${activeCount}\n`;

        if (healedCount > 0) {
          alertMsg += `🔄 <b>تم إصلاح وتحديث روابطها تلقائياً:</b> ${healedCount}\n`;
        }
        if (failedCount > 0) {
          alertMsg += `🔴 قنوات متوقفة من المصدر: ${failedCount}\n`;
        }

        telegramService.notifyAdmin(alertMsg).catch(() => {});
      }
    } finally {
      this.isChecking = false;
    }

    return { checked: activeCount + healedCount + failedCount, active: activeCount, healed: healedCount, failed: failedCount };
  }

  public testStreamUrl(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const parsed = new URL(url);
        const isHttps = parsed.protocol === 'https:';
        const lib = isHttps ? https : http;

        const req = lib.request(
          {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'GET',
            headers: {
              'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
              Connection: 'close',
            },
            timeout: 5000,
          },
          (res) => {
            const status = res.statusCode || 0;
            res.destroy();
            resolve(status >= 200 && status < 400);
          }
        );

        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });

        req.on('error', () => resolve(false));
        req.end();
      } catch {
        resolve(false);
      }
    });
  }
}

export const feederService = new FeederService();
