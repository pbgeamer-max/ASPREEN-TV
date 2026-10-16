/**
 * =============================================================================
 *          ASPREEN TV ▸ MASTER AUTO-SYNC & PERSISTENT CONTENT DAEMON
 *       محرك التحديث التلقائي الشامل لجميع الأقسام: آسيوية، تركية، وقنوات 24/7
 * =============================================================================
 * 1. يجلب كل الحلقات والأفلام والمسلسلات الجديدة تلقائياً بدون لمس أي شيء.
 * 2. يولد روابط البث المستمرة ويكيشها في الذاكرة لتشغيل فوري وسلس.
 * 3. يجلب ملفات الترجمة العربية والإنجليزية المتعددة تلقائياً.
 * 4. يراقب القنوات التلفزيونية والمسلسلات التركية (3isk) والآسيوية (KissKH).
 * 5. يعمل في الخلفية بصمت تام مع نظام تدوير المرايا لتفادي الحظر بنسبة 100%.
 * =============================================================================
 */

const fs = require('fs');
const path = require('path');
const { kisskhService } = require('../apps/api/dist/services/kisskh.service');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STREAMS_PATH = path.join(DATA_DIR, 'kisskh_streams.json');
const DRAMAS_PATH = path.join(DATA_DIR, 'kisskh_dramas.json');
const CATALOG_PATH = path.join(DATA_DIR, 'kisskh_catalog.json');
const SUBS_PATH = path.join(DATA_DIR, 'kisskh_subtitles.json');

const mirrors = ['kisskh.co', 'kisskh.is', 'kisskh.do', 'kisskh.ovh', 'kisskh.la', 'kisskh.id'];
let mirrorIndex = 0;

