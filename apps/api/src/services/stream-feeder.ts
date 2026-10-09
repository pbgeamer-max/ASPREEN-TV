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
 * Continuous Stream Feeder:
 * Pumps live MPEG-TS data directly into FFmpeg's stdin.
 * Transparently reconnects when upstream IPTV servers drop or refresh session (e.g. every 30-45 seconds),
 * preventing FFmpeg from reaching EOF and ensuring unbroken 24/7 live HLS output.
 */
export class StreamFeeder {
  private isDestroyed = false;
  private currentReq: http.ClientRequest | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private options: StreamFeederOptions) {}

  start() {
    this.connect(this.options.url, 0);
  }

  private connect(targetUrl: string, redirectCount: number) {
    if (this.isDestroyed || this.options.target.destroyed) return;

    if (redirectCount > 5) {
      this.scheduleReconnect('Too many redirects');
      return;
    }

    let parsedTarget: URL;
    try {
      parsedTarget = new URL(targetUrl);
    } catch (err: any) {
      this.scheduleReconnect(`Invalid URL: ${err.message}`);
      return;
    }

    const isTargetHttps = parsedTarget.protocol === 'https:';
    const proxyUrl = this.options.proxyUrl;

    let reqOptions: http.RequestOptions;
    let transport: typeof http | typeof https;

    const requestHeaders: Record<string, string> = {
      'User-Agent': this.options.userAgent || 'VLC/3.0.20 LibVLC/3.0.20',
      'Host': parsedTarget.host,
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
          timeout: 15000,
        };
      } catch (err: any) {
        this.scheduleReconnect(`Invalid proxy URL: ${err.message}`);
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
        timeout: 15000,
      };
    }

    try {
      const req = transport.request(reqOptions, (res) => {
        // Handle 301, 302, 303, 307, 308 redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, targetUrl).toString();
          res.resume();
          return this.connect(redirectUrl, redirectCount + 1);
        }

        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume();
          this.scheduleReconnect(`Upstream returned HTTP ${res.statusCode}`);
          return;
        }

        res.on('data', (chunk: Buffer) => {
          if (!this.isDestroyed && !this.options.target.destroyed) {
            try {
              this.options.target.write(chunk);
            } catch {
              // Pipe closed
            }
          }
        });

        res.on('end', () => {
          // Upstream refreshed/disconnected after session limit
          this.scheduleReconnect('Upstream closed connection (session refresh)', 300);
        });

        res.on('error', (err) => {
          this.scheduleReconnect(`Upstream response error: ${err.message}`, 1000);
        });
      });

      this.currentReq = req;

      req.on('timeout', () => {
        req.destroy(new Error('Connection timeout'));
      });

      req.on('error', (err) => {
        this.scheduleReconnect(`Upstream request error: ${err.message}`, 2000);
      });

      req.end();
    } catch (err: any) {
      this.scheduleReconnect(`Failed to dispatch request: ${err.message}`, 2000);
    }
  }

  private scheduleReconnect(reason: string, delayMs = 1500) {
    if (this.isDestroyed || this.options.target.destroyed) return;
    if (this.reconnectTimer) return;

    if (this.options.onLog) {
      this.options.onLog(`[StreamFeeder] ${reason}. Reconnecting in ${delayMs}ms...`);
    }

    if (this.currentReq) {
      try {
        this.currentReq.destroy();
      } catch {}
      this.currentReq = null;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(this.options.url, 0);
    }, delayMs);
  }

  destroy() {
    this.isDestroyed = true;
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
