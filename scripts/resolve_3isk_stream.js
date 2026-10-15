/**
 * 3isk Video Stream Resolver
 * Resolves any episode or movie page on 3iskk.xyz to its direct HLS master.m3u8 stream.
 */

async function resolve3iskStream(watchPageUrl) {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  
  // Step 1: Fetch the watch page
  const pageRes = await fetch(watchPageUrl, {
    headers: { 'User-Agent': ua, 'Referer': 'https://3iskk.xyz/' }
  });
  const pageHtml = await pageRes.text();

  // Extract watch form: look for action containing 3isk or php
  const allForms = [...pageHtml.matchAll(/<form[^>]+action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/gi)];
  let formAction = '';
  let formHtml = '';
  let newsVal = '';

  for (const f of allForms) {
    const action = f[1];
    const html = f[2];
    const nMatch = html.match(/name="news"\s+value="([^"]+)"/i) || html.match(/value="([^"]+)"\s+name="news"/i);
    if (nMatch) {
      formAction = action;
      formHtml = html;
      newsVal = nMatch[1];
      break;
    }
  }

  // If not found in <form>, search anywhere in pageHtml for hidden input named news
  if (!newsVal) {
    const rawNewsMatch = pageHtml.match(/name="news"\s+value="([^"]+)"/i) || pageHtml.match(/value="([^"]+)"\s+name="news"/i);
    if (rawNewsMatch) {
      newsVal = rawNewsMatch[1];
      const actionMatch = pageHtml.match(/action="(https?:\/\/[^"]*3isk[^"]*\.php)"/i);
      formAction = actionMatch ? actionMatch[1] : 'https://aa.3isk.icu/3isk363525.php';
    }
  }

  if (!newsVal) {
    // Check if direct embed URL is in meta tag
    const embedMeta = pageHtml.match(/itemprop="embedURL"\s+content="([^"]+)"/i);
    if (embedMeta) {
      return {
        success: true,
        embedUrl: embedMeta[1]
      };
    }
    throw new Error('No watch form or news token found on page');
  }

  // Step 2: POST to first validation gate (e.g. aa.3isk.icu/3iskXXXXX.php)
  const body1 = new URLSearchParams();
  body1.append('news', newsVal);
  body1.append('u', '');
  body1.append('submit', 'submit');

  const gate1Res = await fetch(formAction, {
    method: 'POST',
    headers: {
      'User-Agent': ua,
      'Referer': watchPageUrl,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body1.toString()
  });
  const gate1Html = await gate1Res.text();

  // Extract next URL and next token
  const nextUrlMatch = gate1Html.match(/var\s+myUrl\s*=\s*"([^"]+)"/i);
  const nextInputMatch = gate1Html.match(/myInput\.value\s*=\s*"([^"]+)"/i);
  if (!nextUrlMatch || !nextInputMatch) {
    throw new Error('Failed to extract step 2 parameters from gate 1');
  }

  const nextUrl = nextUrlMatch[1];
  const nextVal = nextInputMatch[1];

  // Step 3: POST to gate 2
  const body2 = new URLSearchParams();
  body2.append('news', nextVal);
  body2.append('inputVal', nextVal);
  body2.append('submit', 'submit');

  const gate2Res = await fetch(nextUrl, {
    method: 'POST',
    headers: {
      'User-Agent': ua,
      'Referer': formAction,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body2.toString()
  });
  const gate2Html = await gate2Res.text();

  // Extract iframe src
  const iframeMatch = gate2Html.match(/<iframe[^>]+src="([^"]+)"/i);
  if (!iframeMatch) {
    throw new Error('No embed iframe found in gate 2 response');
  }
  const embedUrl = iframeMatch[1];

  // Step 4: Fetch embed page to get ukrcdn iframe
  const embedRes = await fetch(embedUrl, {
    headers: { 'User-Agent': ua, 'Referer': nextUrl }
  });
  const embedHtml = await embedRes.text();
  const cdnMatch = embedHtml.match(/<iframe[^>]+src="([^"]+ukrcdn[^"]+)"/i);
  if (!cdnMatch) {
    throw new Error('No ukrcdn iframe found in embed page');
  }
  const cdnUrl = cdnMatch[1];

  // Step 5: Fetch ukrcdn player page to extract playback API
  const cdnRes = await fetch(cdnUrl, {
    headers: { 'User-Agent': ua, 'Referer': 'https://3iskk.xyz/' }
  });
  const cdnHtml = await cdnRes.text();
  const playbackMatch = cdnHtml.match(/fetch\("([^"]+playback[^"]+)"/i);
  if (!playbackMatch) {
    throw new Error('No playback API URL found in ukrcdn player');
  }
  const playbackUrl = playbackMatch[1].replace(/\\/g, '');

  // Step 6: Fetch playback API for direct HLS master.m3u8
  const playRes = await fetch(playbackUrl, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': ua,
      'Referer': cdnUrl
    }
  });
  const playJson = await playRes.json();
  if (!playJson || !playJson.url) {
    throw new Error('Playback API did not return master stream URL');
  }

  return {
    success: true,
    streamUrl: playJson.url,
    expires: playJson.expires,
    node: playJson.node_uuid
  };
}

module.exports = { resolve3iskStream };

// If executed directly, run test
if (require.main === module) {
  const testUrl = process.argv[2] || 'https://3iskk.xyz/watch/episodes/serie-evlilik-guzeldir-season-1-episode-6/';
  console.log('Resolving:', testUrl);
  resolve3iskStream(testUrl)
    .then(result => {
      console.log('✅ Resolved successfully:');
      console.log(JSON.stringify(result, null, 2));
    })
    .catch(err => {
      console.error('❌ Resolution error:', err.message);
    });
}
