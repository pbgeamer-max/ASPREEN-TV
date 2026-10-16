/**
 * Harvests drama details, real episode lists, direct streams, and subtitles
 * for all top popular Asian dramas and movies.
 */

const fs = require('fs');
const path = require('path');
const { kisskhService } = require('../apps/api/dist/services/kisskh.service');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CATALOG_PATH = path.join(DATA_DIR, 'kisskh_catalog.json');
const DRAMAS_PATH = path.join(DATA_DIR, 'kisskh_dramas.json');
const STREAMS_PATH = path.join(DATA_DIR, 'kisskh_streams.json');
const SUBS_PATH = path.join(DATA_DIR, 'kisskh_subtitles.json');

const mirrors = ['kisskh.co', 'kisskh.is', 'kisskh.do', 'kisskh.ovh', 'kisskh.la', 'kisskh.id'];
let mirrorIdx = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchFromAnyMirror(endpoint) {
  for (let i = 0; i < mirrors.length; i++) {
    const domain = mirrors[(mirrorIdx++) % mirrors.length];
    try {
      const res = await fetch(`https://${domain}${endpoint}`, {
        headers: { 'User-Agent': 'Dart/3.0 (dart:io)' },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {}
    await sleep(200);
  }
  return null;
}

async function run() {
  console.log('🚀 Starting Top Asian Dramas & Movies Harvester...');

  const cat = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const dramas = JSON.parse(fs.readFileSync(DRAMAS_PATH, 'utf8'));
  const streams = JSON.parse(fs.readFileSync(STREAMS_PATH, 'utf8'));
  const subs = JSON.parse(fs.readFileSync(SUBS_PATH, 'utf8'));

  console.log(`Current stats: ${Object.keys(dramas).length} dramas, ${Object.keys(streams).length} streams, ${Object.keys(subs).length} subtitles.`);

  // 1. Explicitly ensure My Love From the Star (954 and 45) is 100% complete
  console.log('Synchronizing drama 954 and 45 (My Love From the Star)...');
  const d954 = await fetchFromAnyMirror('/api/DramaList/Drama/954');
  if (d954 && d954.episodes) {
    dramas['954'] = {
      id: 954,
      title: d954.title,
      description: d954.description || '',
      thumbnail: d954.thumbnail,
      releaseDate: d954.releaseDate || '2013',
      country: d954.country || 'South Korea',
      status: d954.status || 'Completed',
      type: d954.type || 'TVSeries',
      trailer: d954.trailer || null,
      episodes: d954.episodes.map((ep) => ({
        id: ep.id,
        number: ep.number,
        sub: ep.sub || 0,
      })),
    };
    // Also mirror to 45
    dramas['45'] = { ...dramas['954'], id: 45 };
    console.log(`[✓] Drama 954 & 45 synchronized with ${d954.episodes.length} episodes.`);
  }

  // 2. Target priority dramas: top catalog items + famous titles
  const targetIds = [
    954, 45, 29, 25, 26, 27, 28, 30, 39, 40, 41, 42, 44, 96, 97, 98, 99, 100,
    112, 113, 114, 115, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128,
    149, 150, 152, 153, 154, 155, 156, 157, 160, 161, 162, 163, 164, 165,
    ...cat.items.slice(0, 150).map((i) => i.id),
  ];

  const uniqueTargetIds = Array.from(new Set(targetIds));
  console.log(`Processing ${uniqueTargetIds.length} priority dramas...`);

  let dramaCount = 0;
  for (const id of uniqueTargetIds) {
    if (!dramas[String(id)]) {
      const data = await fetchFromAnyMirror(`/api/DramaList/Drama/${id}`);
      if (data && data.id && Array.isArray(data.episodes)) {
        dramas[String(data.id)] = {
          id: data.id,
          title: data.title,
          description: data.description || '',
          thumbnail: data.thumbnail,
          releaseDate: data.releaseDate || '',
          country: data.country || 'Asian',
          status: data.status || 'Completed',
          type: data.type || 'TVSeries',
          trailer: data.trailer || null,
          episodes: data.episodes.map((ep) => ({
            id: ep.id,
            number: ep.number,
            sub: ep.sub || 0,
          })),
        };
        dramaCount++;
        process.stdout.write(`+D[${data.title.substring(0, 15)}] `);
      }
      await sleep(350);
    }
  }

  console.log(`\n[✓] Harvested ${dramaCount} new drama details.`);
  // Flush dramas immediately to disk
  fs.writeFileSync(DRAMAS_PATH, JSON.stringify(dramas, null, 2), 'utf8');
  console.log(`[✓] Successfully saved ${Object.keys(dramas).length} dramas to ${DRAMAS_PATH}`);

  // 3. For each drama, harvest streams and subtitles for episodes that need them
  let streamCount = 0;
  let subCount = 0;
  let processedEps = 0;

  for (const drama of Object.values(dramas)) {
    if (!drama.episodes) continue;
    for (const ep of drama.episodes) {
      processedEps++;
      const strEpId = String(ep.id);

      // Check stream
      if (!streams[strEpId]) {
        try {
          const kkey = kisskhService.generateVideoKKey(ep.id);
          const sData = await fetchFromAnyMirror(`/api/DramaList/Episode/${ep.id}.png?kkey=${kkey}`);
          if (sData && (sData.Video || sData.ThirdParty)) {
            streams[strEpId] = {
              videoUrl: sData.Video || '',
              backupUrl: sData.ThirdParty || null,
              type: sData.Type || 0,
            };
            streamCount++;
          }
        } catch {}
        await sleep(250);
      }

      // Check subtitles if episode has sub > 0 and not cached
      if (ep.sub > 0 && !subs[strEpId]) {
        try {
          const subKey = kisskhService.generateSubKKey(ep.id);
          const subList = await fetchFromAnyMirror(`/api/Sub/${ep.id}?kkey=${subKey}`);
          if (Array.isArray(subList) && subList.length > 0) {
            subs[strEpId] = subList.map((item) => ({
              src: item.src,
              label: item.label || 'Sub',
              land: item.land || 'en',
              default: Boolean(item.default),
            }));
            subCount++;
          }
        } catch {}
        await sleep(200);
      }

      // Also map composite aliases (e.g. drama.id * 1000 + ep.number)
      const compId = String(drama.id * 1000 + ep.number);
      if (streams[strEpId] && !streams[compId]) {
        streams[compId] = streams[strEpId];
      }
      if (subs[strEpId] && !subs[compId]) {
        subs[compId] = subs[strEpId];
      }

      // Save every 25 episodes
      if (processedEps % 25 === 0) {
        fs.writeFileSync(STREAMS_PATH, JSON.stringify(streams, null, 2), 'utf8');
        fs.writeFileSync(SUBS_PATH, JSON.stringify(subs, null, 2), 'utf8');
      }
    }
  }

  // Save all updated files
  fs.writeFileSync(DRAMAS_PATH, JSON.stringify(dramas, null, 2), 'utf8');
  fs.writeFileSync(STREAMS_PATH, JSON.stringify(streams, null, 2), 'utf8');
  fs.writeFileSync(SUBS_PATH, JSON.stringify(subs, null, 2), 'utf8');

  console.log('\n====================================================================');
  console.log(`🎉 HARVEST COMPLETE!`);
  console.log(`Total Dramas: ${Object.keys(dramas).length} (+${dramaCount})`);
  console.log(`Total Streams: ${Object.keys(streams).length} (+${streamCount})`);
  console.log(`Total Subtitles: ${Object.keys(subs).length} (+${subCount})`);
  console.log('====================================================================');
}

run().catch(console.error);
