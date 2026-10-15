const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

async function fetchPage(page, pageSize = 100) {
  const url = `https://kisskh.co/api/DramaList/List?page=${page}&pageSize=${pageSize}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Referer: 'https://kisskh.co/',
      Accept: 'application/json, text/plain, */*',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on page ${page}`);
  }
  return res.json();
}

async function harvest() {
  console.log('--- جلب مكتبة دراما وآسيوية (KissKH Asian Dramas & Movies) من الألف إلى الياء ---');
  const t0 = Date.now();
  const first = await fetchPage(1, 100);
  const totalCount = first.totalCount || 13098;
  const totalPages = Math.ceil(totalCount / 100);
  console.log(`[✓] إجمالي الأعمال المتاحة في KissKH: ${totalCount} عمل فني (${totalPages} صفحة).`);

  const allItems = [...(first.data || [])];
  const concurrency = 6;
  const remainingPages = [];
  for (let p = 2; p <= totalPages; p++) {
    remainingPages.push(p);
  }

  while (remainingPages.length > 0) {
    const batch = remainingPages.splice(0, concurrency);
    const results = await Promise.allSettled(batch.map((p) => fetchPage(p, 100)));
    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      const pageNum = batch[i];
      if (res.status === 'fulfilled' && res.value && Array.isArray(res.value.data)) {
        allItems.push(...res.value.data);
      } else {
        console.warn(`[!] فشل الصفحة ${pageNum}, إعادة المحاولة لاحقاً...`);
      }
    }
    process.stdout.write(`\r[+] تم جلب ${allItems.length} / ${totalCount} عمل فني...`);
  }

  console.log(`\n[✓] اكتمل جلب ${allItems.length} عمل فني في ${((Date.now() - t0) / 1000).toFixed(1)} ثانية.`);

  // Deduplicate by ID
  const map = new Map();
  for (const item of allItems) {
    if (item && item.id && !map.has(item.id)) {
      map.set(item.id, {
        id: item.id,
        title: item.title,
        thumbnail: item.thumbnail || '',
        episodesCount: item.episodesCount || 0,
        label: item.label || '',
      });
    }
  }

  const catalog = {
    updatedAt: new Date().toISOString(),
    totalCount: map.size,
    items: Array.from(map.values()),
  };

  const outPath = path.join(__dirname, '..', 'data', 'kisskh_catalog.json');
  fs.writeFileSync(outPath, JSON.stringify(catalog), 'utf8');
  console.log(`[✓] تم حفظ الكتالوج بنجاح في: ${outPath} (بحجم ${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB)`);
}

harvest().catch((err) => {
  console.error('[!] خطأ أثناء الجلب:', err);
  process.exit(1);
});
