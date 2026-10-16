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

async function getStream(epId) {
  const kkey = kisskhService.generateVideoKKey(epId);

  for (let attempt = 0; attempt < 2; attempt++) {
    for (let i = 0; i < mirrors.length; i++) {
      const domain = mirrors[(mirrorIndex++) % mirrors.length];
      const url = `https://${domain}/api/DramaList/Episode/${epId}.png?kkey=${kkey}`;

      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Dart/3.0 (dart:io)',
            'Accept': '*/*',
          },
          signal: AbortSignal.timeout(4000),
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
    const url = `https://${domain}/api/Sub/${epId}?kkey=${subKey}`;

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Dart/3.0 (dart:io)',
          'Accept': '*/*',
        },
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
        return [];
      }
    } catch {}
  }
  return [];
}

async function run() {
  console.log('=== بدء حاصد مكتبة الدراما والسينما الآسيوية الشاملة (ASPREEN FULL HARVEST) ===');

  const dramas = JSON.parse(fs.readFileSync(DRAMAS_PATH, 'utf8'));
  let streams = {};
  if (fs.existsSync(STREAMS_PATH)) {
    try { streams = JSON.parse(fs.readFileSync(STREAMS_PATH, 'utf8')); } catch {}
  }

  let subs = {};
  if (fs.existsSync(SUBS_PATH)) {
    try { subs = JSON.parse(fs.readFileSync(SUBS_PATH, 'utf8')); } catch {}
  }

  const queue = [];
  for (const [id, d] of Object.entries(dramas)) {
    for (const ep of d.episodes || []) {
      if (!streams[String(ep.id)]) {
        queue.push({
          epId: ep.id,
          dramaId: id,
          title: d.title,
          epNum: ep.number,
          hasSub: (ep.sub || 0) > 0,
        });
      }
    }
  }

  console.log(`إجمالي الحلقات المتبقية للحصاد: ${queue.length} حلقة عبر ${Object.keys(dramas).length} مسلسل وفلم`);

  let added = 0;
  let skipped = 0;
  const t0 = Date.now();

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    const stream = await getStream(item.epId);

    if (stream && stream.videoUrl && !stream.videoUrl.includes('tickcounter')) {
      streams[String(item.epId)] = stream;
      added++;

      if (item.hasSub && !subs[String(item.epId)]) {
        const subList = await getSubs(item.epId);
        if (subList.length > 0) subs[String(item.epId)] = subList;
      }
    } else {
      skipped++;
    }

    if ((i + 1) % 25 === 0 || i === queue.length - 1) {
      fs.writeFileSync(STREAMS_PATH, JSON.stringify(streams, null, 2), 'utf8');
      fs.writeFileSync(SUBS_PATH, JSON.stringify(subs, null, 2), 'utf8');
      const rate = ((i + 1) / ((Date.now() - t0) / 1000)).toFixed(1);
      console.log(`[+] تقدم الحصاد: ${i + 1}/${queue.length} | تم الحفظ: ${added} | غير متوفر: ${skipped} (${rate} حلقة/ثانية)`);
    }

    await sleep(280);
  }

  fs.writeFileSync(STREAMS_PATH, JSON.stringify(streams, null, 2), 'utf8');
  fs.writeFileSync(SUBS_PATH, JSON.stringify(subs, null, 2), 'utf8');
  console.log(`[✓] انتهى الحصاد بنجاح! تم حفظ ${added} حلقة جديدة.`);
}

run().catch((e) => console.error('خطأ غير متوقع:', e));
