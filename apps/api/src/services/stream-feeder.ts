import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { Writable } from 'stream';

export interface StreamFeederOptions {
  url: string;
  proxyUrl?: string;
  target: Writable;
  userAgent?: string;
  customHeaders?: Record<string, string>;
  onLog?: (msg: string) => void;
}

/**
 * Continuous Stream Feeder with In-Memory Jitter Buffer:
 * Pumps live MPEG-TS data directly into FFmpeg's stdin without stuttering or infinite reconnect loops.
 * Buffers data in memory so that when upstream IPTV servers refresh/reset connection (every 30-45s),
 * FFmpeg continues receiving data uninterrupted while the new upstream connection connects in the background.
 */
export class StreamFeeder {
  private isDestroyed = false;
  private currentReq: http.ClientRequest | null = null;
  private currentRes: http.IncomingMessage | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private inactivityWatchdog: NodeJS.Timeout | null = null;
  private queue: Buffer[] = [];
  private queuedBytes = 0;
  private isPumping = false;
  private maxQueueBytes = 8 * 1024 * 1024; // 8 MB buffer (~20-25s of video)
  private sessionBytesReceived = 0;
  private sessionStartTime = 0;
  private consecutiveFailures = 0;

  constructor(private options: StreamFeederOptions) {
    this.options.target.on('drain', () => {
      this.pump();
    });
    this.options.target.on('close', () => {
      this.destroy();
    });
    this.options.target.on('error', () => {
      this.destroy();
    });
  }

  start() {
    this.connect(this.options.url, 0);
  }

  private resetWatchdog() {
    if (this.inactivityWatchdog) {
      clearTimeout(this.inactivityWatchdog);
    }
    if (this.isDestroyed) return;

    // If no chunk is received for 18 seconds, assume stream frozen and reconnect
    this.inactivityWatchdog = setTimeout(() => {
      this.scheduleReconnect('Stream inactivity watchdog (no data for 18s)', 1000);
    }, 18000);
  }

  private pushData(chunk: Buffer) {
    if (this.isDestroyed || this.options.target.destroyed) return;
    this.queue.push(chunk);
    this.queuedBytes += chunk.length;

    // Cap maximum queue to prevent runaway memory usage
    while (this.queuedBytes > this.maxQueueBytes && this.queue.length > 1) {
      const dropped = this.queue.shift();
      if (dropped) this.queuedBytes -= dropped.length;
    }

    this.pump();
  }

  private pump() {
    if (this.isPumping || this.isDestroyed || this.options.target.destroyed) return;
    this.isPumping = true;

    try {
      while (this.queue.length > 0) {
        const chunk = this.queue[0];
        const canWrite = this.options.target.write(chunk);
        this.queue.shift();
        this.queuedBytes -= chunk.length;

        if (!canWrite) {
          // Target buffer full, wait for 'drain' event
          break;
        }
      }
    } catch {
      // Pipe closed
    } finally {
      this.isPumping = false;
    }
  }

  private cleanupCurrentConnection() {
    if (this.currentReq) {
      this.currentReq.removeAllListeners();
      try {
        this.currentReq.destroy();
      } catch {}
      this.currentReq = null;
    }
    if (this.currentRes) {
      this.currentRes.removeAllListeners();
      try {
        this.currentRes.destroy();
      } catch {}
      this.currentRes = null;
    }
  }

