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

async function harvest() {
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

  // Collect all episode IDs
  const allEpIds = [];
  for (const drama of Object.values(dramas)) {
    for (const ep of drama.episodes || []) {
      if (ep.id && !streamsMap[ep.id]) {
        allEpIds.push({ epId: ep.id, dramaTitle: drama.title, epNum: ep.number });
      }
    }
  }

  console.log(`--- جلب روابط البث المباشر لـ ${allEpIds.length} حلقة من أشهر المسلسلات ---`);
  const t0 = Date.now();
  let ok = 0;
  const concurrency = 6;
  const queue = [...allEpIds];

  while (queue.length > 0) {
    const batch = queue.splice(0, concurrency);
    const results = await Promise.allSettled(
      batch.map(async (item) => {
        const data = await fetchStream(item.epId);
        return { epId: item.epId, data };
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value && r.value.data) {
        const d = r.value.data;
        streamsMap[r.value.epId] = {
          videoUrl: d.Video || '',
          backupUrl: d.ThirdParty || null,
          type: d.Type || 0,
        };
        ok++;
      }
    }

    process.stdout.write(`\r[+] تم جلب ${ok} / ${allEpIds.length} رابط بث...`);
    await new Promise((resolve) => setTimeout(resolve, 60));
  }

  fs.writeFileSync(outPath, JSON.stringify(streamsMap), 'utf8');
  console.log(`\n[✓] اكتمل جلب ${ok} رابط بث في ${((Date.now() - t0) / 1000).toFixed(1)} ثانية.`);
  console.log(`[✓] تم حفظ الروابط في: ${outPath} (بحجم ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
}

harvest().catch((err) => {
  console.error('[!] خطأ:', err);
});
