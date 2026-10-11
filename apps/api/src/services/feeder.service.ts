import http from 'http';
import https from 'https';
import { channelRepository } from '../repositories/channel.repository';
import { decrypt } from '../security/encryption';
import { telegramService } from './telegram.service';

export class FeederService {
  private checkInterval?: NodeJS.Timeout;
  private isChecking = false;

  public start(intervalMinutes = 30) {
    console.log(`[Feeder Service] Auto Health Feeder started (runs every ${intervalMinutes}m).`);
    this.checkInterval = setInterval(() => {
      this.probeChannels().catch(() => {});
    }, intervalMinutes * 60 * 1000);
    this.checkInterval.unref();
  }

  public stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }

  /**
   * Probes active channels to ensure upstream links are responsive
   */
  public async probeChannels(limit = 10): Promise<{ checked: number; active: number; failed: number }> {
    if (this.isChecking) return { checked: 0, active: 0, failed: 0 };
    this.isChecking = true;

    let activeCount = 0;
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
        } else {
          failedCount++;
          console.warn(`[Feeder Service] Channel "${ch.name}" (${ch.id}) is unreachable upstream.`);
        }
      }

      if (failedCount > 0) {
        telegramService
          .notifyAdmin(
            `⚠️ <b>فحص القنوات الدوري:</b>\n` +
            `تم فحص: ${enabled.length} قناة\n` +
            `🟢 شغالة: ${activeCount}\n` +
            `🔴 تواجه مشاكل: ${failedCount}`
          )
          .catch(() => {});
      }
    } finally {
      this.isChecking = false;
    }

    return { checked: activeCount + failedCount, active: activeCount, failed: failedCount };
  }

  private testStreamUrl(url: string): Promise<boolean> {
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
            timeout: 8000,
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