  private connect(targetUrl: string, redirectCount: number) {
    if (this.isDestroyed || this.options.target.destroyed) return;

    if (redirectCount === 0) {
      this.cleanupCurrentConnection();
      this.sessionBytesReceived = 0;
      this.sessionStartTime = Date.now();
    }

    if (redirectCount > 5) {
      this.scheduleReconnect('Too many redirects', 2000);
      return;
    }

    let parsedTarget: URL;
    try {
      parsedTarget = new URL(targetUrl);
    } catch (err: any) {
      this.scheduleReconnect(`Invalid URL: ${err.message}`, 3000);
      return;
    }

    const isTargetHttps = parsedTarget.protocol === 'https:';
    const proxyUrl = this.options.proxyUrl;

    let reqOptions: http.RequestOptions;
    let transport: typeof http | typeof https;

    const requestHeaders: Record<string, string> = {
      'User-Agent': this.options.userAgent || 'VLC/3.0.20 LibVLC/3.0.20',
      'Host': parsedTarget.host,
      'Connection': 'keep-alive',
      ...(this.options.customHeaders || {}),
    };

    if (proxyUrl) {
      try {
        const parsedProxy = new URL(proxyUrl);
        transport = parsedProxy.protocol === 'https:' ? https : http;
        if (parsedProxy.username || parsedProxy.password) {
          requestHeaders['Proxy-Authorization'] =
            'Basic ' + Buffer.from(`${parsedProxy.username}:${parsedProxy.password}`).toString('base64');
        }
        reqOptions = {
          host: parsedProxy.hostname,
          port: parsedProxy.port || 80,
          path: targetUrl,
          headers: requestHeaders,
        };
      } catch (err: any) {
        this.scheduleReconnect(`Invalid proxy URL: ${err.message}`, 3000);
        return;
      }
    } else {
      transport = isTargetHttps ? https : http;
      reqOptions = {
        protocol: parsedTarget.protocol,
        host: parsedTarget.hostname,
        port: parsedTarget.port || (isTargetHttps ? 443 : 80),
        path: parsedTarget.pathname + parsedTarget.search,
        headers: requestHeaders,
      };
    }

    try {
      this.resetWatchdog();

      const req = transport.request(reqOptions, (res) => {
        // Handle 301, 302, 303, 307, 308 redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, targetUrl).toString();
          res.removeAllListeners();
          res.resume();
          return this.connect(redirectUrl, redirectCount + 1);
        }

        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.removeAllListeners();
          res.resume();
          this.consecutiveFailures++;
          const backoff = Math.min(1000 * Math.pow(1.5, this.consecutiveFailures), 5000);
          this.scheduleReconnect(`Upstream returned HTTP ${res.statusCode}`, Math.round(backoff));
          return;
        }

        this.currentRes = res;
        this.consecutiveFailures = 0;

        res.on('data', (chunk: Buffer) => {
          this.sessionBytesReceived += chunk.length;
          this.resetWatchdog();
          this.pushData(chunk);
        });

        res.on('end', () => {
          const sessionDuration = (Date.now() - this.sessionStartTime) / 1000;
          if (this.sessionBytesReceived > 64 * 1024 || sessionDuration > 3) {
            // Normal healthy upstream session refresh (common IPTV behavior)
            this.consecutiveFailures = 0;
            this.scheduleReconnect('Upstream session refresh', 50);
          } else {
            // Premature disconnect or 0 bytes: prevent tight infinite loop with backoff
            this.consecutiveFailures++;
            const backoff = Math.min(1000 * Math.pow(1.5, this.consecutiveFailures), 5000);
            this.scheduleReconnect(
              `Upstream ended prematurely (${(this.sessionBytesReceived / 1024).toFixed(0)} KB received)`,
              Math.round(backoff)
            );
          }
        });

        res.on('error', (err) => {
          this.consecutiveFailures++;
          const backoff = Math.min(1000 * Math.pow(1.5, this.consecutiveFailures), 5000);
          this.scheduleReconnect(`Upstream response error: ${err.message}`, Math.round(backoff));
        });
      });

      this.currentReq = req;

      req.on('error', (err) => {
        this.consecutiveFailures++;
        const backoff = Math.min(1000 * Math.pow(1.5, this.consecutiveFailures), 5000);
        this.scheduleReconnect(`Upstream request error: ${err.message}`, Math.round(backoff));
      });

      req.end();
    } catch (err: any) {
      this.consecutiveFailures++;
      const backoff = Math.min(1000 * Math.pow(1.5, this.consecutiveFailures), 5000);
      this.scheduleReconnect(`Failed to dispatch request: ${err.message}`, Math.round(backoff));
    }
  }

  private scheduleReconnect(reason: string, delayMs = 1000) {
    if (this.isDestroyed || this.options.target.destroyed) return;
    if (this.reconnectTimer) return; // Reconnect is already pending

    const effectiveDelay = Math.max(50, delayMs);

    if (this.options.onLog) {
      this.options.onLog(
        `[StreamFeeder] ${reason}. Reconnecting in ${effectiveDelay}ms... (buffered: ${(this.queuedBytes / 1024).toFixed(0)} KB)`
      );
    }

    this.cleanupCurrentConnection();

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(this.options.url, 0);
    }, effectiveDelay);
  }

  destroy() {
    this.isDestroyed = true;
    this.cleanupCurrentConnection();
    this.queue = [];
    this.queuedBytes = 0;
    if (this.inactivityWatchdog) {
      clearTimeout(this.inactivityWatchdog);
      this.inactivityWatchdog = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
