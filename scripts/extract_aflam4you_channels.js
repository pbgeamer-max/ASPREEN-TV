/**
 * ASPREEN TV - Comprehensive Channel Extractor for aflam4you.net
 * Extracts ALL live TV channels from A to Z across all categories and pages.
 * Resolves live M3U8 stream URLs directly from upstream CDNs (LastVelvet / CuttingFame).
 *
 * Usage:
 *   node scripts/extract_aflam4you_channels.js
 *   node scripts/extract_aflam4you_channels.js --sports-only
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CATEGORIES = [
  { name: 'قنوات الرياضة (Sports)', base: 'https://channel.aflam4you.net/browse-watch-koora_live-tv-live-videos', code: 'sports' },
  { name: 'قنوات العامة و أفلام (General & Movies)', base: 'https://channel.aflam4you.net/browse-watch-shahid-tv-live-videos', code: 'general' },
  { name: 'قنوات الأخبار (News)', base: 'https://channel.aflam4you.net/browse-watch-news-for-today-tv-live-videos', code: 'news' },
  { name: 'قنوات الإسلامية (Islamic)', base: 'https://channel.aflam4you.net/browse-watch-islamic-tv-live-videos', code: 'islamic' },
  { name: 'قنوات الوثائقية (Documentary)', base: 'https://channel.aflam4you.net/browse-watch-documment-tv-live-videos', code: 'documentary' },
  { name: 'قنوات الأطفال (Kids)', base: 'https://channel.aflam4you.net/browse-watch-junnuir-tv-live-videos', code: 'kids' },
];

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

    // Check embed_c
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

    // Direct m3u8 in player response
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

function cleanChannelName(rawName) {
  if (!rawName) return 'قناة مباشرة';
  return rawName
    .replace(/^مشاهدة\s+قناة\s+/i, '')
    .replace(/^مشاهده\s+قناه\s+/i, '')
    .replace(/^قناة\s+/i, '')
    .replace(/\s*بث\s*مباشر.*$/i, '')
    .replace(/\s*live.*$/i, '')
    .replace(/\s*[-|–]\s*(?:aflam4you|koora).*$/i, '')
    .trim() || rawName.trim();
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
  const sportsOnly = process.argv.includes('--sports-only');
  console.log('=====================================================');
  console.log('   ASPREEN TV - مستخرج القنوات الشامل (aflam4you)   ');
  console.log('=====================================================');
  console.log(`الوضع: ${sportsOnly ? 'قنوات الرياضة فقط' : 'جميع باقات الموقع من الألف إلى الياء'}\n`);

  const categoriesToCrawl = sportsOnly ? [CATEGORIES[0]] : CATEGORIES;
  const channelMap = new Map();

  for (const cat of categoriesToCrawl) {
    console.log(`🔍 جاري فحص باقة [${cat.name}]...`);
    let catChannels = 0;

    for (let page = 1; page <= 25; page++) {
      const pageUrl = `${cat.base}-${page}-date.html`;
      const { status, body } = await fetchHtml(pageUrl);
      if (status !== 200 || !body) break;

      // Extract thumbnails and links
      // Structure: <div class="pm-video-thumb"><a href="..." title="..."><img src="..." alt="...">
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
          const displayName = cleanChannelName(rawName);

          channelMap.set(fullUrl, {
            vid,
            url: fullUrl,
            rawName,
            name: displayName,
            logo: logo.startsWith('http') ? logo : 'https://channel.aflam4you.net' + logo,
            category: cat.name,
            categoryCode: cat.code
          });
          pageCount++;
          catChannels++;
        }
      }

      // Fallback regex if pm-video-thumb not matched
      if (pageCount === 0) {
        const fallbackRegex = /href=['"]([^'"]*_(\d+)\.html)['"][^>]*>([^<]*)<\/a>/gi;
        while ((m = fallbackRegex.exec(body)) !== null) {
          const pageLink = m[1];
          const vid = m[2];
          const rawTitle = m[3].trim();
          if (pageLink.includes('browse-watch') || pageLink.includes('login')) continue;

          const fullUrl = pageLink.startsWith('http') ? pageLink : 'https://channel.aflam4you.net' + (pageLink.startsWith('/') ? '' : '/') + pageLink;
          if (!channelMap.has(fullUrl)) {
            const displayName = cleanChannelName(rawTitle || `Channel ${vid}`);
            channelMap.set(fullUrl, {
              vid,
              url: fullUrl,
              rawName: rawTitle,
              name: displayName,
              logo: `https://channel.aflam4you.net/uploads/thumbs/${vid}-1.jpg`,
              category: cat.name,
              categoryCode: cat.code
            });
            pageCount++;
            catChannels++;
          }
        }
      }

      if (pageCount === 0) {
        // No more channels on this page
        break;
      }
    }
    console.log(`   └─ تم العثور على ${catChannels} قناة في ${cat.name}\n`);
  }

  const allChannels = Array.from(channelMap.values());
  console.log(`🎯 إجمالي القنوات المكتشفة من الموقع: ${allChannels.length} قناة.`);
  console.log('⚡ جاري استخراج روابط البث الحي والمباشر (M3U8) لجميع القنوات بالتوازي...\n');

  let resolvedCount = 0;
  let fallbackCount = 0;

  const resolvedChannels = await pMap(allChannels, async (ch, index) => {
    const stream = await resolveStreamForVid(ch.vid);
    if (stream?.streamUrl) {
      resolvedCount++;
      process.stdout.write(`[${index + 1}/${allChannels.length}] ✅ تم استخراج: ${ch.name}\n`);
      return {
        ...ch,
        streamUrl: stream.streamUrl,
        referer: stream.referer,
        server: stream.server,
        status: 'live'
      };
    } else {
      fallbackCount++;
      // Provide direct embed player fallback URL so player can still play via proxy
      const fallbackUrl = `https://channel.aflam4you.net/playeraf.php?vid=${ch.vid}&aflam_s=1&aflam_k=forex1`;
      process.stdout.write(`[${index + 1}/${allChannels.length}] ⚠️ سيرفر بديل: ${ch.name}\n`);
      return {
        ...ch,
        streamUrl: fallbackUrl,
        referer: 'https://channel.aflam4you.net/',
        server: 1,
        status: 'web_player'
      };
    }
  }, 10);

  // Prepare outputs
  const outWorkspaceM3u = path.join(__dirname, '..', 'channels.m3u');
  const outWorkspaceM3u8 = path.join(__dirname, '..', 'channels.m3u8');
  const outWorkspaceJson = path.join(__dirname, '..', 'channels.json');
  const outDesktopM3u = path.join('C:', 'Users', 'Admin', 'Desktop', 'channels.m3u');
  const outDesktopAll = path.join('C:', 'Users', 'Admin', 'Desktop', 'all_channels_and_movies.m3u');

  const linesM3u = ['#EXTM3U'];
  const linesM3u8 = ['#EXTM3U'];

  for (const ch of resolvedChannels) {
    if (!ch) continue;
    const tvgName = ch.name.replace(/"/g, "'");
    const group = ch.category.replace(/"/g, "'");
    const logo = ch.logo || '';
    const ref = ch.referer ? ` http-referrer="${ch.referer}"` : '';

    const extinf = `#EXTINF:-1 tvg-id="${ch.vid}" tvg-name="${tvgName}" tvg-logo="${logo}" group-title="${group}"${ref},${ch.name}`;
    linesM3u.push(extinf);
    linesM3u.push(ch.streamUrl);

    linesM3u8.push(extinf);
    linesM3u8.push(ch.streamUrl);
  }

  fs.writeFileSync(outWorkspaceM3u, linesM3u.join('\n'), 'utf-8');
  fs.writeFileSync(outWorkspaceM3u8, linesM3u8.join('\n'), 'utf-8');
  fs.writeFileSync(outWorkspaceJson, JSON.stringify(resolvedChannels, null, 2), 'utf-8');

  // Copy to Desktop
  try {
    fs.copyFileSync(outWorkspaceM3u, outDesktopM3u);
    fs.copyFileSync(outWorkspaceM3u, outDesktopAll);
    console.log(`\n📋 تم نسخ ملف channels.m3u إلى سطح المكتب بنجاح.`);
  } catch (e) {
    console.warn('تعذر النسخ إلى سطح المكتب:', e.message);
  }

  console.log('\n=====================================================');
  console.log('             تم الانتهاء بنجاح! 🎉                 ');
  console.log('=====================================================');
  console.log(`- إجمالي القنوات المستخرجة: ${resolvedChannels.length}`);
  console.log(`- روابط البث المباشر النشطة (M3U8): ${resolvedCount}`);
  console.log(`- القنوات المسحوبة: من الألف إلى الياء (كل الصفحات والباقات)`);
  console.log(`- الملفات المنشأة:`);
  console.log(`  1. channels.m3u  (${fs.statSync(outWorkspaceM3u).size} بايت)`);
  console.log(`  2. channels.m3u8 (${fs.statSync(outWorkspaceM3u8).size} بايت)`);
  console.log(`  3. channels.json (${fs.statSync(outWorkspaceJson).size} بايت)`);
  console.log(`  4. Desktop: C:\\Users\\Admin\\Desktop\\channels.m3u`);
  console.log('=====================================================\n');
}

main().catch(err => {
  console.error('Extraction error:', err);
  process.exit(1);
});
