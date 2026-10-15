const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

async function harvestMovies() {
  console.log('--- جلب الأفلام من قصة عشق ---');
  const movies = [];
  // Harvest page 1 and page 2
  for (let page = 1; page <= 2; page++) {
    const pageUrl = page === 1 ? 'https://3iskk.xyz/w-mvs/' : `https://3iskk.xyz/w-mvs/page/${page}/`;
    try {
      const html = await fetchHtml(pageUrl);
      const linkMatches = [...html.matchAll(/<a href="(https:\/\/3iskk\.xyz\/watch\/movies\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
      for (const m of linkMatches) {
        const url = m[1];
        const inner = m[2];
        const titleMatch = inner.match(/<div class="item_title">([^<]+)<\/div>/);
        const imgMatch = inner.match(/data-image="([^"]+)"/) || inner.match(/data-src="([^"]+)"/) || inner.match(/src="([^"]+)"/);
        if (titleMatch) {
          const title = titleMatch[1].trim();
          const poster = imgMatch ? imgMatch[1] : '';
          const slug = url.split('/').filter(Boolean).pop();
          movies.push({
            id: slug,
            title,
            type: 'MOVIE',
            category: title.includes('مدبلج') ? 'أفلام مدبلجة' : 'أفلام مترجمة',
            poster: poster.includes('dt_poster') ? '' : poster,
            watchUrl: url,
            description: `مشاهدة وتحميل ${title} بجودة عالية على منصة قصة عشق.`,
          });
        }
      }
    } catch (e) {
      console.error(`Error page ${page}:`, e.message);
    }
  }

  // Deduplicate
  const uniqueMovies = Array.from(new Map(movies.map(m => [m.id, m])).values());
  console.log(`[✓] تم استخراج ${uniqueMovies.length} فيلماً بنجاح.`);
  return uniqueMovies;
}

async function harvestSeries() {
  console.log('--- جلب المسلسلات من قصة عشق ---');
  const seriesList = [];
  for (let page = 1; page <= 2; page++) {
    const pageUrl = page === 1 ? 'https://3iskk.xyz/w-srs/' : `https://3iskk.xyz/w-srs/page/${page}/`;
    try {
      const html = await fetchHtml(pageUrl);
      const linkMatches = [...html.matchAll(/<a href="(https:\/\/3iskk\.xyz\/watch\/(?:tvshows|series)\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
      for (const m of linkMatches) {
        const url = m[1];
        const inner = m[2];
        const titleMatch = inner.match(/<div class="item_title">([^<]+)<\/div>/);
        const imgMatch = inner.match(/data-image="([^"]+)"/) || inner.match(/data-src="([^"]+)"/) || inner.match(/src="([^"]+)"/);
        if (titleMatch) {
          const title = titleMatch[1].trim();
          const poster = imgMatch ? imgMatch[1] : '';
          const slug = url.split('/').filter(Boolean).pop();
          seriesList.push({
            id: slug,
            title,
            type: 'SERIES',
            category: title.includes('مدبلج') ? 'مسلسلات مدبلجة' : 'مسلسلات مترجمة',
            poster: poster.includes('dt_poster') ? '' : poster,
            seriesUrl: url,
            description: `مسلسل ${title} - شاهد أحدث الحلقات مترجمة ومدبلجة بجودة عالية على قصة عشق.`,
            episodes: [],
          });
        }
      }
    } catch (e) {
      console.error(`Error page ${page}:`, e.message);
    }
  }

  const uniqueSeries = Array.from(new Map(seriesList.map(s => [s.id, s])).values());
  console.log(`[✓] تم استخراج ${uniqueSeries.length} مسلسلاً.`);

  // For the first 15 series, fetch their episode list and description
  console.log('جلب تفاصيل الحلقات والوصف للمسلسلات الأولى...');
  for (let i = 0; i < Math.min(uniqueSeries.length, 15); i++) {
    const s = uniqueSeries[i];
    try {
      const sHtml = await fetchHtml(s.seriesUrl);
      
      // Extract real description
      const descMatch = sHtml.match(/<div class="description"[^>]*>([\s\S]*?)<\/div>/i) || sHtml.match(/<meta name="description" content="([^"]+)"/i);
      if (descMatch) {
        s.description = descMatch[1].replace(/<[^>]+>/g, '').trim();
      }

      // Extract real poster if empty
      const posterMatch = sHtml.match(/<meta property="og:image" content="([^"]+)"/i);
      if (posterMatch && !s.poster) {
        s.poster = posterMatch[1];
      }

      // Extract episodes (supporting single and double quotes)
      const epLinks = [...sHtml.matchAll(/<a[^>]*href=['"](https:\/\/3iskk\.xyz\/watch\/episodes\/[^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi)];
      const eps = [];
      for (const ep of epLinks) {
        const epUrl = ep[1];
        const epInner = ep[2].replace(/<[^>]+>/g, '').trim();
        const epNumMatch = epUrl.match(/episode-(\d+)/i) || epInner.match(/(\d+)/);
        const epNum = epNumMatch ? parseInt(epNumMatch[1], 10) : (eps.length + 1);
        eps.push({
          episodeNumber: epNum,
          title: `الحلقة ${epNum}`,
          watchUrl: epUrl,
        });
      }
      
      // Sort episodes ascending
      eps.sort((a, b) => a.episodeNumber - b.episodeNumber);
      s.episodes = eps;
      console.log(`  ✓ ${s.title}: تم العثور على ${eps.length} حلقة.`);
    } catch (err) {
      console.error(`  ✕ ${s.title}: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  return uniqueSeries;
}

async function main() {
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const [movies, series] = await Promise.all([
    harvestMovies(),
    harvestSeries(),
  ]);

  const catalog = {
    updatedAt: new Date().toISOString(),
    source: '3iskk.xyz',
    total_series: series.length,
    total_movies: movies.length,
    series,
    movies,
  };

  const outPath = path.join(dataDir, '3isk_catalog.json');
  fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2), 'utf8');
  console.log(`\n🎉 تم حفظ الكتالوج بنجاح في: ${outPath}`);
  console.log(`إجمالي المسلسلات: ${series.length} | إجمالي الأفلام: ${movies.length}`);
}

main().catch(console.error);
