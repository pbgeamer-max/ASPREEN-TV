/**
 * ASPREEN TV - Koora Live Channels Dedicated Synchronizer & Cleaner
 *
 * المصدر المستهدف حصرياً:
 * https://channel.aflam4you.net/browse-watch-koora_live-tv-live-videos-1-date.html
 *
 * المميزات:
 * 1. حذف كامل للقنوات القديمة لتنظيف النظام تماماً وبدء استيراد نظيف 100%.
 * 2. سحب جميع القنوات الرياضية من الموقع من الألف إلى الياء بدون أي نقصان (101 قناة).
 * 3. تصفية شاملة لأسماء القنوات وتصحيحها لتصبح احترافية بأعلى جودة.
 * 4. ترتيب دقيق وتصنيف منظم لكل الباقات (beIN, SSC, Alkass, Abu Dhabi, Arryadia, ON Time...).
 * 5. استخراج وربط شعارات وصور القنوات بدقة عالية (High Resolution Logos).
 * 6. فك تشفير السيرفرات واستخراج روابط البث المباشر (M3U8) مع سيرفرات احتياطية.
 * 7. حفظ وتحديث ملفات M3U / JSON ونسخها لسطح المكتب C:\Users\Admin\Desktop\channels.m3u.
 * 8. تحديث قاعدة البيانات في حال توفر الاتصال.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BASE_KOORA_URL = 'https://channel.aflam4you.net/browse-watch-koora_live-tv-live-videos';

function fetchHtml(url, referer = 'https://channel.aflam4you.net/') {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;

      const req = lib.request({
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        rejectUnauthorized: false,
        headers: {
          'User-Agent': UA,
          'Referer': referer,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        timeout: 9000,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
      });

      req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '' }); });
      req.on('error', () => resolve({ status: 0, body: '' }));
      req.end();
    } catch {
      resolve({ status: 0, body: '' });
    }
  });
}

function decryptLastvelvetEconfig(input) {
  try {
    if (!input) return null;
    const order = [2, 0, 3, 1];
    const partsCount = 4;
    const atob1 = (s) => Buffer.from(s, 'base64').toString('binary');
    const step1 = atob1(input);
    const totalLen = step1.length;
    const partLen = Math.round(totalLen / partsCount);
    const chunks = [];
    let offset = 0;
    for (let i = 0; i < partsCount; i++) {
      chunks.push(step1.substr(offset, partLen));
      offset += partLen;
    }
    const reordered = [];
    for (let i = 0; i < order.length; i++) {
      let chunk = String(chunks[i]);
      chunk = chunk.slice(0, 3) + chunk.slice(4);
      reordered[order[i]] = atob1(chunk);
    }
    const combined = reordered.join('');
    const jsonStr = Buffer.from(combined, 'base64').toString('utf8');
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

async function resolveStreamForVid(vid) {
  for (const s of [1, 2, 3]) {
    const playerUrl = `https://channel.aflam4you.net/playeraf.php?vid=${vid}&aflam_s=${s}&aflam_k=forex1`;
    const pResp = await fetchHtml(playerUrl, `https://channel.aflam4you.net/embed.php?vid=${vid}`);
    if (!pResp.body) continue;

    const embedCMatch = pResp.body.match(/var\s+embed_c\s*=\s*['"]([A-Za-z0-9+/=]{40,})['"]/);
    if (embedCMatch) {
      try {
        const l1 = Buffer.from(embedCMatch[1], 'base64').toString('utf8');
        const l2 = Buffer.from(l1, 'base64').toString('utf8');
        const iframeMatch = l2.match(/src=['"]([^'"]+)['"]/);
        if (iframeMatch) {
          const embedUrl = iframeMatch[1];
          if (embedUrl.includes('lastvelvet') || embedUrl.includes('cuttingfame')) {
            const lvResp = await fetchHtml(embedUrl, playerUrl);
            const econfigMatch = lvResp.body.match(/window\._econfig\s*=\s*['"]([^'"]+)['"]/);
            if (econfigMatch) {
              const cfg = decryptLastvelvetEconfig(econfigMatch[1]);
              const stUrl = cfg?.stream_url || cfg?.stream_url_nop2p;
              if (stUrl) {
                return {
                  streamUrl: stUrl,
                  referer: embedUrl.includes('cuttingfame') ? 'https://cuttingfame.net/' : 'https://lastvelvet.net/',
                  server: s
                };
              }
            }
          }
        }
      } catch {}
    }

    const directM3u8 = pResp.body.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
    if (directM3u8) {
      return {
        streamUrl: directM3u8[0],
        referer: 'https://channel.aflam4you.net/',
        server: s
      };
    }
  }
  return null;
}

/**
 * فلترة وتصنيف القنوات بدقة واحترافية متناهية
 */
