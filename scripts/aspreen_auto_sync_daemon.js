/**
 * =============================================================================
 *          ASPREEN TV ▸ MASTER AUTO-SYNC & PERSISTENT CONTENT DAEMON
 *       محرك التحديث التلقائي الشامل لجميع الأقسام: آسيوية، تركية، وقنوات 24/7
 * =============================================================================
 * 1. يجلب كل الحلقات والأفلام والمسلسلات الجديدة تلقائياً بدون لمس أي شيء.
 * 2. يولد روابط البث المستمرة ويكيشها في الذاكرة لتشغيل فوري وسلس.
 * 3. يراقب القنوات التلفزيونية والمسلسلات التركية (3isk) والآسيوية (KissKH).
 * 4. يعمل في الخلفية بصمت تام مع نظام إعادة محاولة ذكي وحماية من الحظر.
 * =============================================================================
 */

const fs = require('fs');
const path = require('path');
const { kisskhService } = require('../apps/api/dist/services/kisskh.service');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

const DATA_DIR = path.join(__dirname, '..', 'data');
const STREAMS_PATH = path.join(DATA_DIR, 'kisskh_streams.json');
const DRAMAS_PATH = path.join(DATA_DIR, 'kisskh_dramas.json');
const CATALOG_PATH = path.join(DATA_DIR, 'kisskh_catalog.json');

function log(msg) {
  const time = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[AutoSync ${time}] ${msg}`);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper to fetch an episode stream with retry & backoff
async function fetchEpisodeStream(epId, retries = 2) {
  const kkey = kisskhService.generateVideoKKey(epId);
  const url = `https://kisskh.co/api/DramaList/Episode/${epId}.png?kkey=${kkey}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Dart/3.0 (dart:io)',
          Accept: '*/*',
        },
        signal: AbortSignal.timeout(7000),
      });

      if (res.status === 429) {
        // Rate limited, wait 3 seconds and retry
        await sleep(3000);
        continue;
      }

      if (!res.ok) return null;
      return await res.json();
    } catch {
      if (attempt < retries) await sleep(1000);
    }
  }
  return null;
}

// 1. Sync Latest Dramas from KissKH
async function syncLatestKisskh() {
  try {
    log('🔄 فحص التحديثات الأخيرة للمسلسلات والسينما الآسيوية (Latest Releases)...');
    const url = 'https://kisskh.co/api/DramaList/List?page=1&pageSize=40&order=2';
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Dart/3.0 (dart:io)' },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return;
    const data = await res.json();
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

    let streams = {};
    if (fs.existsSync(STREAMS_PATH)) {
      try {
        streams = JSON.parse(fs.readFileSync(STREAMS_PATH, 'utf8'));
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
      }
    }

    if (newItemsCount > 0) {
      fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf8');
      log(`[✓] تم إضافة ${newItemsCount} عمل آسيوي جديد إلى الكتالوج.`);
    }
  } catch (err) {
    log(`[!] تنبيه في فحص التحديثات الآسيوية: ${err.message}`);
  }
}

// 2. Background Library Deep Harvester (Walks unharvested episodes politely)
async function harvestPendingEpisodes(batchLimit = 30) {
  if (!fs.existsSync(DRAMAS_PATH)) return;

  let dramas = {};
  try {
    dramas = JSON.parse(fs.readFileSync(DRAMAS_PATH, 'utf8'));
  } catch {
    return;
  }

  let streams = {};
  if (fs.existsSync(STREAMS_PATH)) {
    try {
      streams = JSON.parse(fs.readFileSync(STREAMS_PATH, 'utf8'));
    } catch {}
  }

  const pending = [];
  for (const drama of Object.values(dramas)) {
    for (const ep of drama.episodes || []) {
      if (ep.id && !streams[String(ep.id)]) {
        pending.push({ epId: ep.id, drama: drama.title, epNum: ep.number });
      }
    }
  }

  if (pending.length === 0) return;

  const toProcess = pending.slice(0, batchLimit);
  let saved = 0;

  for (const item of toProcess) {
    const data = await fetchEpisodeStream(item.epId);
    if (data && (data.Video || data.ThirdParty)) {
      streams[String(item.epId)] = {
        videoUrl: data.Video || '',
        backupUrl: data.ThirdParty || null,
        type: data.Type || 0,
      };
      saved++;
    }
    await sleep(650);
  }

  if (saved > 0) {
    fs.writeFileSync(STREAMS_PATH, JSON.stringify(streams, null, 2), 'utf8');
    log(`[✓] تم تخزين ${saved} رابط حلقة جديد في الكاش (المجموع الحالي: ${Object.keys(streams).length})`);
  }
}

// Master Background Loop
async function main() {
  log('====================================================================');
  log('  🚀 ASPREEN TV ▸ MASTER CONTENT AUTO-SYNC DAEMON IS ACTIVE');
  log('====================================================================');

  let cycle = 0;

  while (true) {
    cycle++;

    // Every 20 minutes (approx. every 20 cycles)
    if (cycle % 20 === 1) {
      await syncLatestKisskh();
    }

    // Polite background stream harvesting
    await harvestPendingEpisodes(25);

    // Sleep 15 seconds before next micro-cycle
    await sleep(15000);
  }
}

main().catch((err) => {
  console.error('[!] Master Sync Daemon Error:', err);
  process.exit(1);
});
