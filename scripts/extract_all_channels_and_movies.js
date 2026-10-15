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
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
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

  // 1. Live Categories
  console.log('Fetching live categories...');
  const liveCategories = await fetchJson(`${baseUrl}&action=get_live_categories`);
  const liveCatMap = new Map();
  if (Array.isArray(liveCategories)) {
    for (const c of liveCategories) {
      liveCatMap.set(String(c.category_id), c.category_name);
    }
  }
  console.log(`Loaded ${liveCatMap.size} live categories.`);

  // 2. VOD Categories
  console.log('Fetching VOD (movies) categories...');
  const vodCategories = await fetchJson(`${baseUrl}&action=get_vod_categories`);
  const vodCatMap = new Map();
  if (Array.isArray(vodCategories)) {
    for (const c of vodCategories) {
      vodCatMap.set(String(c.category_id), c.category_name);
    }
  }
  console.log(`Loaded ${vodCatMap.size} VOD categories.`);

  // 3. Live Streams
  console.log('Fetching live streams...');
  const liveStreams = await fetchJson(`${baseUrl}&action=get_live_streams`);
  console.log(`Loaded ${liveStreams.length} live streams.`);

  // 4. VOD Streams
  console.log('Fetching VOD streams (movies)...');
  const vodStreams = await fetchJson(`${baseUrl}&action=get_vod_streams`);
  console.log(`Loaded ${vodStreams.length} VOD streams.`);

  // 5. Series (if any)
  console.log('Checking for series...');
  let seriesList = [];
  try {
    const s = await fetchJson(`${baseUrl}&action=get_series`);
    if (Array.isArray(s)) seriesList = s;
  } catch {}
  console.log(`Loaded ${seriesList.length} series.`);

  // Target paths
  const outWorkspace = path.join(__dirname, '..', 'all_channels_and_movies.m3u');
  const outWorkspaceM3u8 = path.join(__dirname, '..', 'all_channels_and_movies.m3u8');
  const outDesktop = path.join('C:', 'Users', 'Admin', 'Desktop', 'all_channels_and_movies.m3u');
  const outDesktopMain = path.join('C:', 'Users', 'Admin', 'Desktop', 'channels.m3u');

  const streamM3u = fs.createWriteStream(outWorkspace, { encoding: 'utf-8' });
  const streamM3u8 = fs.createWriteStream(outWorkspaceM3u8, { encoding: 'utf-8' });

  streamM3u.write('#EXTM3U\n');
  streamM3u8.write('#EXTM3U\n');

  let totalCount = 0;

  // Write Live Streams
  console.log('Writing Live Channels...');
  for (const s of liveStreams) {
    totalCount++;
    const streamId = s.stream_id;
    const name = (s.name || `Channel ${streamId}`).trim();
    const logo = s.stream_icon || '';
    const epgId = s.epg_channel_id || '';
    const categoryName = liveCatMap.get(String(s.category_id)) || 'Live TV';

    const urlTs = `http://${HOST}:${PORT}/live/${USERNAME}/${PASSWORD}/${streamId}.ts`;
    const urlM3u8 = `http://${HOST}:${PORT}/live/${USERNAME}/${PASSWORD}/${streamId}.m3u8`;

    const extinf = `#EXTINF:-1 tvg-id="${epgId}" tvg-name="${name.replace(/"/g, "'")}" tvg-logo="${logo}" group-title="LIVE | ${categoryName.replace(/"/g, "'")}",${name}\n`;
    streamM3u.write(extinf + urlTs + '\n');
    streamM3u8.write(extinf + urlM3u8 + '\n');
  }

  // Write VOD Streams (Movies)
  console.log('Writing VOD Movies...');
  for (const m of vodStreams) {
    totalCount++;
    const streamId = m.stream_id;
    const name = (m.name || `Movie ${streamId}`).trim();
    const logo = m.stream_icon || '';
    const ext = m.container_extension || 'mp4';
    const categoryName = vodCatMap.get(String(m.category_id)) || 'Movies';

    const urlMovie = `http://${HOST}:${PORT}/movie/${USERNAME}/${PASSWORD}/${streamId}.${ext}`;

    const extinf = `#EXTINF:-1 tvg-id="" tvg-name="${name.replace(/"/g, "'")}" tvg-logo="${logo}" group-title="MOVIES | ${categoryName.replace(/"/g, "'")}",${name}\n`;
    streamM3u.write(extinf + urlMovie + '\n');
    streamM3u8.write(extinf + urlMovie + '\n');
  }

  streamM3u.end();
  streamM3u8.end();

  await new Promise(r => streamM3u.on('finish', r));
  await new Promise(r => streamM3u8.on('finish', r));

  console.log(`Total streams written: ${totalCount}`);
  console.log(`Copying to Desktop...`);
  fs.copyFileSync(outWorkspace, outDesktop);
  fs.copyFileSync(outWorkspace, outDesktopMain);

  const stats = fs.statSync(outWorkspace);
  console.log(`Successfully generated all_channels_and_movies.m3u (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
}

main().catch(err => {
  console.error('Extraction error:', err);
  process.exit(1);
});
