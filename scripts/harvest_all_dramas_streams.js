const fs = require('fs');
const path = require('path');
const { kisskhService } = require('../apps/api/dist/services/kisskh.service');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

async function fetchEpWithRetry(epId, retries = 2) {
  const kkey = kisskhService.generateVideoKKey(epId);
  const url = `https://kisskh.co/api/DramaList/Episode/${epId}.png?kkey=${kkey}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Referer: 'https://kisskh.co/',
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(7000),
      });

      if (res.status === 429) {
        // Rate limited, wait 3 seconds and retry
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      if (!res.ok) {
        return null;
      }

      const json = await res.json();
      return json;
    } catch {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }
  return null;
}

async function main() {
  const dramasPath = path.join(__dirname, '..', 'data', 'kisskh_dramas.json');
  const dramas = JSON.parse(fs.readFileSync(dramasPath, 'utf8'));
  const streamsPath = path.join(__dirname, '..', 'data', 'kisskh_streams.json');
  let streams = {};
  if (fs.existsSync(streamsPath)) {
    try {
      streams = JSON.parse(fs.readFileSync(streamsPath, 'utf8'));
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

  console.log(`Starting polite harvest for ${pending.length} pending episodes...`);
  let savedCount = 0;

  for (let i = 0; i < pending.length; i++) {
    const item = pending[i];
    const data = await fetchEpWithRetry(item.epId);

    if (data && (data.Video || data.ThirdParty)) {
      streams[String(item.epId)] = {
        videoUrl: data.Video || '',
        backupUrl: data.ThirdParty || null,
        type: data.Type || 0,
      };
      savedCount++;

      if (savedCount % 10 === 0) {
        fs.writeFileSync(streamsPath, JSON.stringify(streams, null, 2), 'utf8');
      }
    }

    process.stdout.write(`\r[${i + 1}/${pending.length}] Drama: "${item.drama.substring(0, 20)}" Ep ${item.epNum} (Saved: ${savedCount})`);
    await new Promise((r) => setTimeout(r, 550));
  }

  fs.writeFileSync(streamsPath, JSON.stringify(streams, null, 2), 'utf8');
  console.log(`\n[✓] Done! Total streams now: ${Object.keys(streams).length}`);
}

main().catch(console.error);