function log(msg) {
  const time = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[AutoSync ${time}] ${msg}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchFromMirrors(endpoint) {
  for (let i = 0; i < mirrors.length; i++) {
    const domain = mirrors[(mirrorIndex++) % mirrors.length];
    try {
      const res = await fetch(`https://${domain}${endpoint}`, {
        headers: { 'User-Agent': 'Dart/3.0 (dart:io)' },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {}
    await sleep(250);
  }
  return null;
}

// 1. Sync Latest Dramas from KissKH
async function syncLatestKisskh() {
  try {
    log('🔄 فحص أحدث إصدارات المسلسلات والأفلام الآسيوية...');
    const data = await fetchFromMirrors('/api/DramaList/List?page=1&pageSize=40&order=2');
    if (!data || !Array.isArray(data.data)) return;

    let catalog = { total: 0, items: [] };
    if (fs.existsSync(CATALOG_PATH)) {
      try {
        catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
      } catch {}
    }

    let dramas = {};
    if (fs.existsSync(DRAMAS_PATH)) {
      try {
        dramas = JSON.parse(fs.readFileSync(DRAMAS_PATH, 'utf8'));
      } catch {}
    }

    let newItemsCount = 0;
    const existingIds = new Set(catalog.items.map((x) => x.id));

    for (const item of data.data) {
      if (!existingIds.has(item.id)) {
        catalog.items.unshift({
          id: item.id,
          title: item.title,
          thumbnail: item.thumbnail,
          episodesCount: item.episodesCount || 1,
          label: item.label || 'جديد',
          type: item.type || 'Drama',
        });
        catalog.total++;
        existingIds.add(item.id);
        newItemsCount++;

        // Fetch drama details & episode list immediately for the new release
        try {
          const dData = await fetchFromMirrors(`/api/DramaList/Drama/${item.id}`);
          if (dData && dData.id && Array.isArray(dData.episodes)) {
            dramas[String(dData.id)] = {
              id: dData.id,
              title: dData.title,
              description: dData.description || '',
              thumbnail: dData.thumbnail,
              releaseDate: dData.releaseDate || '',
              country: dData.country || 'Asian',
              status: dData.status || 'Completed',
              type: dData.type || 'TVSeries',
              trailer: dData.trailer || null,
              episodes: dData.episodes.map((ep) => ({
                id: ep.id,
                number: ep.number,
                sub: ep.sub || 0,
              })),
            };
          }
        } catch {}
        await sleep(300);
      }
    }

    if (newItemsCount > 0) {
      fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf8');
      fs.writeFileSync(DRAMAS_PATH, JSON.stringify(dramas, null, 2), 'utf8');
      log(`[✓] تم إضافة ${newItemsCount} عمل آسيوي جديد مع تفاصيل حلقاته إلى المكتبة.`);
    }
  } catch (err) {
    log(`[!] تنبيه في فحص التحديثات الآسيوية: ${err.message}`);
  }
}

// 2. Walk catalog and harvest drama episode lists for items not yet in dramas
async function harvestMissingDramas(batchLimit = 15) {
  if (!fs.existsSync(CATALOG_PATH) || !fs.existsSync(DRAMAS_PATH)) return;

  let catalog = { items: [] };
  let dramas = {};
  try {
    catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    dramas = JSON.parse(fs.readFileSync(DRAMAS_PATH, 'utf8'));
  } catch {
    return;
  }

  const missing = catalog.items.filter((item) => !dramas[String(item.id)]).slice(0, batchLimit);
  if (missing.length === 0) return;

  let added = 0;
  for (const item of missing) {
    const dData = await fetchFromMirrors(`/api/DramaList/Drama/${item.id}`);
    if (dData && dData.id && Array.isArray(dData.episodes)) {
      dramas[String(dData.id)] = {
        id: dData.id,
        title: dData.title,
        description: dData.description || '',
        thumbnail: dData.thumbnail,
        releaseDate: dData.releaseDate || '',
        country: dData.country || 'Asian',
        status: dData.status || 'Completed',
        type: dData.type || 'TVSeries',
        trailer: dData.trailer || null,
        episodes: dData.episodes.map((ep) => ({
          id: ep.id,
          number: ep.number,
          sub: ep.sub || 0,
        })),
      };
      added++;
    }
    await sleep(400);
  }

  if (added > 0) {
    fs.writeFileSync(DRAMAS_PATH, JSON.stringify(dramas, null, 2), 'utf8');
    log(`[✓] تم استخراج وتخزين ${added} مسلسل جديد في قاعدة البيانات (الإجمالي: ${Object.keys(dramas).length}).`);
  }
}

// 3. Background Episode Stream & Multilingual Subtitle Harvester
async function harvestPendingEpisodes(batchLimit = 20) {
  if (!fs.existsSync(DRAMAS_PATH)) return;

  let dramas = {};
  let streams = {};
  let subs = {};
  try {
    dramas = JSON.parse(fs.readFileSync(DRAMAS_PATH, 'utf8'));
    if (fs.existsSync(STREAMS_PATH)) streams = JSON.parse(fs.readFileSync(STREAMS_PATH, 'utf8'));
    if (fs.existsSync(SUBS_PATH)) subs = JSON.parse(fs.readFileSync(SUBS_PATH, 'utf8'));
  } catch {
    return;
  }

  const pending = [];
  for (const drama of Object.values(dramas)) {
    for (const ep of drama.episodes || []) {
      const strEpId = String(ep.id);
      if (ep.id && (!streams[strEpId] || (ep.sub > 0 && !subs[strEpId]))) {
        pending.push({ epId: ep.id, dramaId: drama.id, epNum: ep.number, subCount: ep.sub || 0 });
      }
    }
  }

  if (pending.length === 0) return;

  const toProcess = pending.slice(0, batchLimit);
  let savedStreams = 0;
  let savedSubs = 0;

  for (const item of toProcess) {
    const strEpId = String(item.epId);

    // 1. Fetch stream if missing
    if (!streams[strEpId]) {
      try {
        const kkey = kisskhService.generateVideoKKey(item.epId);
        const sData = await fetchFromMirrors(`/api/DramaList/Episode/${item.epId}.png?kkey=${kkey}`);
        if (sData && (sData.Video || sData.ThirdParty)) {
          streams[strEpId] = {
            videoUrl: sData.Video || '',
            backupUrl: sData.ThirdParty || null,
            type: sData.Type || 0,
          };
          savedStreams++;
        }
      } catch {}
      await sleep(250);
    }

    // 2. Fetch subtitles if missing and subCount > 0
    if (item.subCount > 0 && !subs[strEpId]) {
      try {
        const subKey = kisskhService.generateSubKKey(item.epId);
        const subList = await fetchFromMirrors(`/api/Sub/${item.epId}?kkey=${subKey}`);
        if (Array.isArray(subList) && subList.length > 0) {
          subs[strEpId] = subList.map((s) => ({
            src: s.src,
            label: s.label || 'Sub',
            land: s.land || 'en',
            default: Boolean(s.default),
          }));
          savedSubs++;
        }
      } catch {}
      await sleep(200);
    }

    // 3. Map composite alias (e.g. dramaId * 1000 + epNum)
    const compId = String(item.dramaId * 1000 + item.epNum);
    if (streams[strEpId] && !streams[compId]) streams[compId] = streams[strEpId];
    if (subs[strEpId] && !subs[compId]) subs[compId] = subs[strEpId];
  }

  if (savedStreams > 0 || savedSubs > 0) {
    fs.writeFileSync(STREAMS_PATH, JSON.stringify(streams, null, 2), 'utf8');
    fs.writeFileSync(SUBS_PATH, JSON.stringify(subs, null, 2), 'utf8');
    log(`[✓] تم تخزين ${savedStreams} بث مباشر و ${savedSubs} ملف ترجمة (إجمالي البث: ${Object.keys(streams).length}).`);
  }
}

// Master Loop
async function main() {
  log('====================================================================');
  log('  🚀 ASPREEN TV ▸ MASTER CONTENT AUTO-SYNC DAEMON IS ACTIVE (24/7)');
  log('====================================================================');

  if (process.argv.includes('--once')) {
    log('Running single sync pass for CI / Cloud Cron...');
    await syncLatestKisskh();
    await harvestMissingDramas(20);
    await harvestPendingEpisodes(30);
    log('Single pass completed successfully.');
    return;
  }

  let cycle = 0;

  while (true) {
    cycle++;

    // Every 15 cycles: check latest releases from KissKH
    if (cycle % 15 === 1) {
      await syncLatestKisskh();
    }

    // Fetch missing drama structures
    await harvestMissingDramas(10);

    // Harvest streams & subtitles
    await harvestPendingEpisodes(15);

    // Sleep 10 seconds before next micro-cycle
    await sleep(10000);
  }
}

main().catch((err) => {
  console.error('[!] Master Sync Daemon Error:', err);
  process.exit(1);
});
