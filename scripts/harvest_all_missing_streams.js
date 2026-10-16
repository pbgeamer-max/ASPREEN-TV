const fs = require('fs');
const path = require('path');
const { kisskhService } = require('../apps/api/dist/services/kisskh.service');

const STREAMS_PATH = path.join(__dirname, '..', 'data', 'kisskh_streams.json');
const SUBS_PATH = path.join(__dirname, '..', 'data', 'kisskh_subtitles.json');
const DRAMAS_PATH = path.join(__dirname, '..', 'data', 'kisskh_dramas.json');

const mirrors = ['kisskh.do', 'kisskh.la', 'kisskh.id', 'kisskh.is', 'kisskh.ovh', 'kisskh.co'];
let mirrorIndex = 0;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchEpStream(epId) {
  const kkey = kisskhService.generateVideoKKey(epId);

  for (let i = 0; i < mirrors.length; i++) {
    const domain = mirrors[(mirrorIndex++) % mirrors.length];
    const url = `https://${domain}/api/DramaList/Episode/${epId}.png?kkey=${kkey}`;

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Dart/3.0 (dart:io)',
          'Accept': '*/*',
        },
        signal: AbortSignal.timeout(4500),
      });

      if (res.ok) {
        const json = await res.json();
        if (json && (json.Video || json.ThirdParty)) {
          return {
            videoUrl: json.Video || '',
            backupUrl: json.ThirdParty || null,
            type: json.Type || 1,
          };
        }
        return null;
      }

      if (res.status === 429) {
        // This mirror is rate limited; try next mirror
        continue;
      }
    } catch {}
  }
  return null;
}

async function fetchEpSubs(epId) {
  const subKey = kisskhService.generateSubKKey(epId);

  for (let i = 0; i < mirrors.length; i++) {
    const domain = mirrors[(mirrorIndex++) % mirrors.length];
    const url = `https://${domain}/api/Sub/${epId}?kkey=${subKey}`;

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Dart/3.0 (dart:io)',
          'Accept': '*/*',
        },
        signal: AbortSignal.timeout(4500),
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
        return [];
      }
    } catch {}
  }
  return [];
}

async function run() {
  console.log('=== بدء الحصاد الشامل لجميع روابط البث وملفات الترجمة (ASPREEN MASTER HARVEST) ===');

  const dramas = JSON.parse(fs.readFileSync(DRAMAS_PATH, 'utf8'));
  let streams = {};
  if (fs.existsSync(STREAMS_PATH)) {
    try {
      streams = JSON.parse(fs.readFileSync(STREAMS_PATH, 'utf8'));
    } catch {}
  }

  let subs = {};
  if (fs.existsSync(SUBS_PATH)) {
    try {
      subs = JSON.parse(fs.readFileSync(SUBS_PATH, 'utf8'));
    } catch {}
  }

  // Find all missing episodes
  const queue = [];

  // Prioritize active & requested dramas (Master Devil Do Not Kiss Me 1 & 2, A Trap Called Desire, Family Register, Moonshadow)
  const priorityIds = ['107', '106', '13581', '13355', '13498'];
  for (const pid of priorityIds) {
    const d = dramas[pid];
    if (d && Array.isArray(d.episodes)) {
      for (const ep of d.episodes) {
        if (!streams[String(ep.id)] || !subs[String(ep.id)]) {
          queue.push({ epId: ep.id, dramaTitle: d.title, epNum: ep.number, isPriority: true });
        }
      }
    }
  }

  // Then add all other dramas
  for (const [id, d] of Object.entries(dramas)) {
    if (priorityIds.includes(id)) continue;
    if (d && Array.isArray(d.episodes)) {
      for (const ep of d.episodes) {
        if (!streams[String(ep.id)] || !subs[String(ep.id)]) {
          queue.push({ epId: ep.id, dramaTitle: d.title, epNum: ep.number, isPriority: false });
        }
      }
    }
  }

  console.log(`إجمالي الحلقات المطلوبة للحصاد الفوري: ${queue.length} حلقة`);

  const concurrency = 6;
  let successCount = 0;
  let failCount = 0;
  let processed = 0;
  const t0 = Date.now();

  while (queue.length > 0) {
    const batch = queue.splice(0, concurrency);
    const results = await Promise.allSettled(
      batch.map(async (item) => {
        const [streamData, subsData] = await Promise.all([
          fetchEpStream(item.epId),
          fetchEpSubs(item.epId),
        ]);
        return {
          epId: String(item.epId),
          streamData,
          subsData,
          title: `${item.dramaTitle} ep ${item.epNum}`,
        };
      })
    );

    for (const r of results) {
      processed++;
      if (r.status === 'fulfilled' && r.value) {
        const { epId, streamData, subsData } = r.value;
        if (streamData && streamData.videoUrl && !streamData.videoUrl.includes('tickcounter')) {
          streams[epId] = streamData;
          successCount++;
        } else {
          failCount++;
        }
        if (subsData && subsData.length > 0) {
          subs[epId] = subsData;
        }
      }
    }

    if (processed % 24 === 0 || queue.length === 0) {
      fs.writeFileSync(STREAMS_PATH, JSON.stringify(streams, null, 2), 'utf8');
      fs.writeFileSync(SUBS_PATH, JSON.stringify(subs, null, 2), 'utf8');
      console.log(`[+] تم معالجة ${processed} حلقة (ناجح: ${successCount} | عداد/غير متوفر: ${failCount})`);
    }

    await sleep(100);
  }

  fs.writeFileSync(STREAMS_PATH, JSON.stringify(streams, null, 2), 'utf8');
  fs.writeFileSync(SUBS_PATH, JSON.stringify(subs, null, 2), 'utf8');

  console.log(`\n[✓] اكتمل الحصاد بنجاح! تم حفظ ${successCount} رابط بث وملفات ترجمة في ${((Date.now() - t0) / 1000).toFixed(1)} ثانية.`);
}

run().catch((err) => {
  console.error('[!] خطأ غير متوقع:', err);
});