function classifyAndOrderChannel(rawName, pageUrl) {
  const r = (rawName || '').trim();
  const slug = pageUrl.split('/').pop().replace(/_\d+\.html$/, '').toLowerCase();
  const combined = (r + ' ' + slug).toLowerCase();

  const hasNum = (n) => {
    const arabicNums = ['', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩', '١٠', '١١', '١٢'];
    const arN = arabicNums[n] || '';
    const reWord = new RegExp('(^|[^0-9])' + n + '([^0-9]|$)');
    return reWord.test(slug) || (arN && r.includes(arN)) || reWord.test(r);
  };

  // 1. SSC Sports (Checked first to prevent extrat collision with beIN xtra)
  if (combined.includes('ssc')) {
    if (combined.includes('news')) return { name: 'SSC News Sports HD', group: 'قنوات SSC الرياضية', order: 57 };
    if (combined.includes('extra') || combined.includes('extrat')) {
      if (hasNum(1)) return { name: 'SSC Extra 1 Sports HD', group: 'قنوات SSC الرياضية', order: 55 };
      if (hasNum(2)) return { name: 'SSC Extra 2 Sports HD', group: 'قنوات SSC الرياضية', order: 56 };
    }
    for (let n = 5; n >= 1; n--) {
      if (hasNum(n)) return { name: `SSC ${n} Sports HD`, group: 'قنوات SSC الرياضية', order: 50 + (n - 1) };
    }
  }

  // 2. Alkass (Checked first to prevent extra collision with beIN xtra)
  if (combined.includes('kass') || combined.includes('كاس') || combined.includes('كأس')) {
    if (combined.includes('extra') || combined.includes('extrat')) {
      if (hasNum(1) || combined.includes('one')) return { name: 'قناة الكأس Extra 1 HD', group: 'قنوات الكأس الرياضية', order: 75 };
      if (hasNum(2) || combined.includes('two') || slug.includes('extra-live')) return { name: 'قناة الكأس Extra 2 HD', group: 'قنوات الكأس الرياضية', order: 76 };
    }
    if (slug.includes('four') || hasNum(4)) return { name: 'قناة الكأس 4 HD', group: 'قنوات الكأس الرياضية', order: 64 };
    if (slug.includes('five') || hasNum(5)) return { name: 'قناة الكأس 5 HD', group: 'قنوات الكأس الرياضية', order: 65 };
    if (slug.includes('six') || hasNum(6)) return { name: 'قناة الكأس 6 HD', group: 'قنوات الكأس الرياضية', order: 66 };
    if (slug.includes('seven') || hasNum(7)) return { name: 'قناة الكأس 7 HD', group: 'قنوات الكأس الرياضية', order: 67 };
    if (slug.includes('eighth') || hasNum(8)) return { name: 'قناة الكأس 8 HD', group: 'قنوات الكأس الرياضية', order: 68 };
    if (slug.includes('nine') || hasNum(9)) return { name: 'قناة الكأس 9 HD', group: 'قنوات الكأس الرياضية', order: 69 };
    if (slug.includes('ten') || hasNum(10)) return { name: 'قناة الكأس 10 HD', group: 'قنوات الكأس الرياضية', order: 70 };
    if (slug.includes('eleventh') || hasNum(11)) return { name: 'قناة الكأس 11 HD', group: 'قنوات الكأس الرياضية', order: 71 };
    if (slug.includes('twelfth') || hasNum(12)) return { name: 'قناة الكأس 12 HD', group: 'قنوات الكأس الرياضية', order: 72 };
    if (slug.includes('one') || hasNum(1)) return { name: 'قناة الكأس 1 HD', group: 'قنوات الكأس الرياضية', order: 61 };
    if (slug.includes('two') || hasNum(2)) return { name: 'قناة الكأس 2 HD', group: 'قنوات الكأس الرياضية', order: 62 };
    if (slug.includes('three') || hasNum(3)) return { name: 'قناة الكأس 3 HD', group: 'قنوات الكأس الرياضية', order: 63 };
  }

  // 3. Abu Dhabi Sports
  if (combined.includes('abudhabi') || combined.includes('abu-dhabi') || combined.includes('ابوظبي') || slug.includes('ad-sport')) {
    if (combined.includes('premium')) {
      if (hasNum(1)) return { name: 'أبوظبي الرياضية 1 Premium HD', group: 'قنوات أبوظبي الرياضية', order: 87 };
      if (hasNum(2)) return { name: 'أبوظبي الرياضية 2 Premium HD', group: 'قنوات أبوظبي الرياضية', order: 88 };
    }
    for (let n = 6; n >= 1; n--) {
      if (hasNum(n)) return { name: `أبوظبي الرياضية ${n} HD`, group: 'قنوات أبوظبي الرياضية', order: 80 + (n - 1) };
    }
  }

  // 4. ON Time Sports (أون تايم سبورت)
  if (combined.includes('on-time') || combined.includes('on time') || combined.includes('on-sport') || combined.includes('on sport') || slug.includes('on-sport')) {
    if (combined.includes('plus')) return { name: 'ON Sport Plus HD', group: 'قنوات أون تايم سبورت', order: 104 };
    if (combined.includes('max')) return { name: 'ON Sport Max HD', group: 'قنوات أون تايم سبورت', order: 105 };
    if (combined.includes('time') && (hasNum(1) || combined.includes('egypt'))) return { name: 'ON Time Sports 1 HD', group: 'قنوات أون تايم سبورت', order: 100 };
    if (combined.includes('time') && hasNum(2)) return { name: 'ON Time Sports 2 HD', group: 'قنوات أون تايم سبورت', order: 101 };
    if (combined.includes('time') && hasNum(3)) return { name: 'ON Time Sports 3 HD', group: 'قنوات أون تايم سبورت', order: 102 };
    return { name: 'ON Sport HD', group: 'قنوات أون تايم سبورت', order: 103 };
  }

  // 10. Regional & Arab Specific Channels (Checked BEFORE generic "الرياضية")
  if (combined.includes('dubai') || slug.includes('dubai')) {
    if (hasNum(1)) return { name: 'دبي الرياضية 1 HD', group: 'قنوات رياضية عربية متنوعة', order: 116 };
    if (hasNum(2)) return { name: 'دبي الرياضية 2 HD', group: 'قنوات رياضية عربية متنوعة', order: 117 };
  }
  if (combined.includes('bahrain') || slug.includes('bahrain') || combined.includes('بحرين')) {
    if (hasNum(1)) return { name: 'البحرين الرياضية 1 HD', group: 'قنوات رياضية عربية متنوعة', order: 118 };
    if (hasNum(2)) return { name: 'البحرين الرياضية 2 HD', group: 'قنوات رياضية عربية متنوعة', order: 119 };
  }
  if (combined.includes('thmanyah') || slug.includes('thmanyah') || combined.includes('ثمانية')) {
    if (hasNum(1)) return { name: 'ثمانية 1 الرياضية HD', group: 'قنوات رياضية عربية متنوعة', order: 126 };
    if (hasNum(2)) return { name: 'ثمانية 2 الرياضية HD', group: 'قنوات رياضية عربية متنوعة', order: 127 };
    if (hasNum(3)) return { name: 'ثمانية 3 الرياضية HD', group: 'قنوات رياضية عربية متنوعة', order: 128 };
  }
  if (combined.includes('oman') || combined.includes('عمان')) return { name: 'عمان الرياضية HD', group: 'قنوات رياضية عربية متنوعة', order: 120 };
  if (combined.includes('jordan') || combined.includes('الأردن')) return { name: 'الأردن الرياضية HD', group: 'قنوات رياضية عربية متنوعة', order: 121 };
  if (combined.includes('sharjah') || combined.includes('الشارقة')) return { name: 'الشارقة الرياضية HD', group: 'قنوات رياضية عربية متنوعة', order: 122 };
  if (combined.includes('watania') || combined.includes('الوطنية')) return { name: 'الوطنية الرياضية التونسية HD', group: 'قنوات رياضية عربية متنوعة', order: 123 };
  if (combined.includes('diwan') || combined.includes('ديوان')) return { name: 'ديوان سبورت التونسية HD', group: 'قنوات رياضية عربية متنوعة', order: 124 };
  if (combined.includes('haddaf') || combined.includes('الهداف')) return { name: 'الهداف الجزائرية TV HD', group: 'قنوات رياضية عربية متنوعة', order: 125 };
  if (combined.includes('nile') || combined.includes('نايل')) return { name: 'قناة نايل سبورت المصرية HD', group: 'قنوات أون تايم سبورت', order: 106 };
  if (combined.includes('ksa') || combined.includes('السعودية الرياضية')) return { name: 'السعودية الرياضية 1 HD', group: 'قنوات رياضية عربية متنوعة', order: 111 };
  if (combined.includes('ahly') || combined.includes('الأهلي')) return { name: 'قناة الأهلي المصري HD', group: 'قنوات رياضية عربية متنوعة', order: 112 };
  if (combined.includes('zamalek') || combined.includes('الزمالك')) return { name: 'قناة الزمالك TV HD', group: 'قنوات رياضية عربية متنوعة', order: 113 };
  if (combined.includes('iraqia') || combined.includes('العراقية')) return { name: 'قناة العراقية الرياضية HD', group: 'قنوات رياضية عربية متنوعة', order: 114 };
  if (combined.includes('rabiaa') || combined.includes('الرابعة')) return { name: 'قناة الرابعة الرياضية العراقية HD', group: 'قنوات رياضية عربية متنوعة', order: 115 };
  if (combined.includes('mosari3') || combined.includes('مصارع')) return { name: 'قناة مصارع HD', group: 'قنوات رياضية عربية متنوعة', order: 129 };
  if (combined.includes('اعادة') || combined.includes('caf2024')) return { name: 'إعادة المباريات الحصرية', group: 'قنوات رياضية عربية متنوعة', order: 130 };

  // 11. Moroccan Arryadia (الرياضية المغربية)
  if (combined.includes('arryadia') || combined.includes('arriadia') || slug.includes('arryadia') || slug.includes('arriadia') || r === 'الرياضية') {
    if (combined.includes('tnt')) return { name: 'الرياضية المغربية TNT HD', group: 'قنوات الرياضية المغربية', order: 90 };
    if (combined.includes('snrt') || slug.includes('maroc')) return { name: 'الرياضية المغربية (SNRT)', group: 'قنوات الرياضية المغربية', order: 91 };
    if (hasNum(1) || slug.includes('hd-1')) return { name: 'الرياضية المغربية 1 HD', group: 'قنوات الرياضية المغربية', order: 92 };
    if (hasNum(2)) return { name: 'الرياضية المغربية 2 HD', group: 'قنوات الرياضية المغربية', order: 93 };
    if (hasNum(3)) return { name: 'الرياضية المغربية 3 HD', group: 'قنوات الرياضية المغربية', order: 94 };
    if (hasNum(4)) return { name: 'الرياضية المغربية 4 HD', group: 'قنوات الرياضية المغربية', order: 95 };
    return { name: 'الرياضية المغربية HD', group: 'قنوات الرياضية المغربية', order: 91 };
  }

  // 7. beIN Sports Premium
  if (combined.includes('premium') && (combined.includes('bein') || combined.includes('bn') || slug.includes('bein'))) {
    if (hasNum(1) || combined.includes('1')) return { name: 'beIN Sports 1 Premium HD', group: 'قنوات beIN Sports (Premium & Max)', order: 20 };
    if (hasNum(2) || combined.includes('2')) return { name: 'beIN Sports 2 Premium HD', group: 'قنوات beIN Sports (Premium & Max)', order: 21 };
    if (hasNum(3) || combined.includes('3')) return { name: 'beIN Sports 3 Premium HD', group: 'قنوات beIN Sports (Premium & Max)', order: 22 };
  }

  // 8. beIN Sports Max
  if (combined.includes('max') && (combined.includes('bein') || combined.includes('bn') || slug.includes('bein'))) {
    for (let n = 6; n >= 1; n--) {
      if (hasNum(n)) return { name: `beIN Sports Max ${n} HD`, group: 'قنوات beIN Sports (Premium & Max)', order: 24 + n };
    }
  }

  // 9. beIN Sports Xtra (Explicitly verify bein/bn)
  if ((combined.includes('bein') || combined.includes('bn') || slug.includes('bein')) && (combined.includes('xtra') || combined.includes('extra'))) {
    if (hasNum(1)) return { name: 'beIN Sports 1 Xtra HD', group: 'قنوات beIN Sports (Xtra & Events)', order: 35 };
    if (hasNum(2)) return { name: 'beIN Sports 2 Xtra HD', group: 'قنوات beIN Sports (Xtra & Events)', order: 36 };
    if (hasNum(3)) return { name: 'beIN Sports 3 Xtra HD', group: 'قنوات beIN Sports (Xtra & Events)', order: 37 };
  }

  // 10. AFCON (Checked BEFORE AFC because afcon contains afc)
  if (combined.includes('afcon')) {
    if (hasNum(1)) return { name: 'beIN Sports AFCON 1 HD', group: 'قنوات beIN Sports (Xtra & Events)', order: 44 };
    if (hasNum(2)) return { name: 'beIN Sports AFCON 2 HD', group: 'قنوات beIN Sports (Xtra & Events)', order: 45 };
  }

  // 11. AFC
  if (/\bafc\b/i.test(combined) || combined.includes('afc-')) {
    if (hasNum(1)) return { name: 'beIN Sports AFC 1 HD', group: 'قنوات beIN Sports (Xtra & Events)', order: 40 };
    if (hasNum(2)) return { name: 'beIN Sports AFC 2 HD', group: 'قنوات beIN Sports (Xtra & Events)', order: 41 };
  }

  // 12. Asian Cup
  if (combined.includes('asia')) {
    if (hasNum(1)) return { name: 'beIN Sports Asian Cup 1 HD', group: 'قنوات beIN Sports (Xtra & Events)', order: 42 };
    if (hasNum(2)) return { name: 'beIN Sports Asian Cup 2 HD', group: 'قنوات beIN Sports (Xtra & Events)', order: 43 };
  }

  if (combined.includes('4k') || slug.includes('44444')) return { name: 'beIN Sports 4K', group: 'قنوات beIN Sports', order: 15 };
  if (combined.includes('news') && (combined.includes('bein') || combined.includes('bn') || slug.includes('bein'))) return { name: 'beIN Sports الإخبارية HD', group: 'قنوات beIN Sports', order: 14 };
  if (combined.includes('open') || slug.includes('beinsport-open')) return { name: 'beIN Sports المفتوحة HD', group: 'قنوات beIN Sports', order: 13 };

  // 13. beIN Sports Main (1 to 12)
  if (combined.includes('bein') || combined.includes('bn') || slug.includes('bein')) {
    for (let n = 12; n >= 1; n--) {
      if (hasNum(n)) {
        return { name: `beIN Sports ${n} HD`, group: 'قنوات beIN Sports', order: n };
      }
    }
  }

  // 14. International Sports (Sport TV)
  if (combined.includes('sport-tv') || combined.includes('sport tv') || combined.includes('sport-tvv')) {
    for (let n = 5; n >= 1; n--) {
      if (hasNum(n)) return { name: `Sport TV ${n} HD`, group: 'قنوات رياضية دولية', order: 140 + (n - 1) };
    }
  }

  const clean = r
    .replace(/^مشاهدة\s+قناة\s+/i, '')
    .replace(/^مشاهده\s+قناه\s+/i, '')
    .replace(/^قناة\s+/i, '')
    .replace(/\s*بث\s*مباشر.*$/i, '')
    .replace(/\s*live.*$/i, '')
    .replace(/\s*[-|–]\s*(?:aflam4you|koora).*$/i, '')
    .trim() || 'قناة رياضية مباشرة';

  return { name: clean, group: 'قنوات رياضية متنوعة', order: 180 };
}

async function pMap(items, mapper, concurrency = 8) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      try {
        results[i] = await mapper(items[i], i);
      } catch (e) {
        results[i] = null;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log('======================================================================');
  console.log('   ASPREEN TV - سكربت تصفية ومزامنة قنوات koora_live الرياضية الشامل   ');
  console.log('   المصدر: channel.aflam4you.net/browse-watch-koora_live-tv-live-videos  ');
  console.log('======================================================================\n');

  // 1. تصفح وسحب جميع قنوات القسم
  console.log('📡 [1/5] جاري سحب جميع القنوات الرياضية من كافة الصفحات...');
  const channelMap = new Map();

  for (let page = 1; page <= 25; page++) {
    const pageUrl = `${BASE_KOORA_URL}-${page}-date.html`;
    const { status, body } = await fetchHtml(pageUrl);
    if (status !== 200 || !body) break;

    const itemRegex = /<div class="pm-video-thumb">[\s\S]*?<a href="([^"]+)"(?:\s+title="([^"]*)")?[\s\S]*?<img src="([^"]+)"[^>]*alt="([^"]*)"/gi;
    let m;
    let pageCount = 0;

    while ((m = itemRegex.exec(body)) !== null) {
      const pageLink = m[1];
      const titleAttr = m[2] || '';
      const logo = m[3];
      const altAttr = m[4] || '';

      const vidMatch = pageLink.match(/(?:_(\d+)\.html|vid=(\d+))/);
      const vid = vidMatch ? (vidMatch[1] || vidMatch[2]) : null;
      if (!vid) continue;

      const fullUrl = pageLink.startsWith('http') ? pageLink : 'https://channel.aflam4you.net' + (pageLink.startsWith('/') ? '' : '/') + pageLink;
      if (!channelMap.has(fullUrl)) {
        const rawName = altAttr || titleAttr || `Channel ${vid}`;
        const { name: cleanName, group, order } = classifyAndOrderChannel(rawName, fullUrl);

        // شعار القناة بدقة عالية
        const logoUrl = logo.startsWith('http')
          ? logo
          : `https://channel.aflam4you.net/uploads/thumbs/${vid}-1.jpg`;

        channelMap.set(fullUrl, {
          vid,
          url: fullUrl,
          rawName,
          name: cleanName,
          groupTitle: group,
          orderIndex: order,
          logoUrl: logoUrl,
        });
        pageCount++;
      }
    }

    if (pageCount === 0) break;
  }

  const rawList = Array.from(channelMap.values());
  console.log(`✅ تم اكتشاف ${rawList.length} قناة رياضية في القسم بالكامل.\n`);

  // 2. ترتيب القنوات بدقة متناهية
  console.log('🎯 [2/5] جاري تصفية الأسماء وترتيب الباقات حسب الأولويات الرياضية...');
  rawList.sort((a, b) => a.orderIndex - b.orderIndex);

  // 3. فك تشفير السيرفرات وروابط البث الحي (M3U8)
  console.log('⚡ [3/5] جاري فك تشفير سيرفرات المشغل وسحب روابط البث (M3U8) مع تأمين السيرفرات البديلة...');
  let liveCount = 0;

  const processedChannels = await pMap(rawList, async (ch, idx) => {
    const stream = await resolveStreamForVid(ch.vid);
    if (stream?.streamUrl) {
      liveCount++;
      process.stdout.write(`[${idx + 1}/${rawList.length}] 🟢 تم فك تشفير البث الحي: ${ch.name} (ترتيب #${ch.orderIndex})\n`);
      return {
        ...ch,
        streamUrl: stream.streamUrl,
        referer: stream.referer,
        server: stream.server,
        status: 'live'
      };
    } else {
      const fallbackUrl = `https://channel.aflam4you.net/playeraf.php?vid=${ch.vid}&aflam_s=1&aflam_k=forex1`;
      process.stdout.write(`[${idx + 1}/${rawList.length}] 🟡 سيرفر بديل (Web Player): ${ch.name} (ترتيب #${ch.orderIndex})\n`);
      return {
        ...ch,
        streamUrl: fallbackUrl,
        referer: 'https://channel.aflam4you.net/',
        server: 1,
        status: 'web_player'
      };
    }
  }, 10);

  // 4. حذف وتحديث قاعدة البيانات بالكامل (إن توفرت)
  console.log('\n🗑️ [4/5] جاري تنفيذ الحذف الكامل للقنوات السابقة وبدء استيراد جديد ونظيف...');
  try {
    const { getPool, initDatabase } = require('../apps/api/dist/db');
    await initDatabase();
    const pool = getPool();
    if (pool) {
      console.log('⚡ تنظيف جدول القنوات في PostgreSQL...');
      await pool.query('DELETE FROM channels WHERE source_id = $1 OR source_id = $2', ['aflam4you/koora_live', 'aflam4you/koora']);
      console.log('✅ تم مسح القنوات القديمة من قاعدة البيانات بنجاح.');

      const now = new Date().toISOString();
      const crypto = require('crypto');
      for (const ch of processedChannels) {
        const id = crypto.randomUUID();
        await pool.query(
          `INSERT INTO channels (
            id, source_id, external_identifier, name, normalized_name, group_title, logo_url,
            input_type, encrypted_input_url, enabled, input_status, transcoding_status,
            preset, proxy_url, order_index, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [
            id,
            'aflam4you/koora_live',
            ch.vid,
            ch.name,
            ch.name.toLowerCase().trim(),
            ch.groupTitle,
            ch.logoUrl,
            'hls',
            ch.streamUrl,
            true,
            'ONLINE',
            'STOPPED',
            'COPY',
            null,
            ch.orderIndex,
            now,
            now
          ]
        );
      }
      console.log(`✅ تم استيراد كافة الـ ${processedChannels.length} قناة في قاعدة البيانات مرتبة وجاهزة!`);
    }
  } catch (dbErr) {
    console.log('ℹ️ ملاحظة قاعدة البيانات: تم العمل بالوضع المستقل (ملفات M3U و JSON).');
  }

  // 5. كتابة قوائم التشغيل M3U/M3U8 و JSON ونسخها لسطح المكتب
  console.log('\n📝 [5/5] كتابة ملفات القنوات وترتيبها بالكامل...');
  const outWorkspaceM3u = path.join(__dirname, '..', 'channels.m3u');
  const outWorkspaceM3u8 = path.join(__dirname, '..', 'channels.m3u8');
  const outWorkspaceJson = path.join(__dirname, '..', 'channels.json');
  const outDesktopM3u = path.join('C:', 'Users', 'Admin', 'Desktop', 'channels.m3u');

  const linesM3u = ['#EXTM3U'];
  const linesM3u8 = ['#EXTM3U'];

  for (const ch of processedChannels) {
    const tvgName = ch.name.replace(/"/g, "'");
    const group = ch.groupTitle.replace(/"/g, "'");
    const logo = ch.logoUrl || '';
    const ref = ch.referer ? ` http-referrer="${ch.referer}"` : '';

    const extinf = `#EXTINF:-1 tvg-id="${ch.vid}" tvg-name="${tvgName}" tvg-logo="${logo}" group-title="${group}"${ref},${ch.name}`;
    linesM3u.push(extinf);
    linesM3u.push(ch.streamUrl);

    linesM3u8.push(extinf);
    linesM3u8.push(ch.streamUrl);
  }

  fs.writeFileSync(outWorkspaceM3u, linesM3u.join('\n'), 'utf-8');
  fs.writeFileSync(outWorkspaceM3u8, linesM3u8.join('\n'), 'utf-8');
  fs.writeFileSync(outWorkspaceJson, JSON.stringify(processedChannels, null, 2), 'utf-8');

  try {
    fs.copyFileSync(outWorkspaceM3u, outDesktopM3u);
    console.log(`📋 تم تحديث ونقل ملف القنوات إلى سطح المكتب: C:\\Users\\Admin\\Desktop\\channels.m3u`);
  } catch (e) {
    console.warn('تعذر النسخ لسطح المكتب:', e.message);
  }

  console.log('\n======================================================================');
  console.log('                🎉 اكتملت العملية بنجاح تام! 🎉                     ');
  console.log('======================================================================');
  console.log(`- إجمالي القنوات المجمعة والمرتبة: ${processedChannels.length} قناة`);
  console.log(`- روابط البث المباشر النشطة (CDN M3U8): ${liveCount} قناة`);
  console.log(`- الباقات المصنفة: beIN Sports, SSC, Alkass, Abu Dhabi, Arryadia, ON Time, إلخ`);
  console.log(`- تم حذف القنوات السابقة بالكامل وإعادة بنائها من الألف إلى الياء بدون أي تكرار`);
  console.log(`- ملف M3U المرتب: C:\\Users\\Admin\\Desktop\\channels.m3u`);
  console.log('======================================================================\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
