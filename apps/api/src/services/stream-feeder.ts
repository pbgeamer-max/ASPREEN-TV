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
 * Pumps live MPEG-TS data directly into FFmpeg's stdin without stuttering.
 * Buffers data in memory so that when upstream IPTV servers refresh/reset connection (every 30-45s),
 * FFmpeg continues receiving data uninterrupted while the new upstream connection connects in the background.
 */
export class StreamFeeder {
  private isDestroyed = false;
  private currentReq: http.ClientRequest | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private inactivityWatchdog: NodeJS.Timeout | null = null;
  private queue: Buffer[] = [];
  private queuedBytes = 0;
  private isPumping = false;
  private maxQueueBytes = 6 * 1024 * 1024; // 6 MB buffer (~15-20s of video)

  constructor(private options: StreamFeederOptions) {
    this.options.target.on('drain', () => {
      this.pump();
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
      this.scheduleReconnect('Stream inactivity watchdog (no data for 18s)', 500);
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

  private connect(targetUrl: string, redirectCount: number) {
    if (this.isDestroyed || this.options.target.destroyed) return;

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
          res.resume();
          return this.connect(redirectUrl, redirectCount + 1);
        }

        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume();
          this.scheduleReconnect(`Upstream returned HTTP ${res.statusCode}`, 2000);
          return;
        }

        res.on('data', (chunk: Buffer) => {
          this.resetWatchdog();
          this.pushData(chunk);
        });

        res.on('end', () => {
          // Upstream refreshed/finished session (typical 40s IPTV refresh).
          // Reconnect IMMEDIATELY (0ms delay) so new connection starts while jitter buffer drains!
          this.scheduleReconnect('Upstream session refresh', 0);
        });

        res.on('error', (err) => {
          this.scheduleReconnect(`Upstream response error: ${err.message}`, 500);
        });
      });

      this.currentReq = req;

      req.on('error', (err) => {
        this.scheduleReconnect(`Upstream request error: ${err.message}`, 1500);
      });

      req.end();
    } catch (err: any) {
      this.scheduleReconnect(`Failed to dispatch request: ${err.message}`, 2000);
    }
  }

  private scheduleReconnect(reason: string, delayMs = 0) {
    if (this.isDestroyed || this.options.target.destroyed) return;
    if (this.reconnectTimer) return;

    if (this.options.onLog) {
      this.options.onLog(`[StreamFeeder] ${reason}. Reconnecting in ${delayMs}ms... (buffered: ${(this.queuedBytes / 1024).toFixed(0)} KB)`);
    }

    if (this.currentReq) {
      try {
        this.currentReq.destroy();
      } catch {}
      this.currentReq = null;
    }

    if (delayMs <= 0) {
      setImmediate(() => {
        this.reconnectTimer = null;
        this.connect(this.options.url, 0);
      });
    } else {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect(this.options.url, 0);
      }, delayMs);
    }
  }

  destroy() {
    this.isDestroyed = true;
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
    if (this.currentReq) {
      try {
        this.currentReq.destroy();
      } catch {}
      this.currentReq = null;
    }
  }
}
