const fs = require('fs');
const path = require('path');
const { kisskhService } = require('../apps/api/dist/services/kisskh.service');

const STREAMS_PATH = path.join(__dirname, '..', 'data', 'kisskh_streams.json');
const SUBS_PATH = path.join(__dirname, '..', 'data', 'kisskh_subtitles.json');
const DRAMAS_PATH = path.join(__dirname, '..', 'data', 'kisskh_dramas.json');
const CATALOG_PATH = path.join(__dirname, '..', 'data', 'kisskh_catalog.json');

const mirrors = ['kisskh.do', 'kisskh.la', 'kisskh.id', 'kisskh.is', 'kisskh.ovh', 'kisskh.co'];
let mirrorIndex = 0;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getStream(epId) {
  const kkey = kisskhService.generateVideoKKey(epId);
  for (let attempt = 0; attempt < 3; attempt++) {
    for (let i = 0; i < mirrors.length; i++) {
      const domain = mirrors[(mirrorIndex++) % mirrors.length];
      try {
        const res = await fetch(`https://${domain}/api/DramaList/Episode/${epId}.png?kkey=${kkey}`, {
          headers: { 'User-Agent': 'Dart/3.0 (dart:io)', 'Accept': '*/*' },
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) {
          const json = await res.json();
          if (json && (json.Video || json.ThirdParty)) {
            return { videoUrl: json.Video || '', backupUrl: json.ThirdParty || null, type: json.Type || 1 };
          }
          return null;
        }
        if (res.status === 429) {
          await sleep(1500);
          continue;
        }
      } catch {}
    }
    await sleep(2000);
  }
  return null;
}

async function getSubs(epId) {
  const subKey = kisskhService.generateSubKKey(epId);
  for (let i = 0; i < mirrors.length; i++) {
    const domain = mirrors[(mirrorIndex++) % mirrors.length];
    try {
      const res = await fetch(`https://${domain}/api/Sub/${epId}?kkey=${subKey}`, {
        headers: { 'User-Agent': 'Dart/3.0 (dart:io)', 'Accept': '*/*' },
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list)) {
          return list.map((item) => ({
            src: item.src,
            label: item.label || 'Sub',
            land: item.land || 'en',
            default: Boolean(item.default),
          }));
        }
      }
    } catch {}
  }
  return [];
}

async function run() {
  console.log('=== حصاد وتفعيل جميع مسلسلات وأفلام الصفحات 1 و 2 و 3 و 4 و 5 بالكامل ===');

  const cat = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const dramas = JSON.parse(fs.readFileSync(DRAMAS_PATH, 'utf8'));
  let streams = JSON.parse(fs.readFileSync(STREAMS_PATH, 'utf8'));
  let subs = JSON.parse(fs.readFileSync(SUBS_PATH, 'utf8'));

  // Target all items across pages 1 to 5 (items 0 to 150)
  const targetItems = cat.items.slice(0, 150);
  console.log(`فحص ${targetItems.length} عمل في أول 5 صفحات من الكتالوج...`);

  // Ensure details exist in dramas
  for (const item of targetItems) {
    if (!dramas[String(item.id)]) {
      for (const domain of mirrors) {
        try {
          const res = await fetch(`https://${domain}/api/DramaList/Drama/${item.id}`, {
            headers: { 'User-Agent': 'Dart/3.0 (dart:io)', 'Accept': '*/*' },
            signal: AbortSignal.timeout(4000),
          });
          if (res.ok) {
            const d = await res.json();
            if (d && d.id) {
              dramas[String(d.id)] = {
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
                  sub: ep.sub || 0,
                })),
              };
              console.log(`[+] تم جلب قائمة حلقات العمل: ${d.title}`);
              break;
            }
          }
        } catch {}
      }
      await sleep(150);
    }
  }

  fs.writeFileSync(DRAMAS_PATH, JSON.stringify(dramas, null, 2), 'utf8');

  // Now harvest all missing streams for all items in pages 1 to 5
  const queue = [];
  for (const item of targetItems) {
    const d = dramas[String(item.id)];
    if (d && Array.isArray(d.episodes)) {
      for (const ep of d.episodes) {
        if (!streams[String(ep.id)]) {
          queue.push({
            dramaTitle: d.title,
            dramaId: d.id,
            epId: ep.id,
            epNum: ep.number,
            hasSub: (ep.sub || 0) > 0,
          });
        }
      }
    }
  }

  console.log(`إجمالي الحلقات المطلوبة لتفعيل الصفحات 1 إلى 5 بنسبة 100%: ${queue.length} حلقة`);

  let added = 0;
  let skipped = 0;
  const t0 = Date.now();

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    const s = await getStream(item.epId);

    if (s && s.videoUrl && !s.videoUrl.includes('tickcounter')) {
      streams[String(item.epId)] = s;
      added++;
      if (item.hasSub && !subs[String(item.epId)]) {
        const subList = await getSubs(item.epId);
        if (subList.length > 0) subs[String(item.epId)] = subList;
      }
    } else {
      skipped++;
    }

    if ((i + 1) % 20 === 0 || i === queue.length - 1) {
      fs.writeFileSync(STREAMS_PATH, JSON.stringify(streams, null, 2), 'utf8');
      fs.writeFileSync(SUBS_PATH, JSON.stringify(subs, null, 2), 'utf8');
      const rate = ((i + 1) / ((Date.now() - t0) / 1000)).toFixed(1);
      console.log(`[+] تقدم الحصاد للصفحات: ${i + 1}/${queue.length} | تم الحفظ: ${added} | تم التخطي: ${skipped} (${rate} حلقة/ثانية)`);
    }

    await sleep(220);
  }

  fs.writeFileSync(STREAMS_PATH, JSON.stringify(streams, null, 2), 'utf8');
  fs.writeFileSync(SUBS_PATH, JSON.stringify(subs, null, 2), 'utf8');
  console.log(`[✓] اكتمل تفعيل الصفحات 1 إلى 5 بالكامل بنجاح! تم حفظ ${added} حلقة.`);
}

run().catch((e) => console.error('خطأ:', e));
