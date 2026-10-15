const fs = require('fs');
const path = require('path');
const { kisskhService } = require('../apps/api/dist/services/kisskh.service');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

async function fetchStream(epId) {
  const kkey = kisskhService.generateVideoKKey(epId);
  const url = `https://kisskh.co/api/DramaList/Episode/${epId}.png?kkey=${kkey}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Referer: 'https://kisskh.co/',
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const dramasPath = path.join(__dirname, '..', 'data', 'kisskh_dramas.json');
  if (!fs.existsSync(dramasPath)) {
    console.error('kisskh_dramas.json not found!');
    return;
  }
  const dramas = JSON.parse(fs.readFileSync(dramasPath, 'utf8'));

  const outPath = path.join(__dirname, '..', 'data', 'kisskh_streams.json');
  let streamsMap = {};
  if (fs.existsSync(outPath)) {
    try {
      streamsMap = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    } catch (e) {}
  }

  // Explicitly ensure episode 307 is included first!
  const epQueue = [{ epId: 307, dramaTitle: 'The Bride of Habaek', epNum: 1 }];

  for (const drama of Object.values(dramas)) {
    for (const ep of drama.episodes || []) {
      if (ep.id && !epQueue.some(x => x.epId === ep.id)) {
        epQueue.push({ epId: ep.id, dramaTitle: drama.title, epNum: ep.number });
      }
    }
  }

  console.log(`--- جلب روابط البث المباشر لأشهر الأعمال (إجمالي ${epQueue.length} حلقة) ---`);
  let savedCount = 0;

  for (let i = 0; i < Math.min(epQueue.length, 120); i++) {
    const item = epQueue[i];
    if (streamsMap[item.epId]) {
      continue;
    }

    try {
      const data = await fetchStream(item.epId);
      if (data && (data.Video || data.ThirdParty)) {
        streamsMap[item.epId] = {
          videoUrl: data.Video || '',
          backupUrl: data.ThirdParty || null,
          type: data.Type || 0,
        };
        savedCount++;
        process.stdout.write(`\r[+] (${savedCount}) حلقة ${item.epNum} - ${item.dramaTitle.substring(0, 25)} -> OK`);
      }
    } catch (e) {
      // Continue next
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  fs.writeFileSync(outPath, JSON.stringify(streamsMap, null, 2), 'utf8');
  console.log(`\n[✓] تم حفظ ${Object.keys(streamsMap).length} رابط بث في: ${outPath}`);
}

main().catch(console.error);
