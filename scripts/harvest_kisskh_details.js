const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

async function fetchDrama(id) {
  const url = `https://kisskh.co/api/DramaList/Drama/${id}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Referer: 'https://kisskh.co/',
      Accept: 'application/json, text/plain, */*',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function harvest() {
  const catalogPath = path.join(__dirname, '..', 'data', 'kisskh_catalog.json');
  if (!fs.existsSync(catalogPath)) {
    console.error('kisskh_catalog.json not found!');
    return;
  }
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const topDramas = catalog.items.slice(0, 150);
  console.log(`--- جلب تفاصيل وحلقات أشهر ${topDramas.length} عمل درامي في KissKH ---`);

  const outPath = path.join(__dirname, '..', 'data', 'kisskh_dramas.json');
  let dramasMap = {};
  if (fs.existsSync(outPath)) {
    try {
      dramasMap = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    } catch (e) {}
  }

  let completed = Object.keys(dramasMap).length;
  const t0 = Date.now();

  for (const item of topDramas) {
    if (dramasMap[item.id]) continue;
    try {
      const d = await fetchDrama(item.id);
      if (d && d.id) {
        dramasMap[d.id] = {
          id: d.id,
          title: d.title,
          description: d.description || '',
          thumbnail: d.thumbnail,
          releaseDate: d.releaseDate || '',
          country: d.country || 'Asian',
          status: d.status || 'Completed',
          type: d.type || 'TVSeries',
          trailer: d.trailer || null,
          episodes: (d.episodes || []).map((ep) => ({
            id: ep.id,
            number: ep.number,
            sub: ep.sub,
          })),
        };
        completed++;
        process.stdout.write(`\r[+] جلب: ${d.title.substring(0, 30)} (إجمالي: ${completed}/${topDramas.length})`);
      }
    } catch (e) {
      // Continue next
    }
    await new Promise((r) => setTimeout(r, 80));
  }

  fs.writeFileSync(outPath, JSON.stringify(dramasMap), 'utf8');
  console.log(`\n[✓] اكتمل جلب ${completed} عمل فني بحلقاتهم في ${((Date.now() - t0) / 1000).toFixed(1)} ثانية.`);
  console.log(`[✓] تم حفظ التفاصيل في: ${outPath} (بحجم ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
}

harvest().catch((err) => {
  console.error('[!] خطأ:', err);
});
