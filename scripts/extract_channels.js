const http = require('http');
const fs = require('fs');
const path = require('path');

const USERNAME = 'AX02AV5XXDR2U2T';
const PASSWORD = 'vgbghaS6N5';
const HOST = '13569-cdn8.ovh';
const PORT = 80;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers: { 'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18' } }, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf-8');
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Connecting to IPTV server...');
  const baseUrl = `http://${HOST}:${PORT}/player_api.php?username=${USERNAME}&password=${PASSWORD}`;

  console.log('Fetching live categories...');
  const categories = await fetchJson(`${baseUrl}&action=get_live_categories`);
  const categoryMap = new Map();
  if (Array.isArray(categories)) {
    for (const cat of categories) {
      categoryMap.set(String(cat.category_id), cat.category_name);
    }
  }
  console.log(`Loaded ${categoryMap.size} categories.`);

  console.log('Fetching live streams...');
  const streams = await fetchJson(`${baseUrl}&action=get_live_streams`);
  console.log(`Loaded ${streams.length} live streams.`);

  // Prepare M3U file
  const outPathM3u = path.join(__dirname, '..', 'channels.m3u');
  const outPathM3u8 = path.join(__dirname, '..', 'channels.m3u8');
  const outPathJson = path.join(__dirname, '..', 'channels.json');

  const linesM3u = ['#EXTM3U'];
  const linesM3u8 = ['#EXTM3U'];
  const structuredList = [];

  for (const s of streams) {
    const streamId = s.stream_id;
    const name = (s.name || `Channel ${streamId}`).trim();
    const logo = s.stream_icon || '';
    const epgId = s.epg_channel_id || '';
    const categoryName = categoryMap.get(String(s.category_id)) || 'General';

    const urlTs = `http://${HOST}:${PORT}/live/${USERNAME}/${PASSWORD}/${streamId}.ts`;
    const urlM3u8 = `http://${HOST}:${PORT}/live/${USERNAME}/${PASSWORD}/${streamId}.m3u8`;

    // Standard Extended M3U format
    linesM3u.push(
      `#EXTINF:-1 tvg-id="${epgId}" tvg-name="${name.replace(/"/g, "'")}" tvg-logo="${logo}" group-title="${categoryName.replace(/"/g, "'")}",${name}`
    );
    linesM3u.push(urlTs);

    linesM3u8.push(
      `#EXTINF:-1 tvg-id="${epgId}" tvg-name="${name.replace(/"/g, "'")}" tvg-logo="${logo}" group-title="${categoryName.replace(/"/g, "'")}",${name}`
    );
    linesM3u8.push(urlM3u8);

    structuredList.push({
      stream_id: streamId,
      name,
      category: categoryName,
      category_id: s.category_id,
      logo,
      epg_id: epgId,
      url_ts: urlTs,
      url_m3u8: urlM3u8
    });
  }

  console.log(`Writing channels.m3u (${linesM3u.length / 2} channels)...`);
  fs.writeFileSync(outPathM3u, linesM3u.join('\n'), 'utf-8');

  console.log(`Writing channels.m3u8 (${linesM3u8.length / 2} channels)...`);
  fs.writeFileSync(outPathM3u8, linesM3u8.join('\n'), 'utf-8');

  console.log(`Writing channels.json (${structuredList.length} channels)...`);
  fs.writeFileSync(outPathJson, JSON.stringify(structuredList, null, 2), 'utf-8');

  console.log('Done! Files created successfully:');
  console.log('- channels.m3u:', fs.statSync(outPathM3u).size, 'bytes');
  console.log('- channels.m3u8:', fs.statSync(outPathM3u8).size, 'bytes');
  console.log('- channels.json:', fs.statSync(outPathJson).size, 'bytes');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
