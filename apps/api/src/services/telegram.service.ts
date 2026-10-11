import https from 'https';
import http from 'http';
import { config } from '../config';
import { channelRepository } from '../repositories/channel.repository';
import { tokenRepository } from '../repositories/token.repository';
import { settingsRepository } from '../repositories/settings.repository';
import { generateStreamToken, hashStreamToken, buildPlaybackUrl, buildTsPlaybackUrl } from '../security/token';
import { encrypt } from '../security/encryption';

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
    date: number;
  };
}

class TelegramService {
  private botToken?: string;
  private adminChatId?: string;
  private isRunning = false;
  private offset = 0;
  private pollingTimer?: NodeJS.Timeout;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN;
    this.adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  }

  public init() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN;
    this.adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

    if (!this.botToken) {
      console.log('[Telegram Bot] TELEGRAM_BOT_TOKEN not configured. Bot standby.');
      return;
    }

    console.log('[Telegram Bot] Initializing Telegram Bot Service...');
    this.isRunning = true;
    this.startPolling();
  }

  public stop() {
    this.isRunning = false;
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
    }
  }

  /**
   * Sends a message to a specific chat or admin chat
   */
  public async sendMessage(chatId: string | number, text: string, options: { parseMode?: string } = {}) {
    if (!this.botToken) return;

    const payload = JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: options.parseMode || 'HTML',
      disable_web_page_preview: true,
    });

    return this.telegramRequest('sendMessage', payload);
  }

  /**
   * Broadcasts an administrative alert
   */
  public async notifyAdmin(text: string) {
    if (!this.adminChatId) return;
    return this.sendMessage(this.adminChatId, text);
  }

  /**
   * Sends a document (e.g. M3U playlist file)
   */
  public async sendDocument(chatId: string | number, filename: string, content: string, caption?: string) {
    if (!this.botToken) return;

    const boundary = '----WebKitFormBoundary' + Math.random().toString(16).slice(2);
    let body = '';

    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`;

    if (caption) {
      body += `--${boundary}\r\n`;
      body += `Content-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`;
    }

    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="document"; filename="${filename}"\r\n`;
    body += `Content-Type: audio/x-mpegurl\r\n\r\n`;
    body += content + '\r\n';
    body += `--${boundary}--\r\n`;

    return new Promise((resolve) => {
      const req = https.request(
        {
          hostname: 'api.telegram.org',
          path: `/bot${this.botToken}/sendDocument`,
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 20000,
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve(data));
        }
      );
      req.on('error', () => resolve(null));
      req.write(body);
      req.end();
    });
  }

  private startPolling() {
    if (!this.isRunning || !this.botToken) return;

    this.getUpdates()
      .catch((err) => {
        console.error('[Telegram Bot] Polling error:', err.message);
      })
      .finally(() => {
        if (this.isRunning) {
          this.pollingTimer = setTimeout(() => this.startPolling(), 1500);
        }
      });
  }

  private async getUpdates(): Promise<void> {
    if (!this.botToken) return;

    const path = `/bot${this.botToken}/getUpdates?offset=${this.offset}&timeout=15`;
    const data = await this.telegramGet(path);
    if (!data || !data.ok || !Array.isArray(data.result)) return;

    for (const update of data.result as TelegramUpdate[]) {
      this.offset = update.update_id + 1;
      if (update.message && update.message.text) {
        await this.handleMessage(update.message);
      }
    }
  }

  private async handleMessage(message: NonNullable<TelegramUpdate['message']>) {
    const text = message.text?.trim() || '';
    const chatId = message.chat.id;
    const command = text.split(/\s+/)[0].toLowerCase();
    const args = text.slice(command.length).trim();

    try {
      if (command === '/start' || command === '/help') {
        const welcome =
          `📺 <b>أهلاً بك في بوت إدارة وبث Aspreen TV!</b>\n\n` +
          `هذا البوت مربوط بسيرفرك لتزويدك بالروابط وفحص القنوات وإرسال التنبيهات.\n\n` +
          `🔹 <code>/scan_all</code> - الفحص الشامل والسريع (عراقية + beIN + عربية + أخبار)\n` +
          `🔹 <code>/scan_iraq</code> - فحص وجلب جميع القنوات العراقية النشطة\n` +
          `🔹 <code>/scan_sports</code> - فحص ومزامنة قنوات beIN Sports والرياضة\n` +
          `🔹 <code>/scan_arabic</code> - فحص وجلب القنوات العربية والمنوعة\n` +
          `🔹 <code>/clean</code> - تنظيف القنوات وترتيب الباقات (1, 2, 3) وحذف القنوات الأجنبية\n` +
          `🔹 <code>/sniff &lt;رابط_صفحة&gt; [الاسم]</code> - قنص واستخراج رابط البث المخفي من أي موقع\n` +
          `🔹 <code>/playlist</code> - تحميل ملف الـ M3U المحدث لتطبيقك\n` +
          `🔹 <code>/channels</code> - عرض قائمة بأهم القنوات الشغالة\n` +
          `🔹 <code>/add &lt;الاسم&gt; &lt;الرابط&gt;</code> - إضافة قناة برابط مباشر\n` +
          `🔹 <code>/status</code> - فحص حالة السيرفر والذاكرة\n` +
          `🔹 <code>/repair_db</code> - إعادة تهيئة جداول قاعدة البيانات\n` +
          `🔹 <code>/app</code> - رابط الـ API لتطبيق الأندرويد`;

        await this.sendMessage(chatId, welcome);
      } else if (command === '/status') {
        const channels = await channelRepository.listChannels();
        const enabled = channels.filter((c) => c.enabled !== false).length;
        const memoryMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        const uptimeH = Math.round(process.uptime() / 3600);

        const statusMsg =
          `📊 <b>تقرير حالة السيرفر:</b>\n\n` +
          `✅ <b>حالة النظام:</b> متصل وشغال (Online)\n` +
          `📺 <b>إجمالي القنوات:</b> ${channels.length.toLocaleString()}\n` +
          `🟢 <b>القنوات المفعلة:</b> ${enabled.toLocaleString()}\n` +
          `⚡ <b>استهلاك الذاكرة:</b> ${memoryMB} MB\n` +
          `⏱️ <b>مدة التشغيل:</b> ${uptimeH} ساعة\n` +
          `🌐 <b>رابط السيرفر:</b> <code>${process.env.PUBLIC_STREAM_BASE_URL || 'https://aspreen-tv-production.up.railway.app'}</code>`;

        await this.sendMessage(chatId, statusMsg);
      } else if (command === '/playlist') {
        await this.sendMessage(chatId, '⏳ جاري تجهيز ملف قائمة القنوات المحدثة لتطبيقك...');

        const channels = await channelRepository.listChannels();
        const enabled = channels.filter((c) => c.enabled !== false);
        const settings = await settingsRepository.getSettings();
        const baseUrl = process.env.PUBLIC_STREAM_BASE_URL || settings.publicStreamBaseUrl || 'https://aspreen-tv-production.up.railway.app';

        const lines: string[] = ['#EXTM3U'];
        for (const ch of enabled.slice(0, 5000)) {
          const publicOutputId = ch.activeOutputId || ch.id;
          const rawToken = generateStreamToken();
          const tokenHash = hashStreamToken(rawToken);

          await tokenRepository.createToken({
            channelId: ch.id,
            name: `Telegram Export - ${ch.name}`,
            tokenHash,
            publicOutputId,
          });

          const streamUrl = buildTsPlaybackUrl(baseUrl, publicOutputId, rawToken);
          const tvgLogo = ch.logoUrl ? ` tvg-logo="${ch.logoUrl}"` : '';
          const groupTitle = ch.groupTitle ? ` group-title="${ch.groupTitle.replace(/"/g, "'")}"` : '';
          lines.push(`#EXTINF:-1 tvg-id="" tvg-name="${ch.name.replace(/"/g, "'")}"${tvgLogo}${groupTitle},${ch.name}`);
          lines.push(streamUrl);
        }

        const m3uContent = lines.join('\n');
        const filename = `aspreen_playlist_${new Date().toISOString().slice(0, 10)}.m3u`;

        await this.sendDocument(chatId, filename, m3uContent, `✅ ملف القنوات جاهز (${enabled.length} قناة) لتشغيله في أي تطبيق.`);
      } else if (command === '/channels') {
        const channels = await channelRepository.listChannels();
        const topChannels = channels.slice(0, 15);

        if (topChannels.length === 0) {
          await this.sendMessage(chatId, '⚠️ لا توجد قنوات مسجلة حالياً في السيرفر.');
          return;
        }

        let msg = `📺 <b>أحدث القنوات المتاحة (${channels.length.toLocaleString()} قناة):</b>\n\n`;
        topChannels.forEach((ch, idx) => {
          msg += `<b>${idx + 1}.</b> ${ch.name} <i>(${ch.groupTitle || 'عام'})</i>\n`;
        });
        msg += `\nلتحميل كل القنوات أرسل: <code>/playlist</code>`;

        await this.sendMessage(chatId, msg);
      } else if (command === '/add') {
        const parts = args.split(' ');
        if (parts.length < 2) {
          await this.sendMessage(
            chatId,
            `⚠️ <b>طريقة الإضافة غير صحيحة:</b>\n` +
            `أرسل الأمر هكذا:\n` +
            `<code>/add &lt;اسم_القناة&gt; &lt;رابط_البث&gt;</code>\n\n` +
            `مثال:\n` +
            `<code>/add BeIN_Sports_1 http://example.com/stream.m3u8</code>`
          );
          return;
        }

        const channelName = parts[0].replace(/_/g, ' ');
        const streamUrl = parts[1];

        if (!/^https?:\/\//i.test(streamUrl)) {
          await this.sendMessage(chatId, '❌ الرابط يجب أن يبدأ بـ http:// أو https://');
          return;
        }

        const newChannel = await channelRepository.createChannel({
          sourceId: 'telegram-source',
          name: channelName,
          normalizedName: channelName.toLowerCase(),
          inputType: streamUrl.includes('.m3u8') ? 'HLS' : 'TS_STREAM',
          inputStatus: 'ONLINE',
          transcodingStatus: 'STOPPED',
          encryptedInputUrl: encrypt(streamUrl),
          groupTitle: 'Telegram Added',
          enabled: true,
          preset: 'COPY',
        });

        await this.sendMessage(
          chatId,
          `✅ <b>تمت إضافة القناة بنجاح!</b>\n\n` +
          `📺 الاسم: <b>${newChannel.name}</b>\n` +
          `🆔 المعرف: <code>${newChannel.id}</code>\n\n` +
          `ستظهر القناة الآن فوراً في موقعك وتطبيق الأندرويد!`
        );
      } else if (command === '/app') {
        const baseUrl = process.env.PUBLIC_STREAM_BASE_URL || 'https://aspreen-tv-production.up.railway.app';
        const msg =
          `📱 <b>روابط الربط مع تطبيق الأندرويد:</b>\n\n` +
          `🔗 <b>رابط JSON المباشر للقنوات:</b>\n` +
          `<code>${baseUrl}/api/app/channels</code>\n\n` +
          `🔗 <b>رابط M3U المباشر للقنوات:</b>\n` +
          `<code>${baseUrl}/api/app/playlist.m3u</code>\n\n` +
          `💡 يمكنك وضع أي من هذه الروابط داخل كود تطبيق الأندرويد ليقوم بسحب القنوات تلقائياً وتحديثها بدون أي تدخل منك.`;

        await this.sendMessage(chatId, msg);
      } else if (command === '/check') {
        await this.sendMessage(chatId, '🔍 جاري فحص استجابة السيرفر والقنوات...');
        const channels = await channelRepository.listChannels();
        const sample = channels.slice(0, 5);

        let okCount = 0;
        for (const ch of sample) {
          if (ch.enabled !== false) okCount++;
        }

        await this.sendMessage(
          chatId,
          `✅ <b>نتيجة الفحص:</b>\n` +
          `السيرفر يعمل بكفاءة.\n` +
          `القنوات المفحوصة: ${sample.length}\n` +
          `القنوات الجاهزة للبث: ${okCount}`
        );
      } else if (command === '/sniff') {
        const parts = args.split(/\s+/);
        const targetUrl = parts[0];
        const rawName = parts.slice(1).join(' ').trim() || `قناة بث ${new Date().toLocaleTimeString('ar-EG')}`;

        if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
          await this.sendMessage(
            chatId,
            `⚠️ <b>طريقة استخدام القنّاص:</b>\n\n` +
            `أرسل رابط صفحة المباراة أو البث وسيقوم السكربت بتفكيكها واستخراج رابط الـ m3u8 وإضافته تلقائياً لموقعك:\n` +
            `<code>/sniff &lt;رابط_الصفحة&gt; [اسم_القناة]</code>\n\n` +
            `مثال:\n` +
            `<code>/sniff https://example.com/match-live beIN_1</code>`
          );
          return;
        }

        await this.sendMessage(chatId, `🕵️‍♂️ <b>جاري قنص الرابط...</b>\nنقوم بفحص الصفحة والمشغلات لاستخراج رابط البث المباشر.`);

        const { snifferService } = await import('./sniffer.service');
        const result = await snifferService.sniffWebpage(targetUrl);

        if (!result.success || !result.streamUrl) {
          await this.sendMessage(chatId, `❌ <b>فشل القنص:</b>\n${result.error || 'لم يتم العثور على رابط بث مباشر صالح.'}`);
          return;
        }

        const channelName = rawName.replace(/_/g, ' ');
        const createdChannel = await channelRepository.createChannel({
          sourceId: 'telegram-sniff',
          name: channelName,
          normalizedName: channelName.toLowerCase(),
          inputType: 'HLS',
          inputStatus: 'ONLINE',
          transcodingStatus: 'STOPPED',
          encryptedInputUrl: encrypt(result.streamUrl),
          groupTitle: 'Sniffed Live',
          enabled: true,
          preset: 'COPY',
        });

        await this.sendMessage(
          chatId,
          `🎯 <b>تم قنص واستخراج البث بنجاح!</b>\n\n` +
          `📺 القناة: <b>${createdChannel.name}</b>\n` +
          `🔗 رابط البث الخام: <code>${result.streamUrl.slice(0, 70)}...</code>\n` +
          `🆔 المعرف في موقعك: <code>${createdChannel.id}</code>\n\n` +
          `✅ أصبحت القناة جاهزة للبث في موقعك وتطبيق الأندرويد فوراً!`
        );
      } else if (
        command === '/scan_all' ||
        command === '/scan_sports' ||
        command === '/scan_iraq' ||
        command === '/scan_arabic' ||
        command === '/sync_sports' ||
        command === '/sports'
      ) {
        let category: 'all' | 'sports' | 'iraq' | 'arabic' = 'all';
        let titleDesc = 'الشامل (عراقية + beIN + عربية + أخبار)';

        if (command === '/scan_iraq') {
          category = 'iraq';
          titleDesc = 'القنوات العراقية';
        } else if (command === '/scan_sports' || command === '/sync_sports' || command === '/sports') {
          category = 'sports';
          titleDesc = 'قنوات beIN Sports والرياضة';
        } else if (command === '/scan_arabic') {
          category = 'arabic';
          titleDesc = 'القنوات العربية والمنوعة';
        }

        await this.sendMessage(
          chatId,
          `🚀 <b>بدء الفحص السريع الذكي: ${titleDesc}</b>\n` +
          `⚡ نقوم الآن بفحص الروابط بالتوازي والتأكد من البثوث الشغالة وتصفيتها...`
        );

        const { snifferService } = await import('./sniffer.service');
        const syncRes = await snifferService.superScan(category, 60);

        let replyMsg =
          `🏆 <b>تقرير الفحص والمزامنة (${titleDesc}):</b>\n\n` +
          `📊 تم مسح وفحص: <b>${syncRes.totalScanned}</b> قناة\n` +
          `🟢 قنوات نشطة ومضافة: <b>${syncRes.addedCount}</b>\n` +
          `🔄 قنوات تم تحديثها: <b>${syncRes.updatedCount}</b>\n\n`;

        if (syncRes.byCategory && Object.keys(syncRes.byCategory).length > 0) {
          replyMsg += `<b>التصنيفات المكتشفة:</b>\n`;
          for (const [catName, count] of Object.entries(syncRes.byCategory)) {
            replyMsg += `• ${catName}: ${count} قناة\n`;
          }
          replyMsg += `\n`;
        }

        if (syncRes.activeChannels.length > 0) {
          replyMsg += `<b>أهم القنوات المتوفرة حالياً:</b>\n`;
          syncRes.activeChannels.slice(0, 10).forEach((c, idx) => {
            replyMsg += `${idx + 1}. 📺 ${c.name} <i>(${c.category})</i>\n`;
          });
          replyMsg += `\n📥 لتحميل ملف القنوات الكامل لتطبيقك أرسل: <code>/playlist</code>`;
        } else {
          replyMsg += `⚠️ لم يتم العثور على روابط بث نشطة حالياً. يمكنك استخدام <code>/sniff</code> لقنص رابط مباشر.`;
        }

        await this.sendMessage(chatId, replyMsg);
      } else if (command === '/repair_db' || command === '/init_db') {
        await this.sendMessage(chatId, '🛠️ جاري فحص وإعادة بناء جداول قاعدة البيانات...');
        const { initDatabase } = await import('../db');
        const ok = await initDatabase(true);
        if (ok) {
          await this.sendMessage(chatId, '✅ تم تهيئة وإعادة بناء جميع جداول قاعدة البيانات بنجاح! يمكنك الآن استخدام البوت بشكل طبيعي.');
        } else {
          await this.sendMessage(chatId, '❌ فشل الاتصال بقاعدة البيانات. تأكد من أن سيرفر Postgres يعمل في Railway.');
        }
      } else if (command === '/clean' || command === '/purge') {
        await this.sendMessage(chatId, '🧹 جاري تنظيف القنوات وترتيب الباقات وحذف القنوات الأجنبية غير المرغوبة...');
        const { snifferService } = await import('./sniffer.service');
        const cleaned = await snifferService.purgeForeignSpam();
        await this.sendMessage(
          chatId,
          `✨ <b>تم التنظيف والترتيب بنجاح!</b>\n\n` +
          `تم تنظيف وترتيب: <b>${cleaned}</b> قناة.\n` +
          `تم عزل القنوات الأجنبية غير المرغوبة، وتقسيم القنوات ذات الأرقام (1, 2, 3) إلى باقات منظمة في موقعك وتطبيقك!`
        );
      }
    } catch (err: any) {
      console.error('[Telegram Bot] Error processing command:', err.message);
      if (err.message && (err.message.includes('does not exist') || err.message.includes('42P01'))) {
        try {
          const { initDatabase } = await import('../db');
          await initDatabase(true);
          await this.sendMessage(
            chatId,
            `⚠️ تم اكتشاف أن جداول قاعدة البيانات ممسوحة حديثاً.\n` +
            `🛠️ <b>تمت إعادة بناء الجداول تلقائياً بنجاح!</b>\n\n` +
            `أعد إرسال أمر <code>${command}</code> الآن وسيعمل مباشرة!`
          );
          return;
        } catch {}
      }
      await this.sendMessage(chatId, `⚠️ حدث خطأ أثناء المعالجة: ${err.message}`);
    }
  }

  private telegramGet(path: string): Promise<any> {
    return new Promise((resolve) => {
      https
        .get(`https://api.telegram.org${path}`, { timeout: 20000 }, (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve(null);
            }
          });
        })
        .on('error', () => resolve(null));
    });
  }

  private telegramRequest(method: string, bodyJson: string): Promise<any> {
    return new Promise((resolve) => {
      const req = https.request(
        {
          hostname: 'api.telegram.org',
          path: `/bot${this.botToken}/${method}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyJson),
          },
          timeout: 15000,
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve(null);
            }
          });
        }
      );
      req.on('error', () => resolve(null));
      req.write(bodyJson);
      req.end();
    });
  }
}

export const telegramService = new TelegramService();
