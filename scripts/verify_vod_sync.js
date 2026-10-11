const path = require('path');
const { topCinemaService } = require(path.join(__dirname, '../apps/api/dist/services/topcinema.service'));
const { fiveTvService } = require(path.join(__dirname, '../apps/api/dist/services/fivetv.service'));
const { vodRepository } = require(path.join(__dirname, '../apps/api/dist/repositories/vod.repository'));

(async () => {
  console.log('--- Testing TopCinema Scraper with Working Server Prioritization ---');
  const tcMovies = await topCinemaService.scrapeMovies(1);
  console.log('TopCinema movies scraped:', tcMovies);

  console.log('\n--- Testing FiveTV Scraper with Working 1080p Embeds ---');
  const ftvMovies = await fiveTvService.scrapeMovies(1);
  console.log('FiveTV movies scraped:', ftvMovies);

  const ftvSeries = await fiveTvService.scrapeSeries(1, 2);
  console.log('FiveTV series scraped:', ftvSeries);

  // Check stats and sample stream URLs
  const stats = await vodRepository.getStats();
  console.log('\n--- Repository Stats ---');
  console.log(stats);

  const { items: sampleMovies } = await vodRepository.listMovies('all', undefined, 5, 0);
  console.log('\nSample Movies:');
  for (const m of sampleMovies) {
    console.log(`- ${m.title} [${m.category}]: ${m.streamUrl}`);
  }

  const { items: sampleSeries } = await vodRepository.listSeries('all', undefined, 3, 0);
  console.log('\nSample Series:');
  for (const s of sampleSeries) {
    const full = await vodRepository.getSeriesWithEpisodes(s.id);
    console.log(`- ${s.title} (${full?.episodes?.length || 0} episodes):`);
    if (full?.episodes && full.episodes.length > 0) {
      console.log(`  Sample Ep 1: ${full.episodes[0].title} -> ${full.episodes[0].streamUrl}`);
    }
  }

  process.exit(0);
})();
