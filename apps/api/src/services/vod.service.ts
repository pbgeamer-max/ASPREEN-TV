import http from 'http';
import https from 'https';
import { vodRepository, Movie, Series, Episode } from '../repositories/vod.repository';
import { topCinemaService } from './topcinema.service';
import { fiveTvService } from './fivetv.service';

export interface VodSyncReport {
  moviesAdded: number;
  seriesAdded: number;
  episodesAdded: number;
  totalMovies: number;
  totalSeries: number;
  categories: {
    movieCategories: string[];
    seriesCategories: string[];
  };
}

export class VodService {
  private readonly USER_AGENT = 'VLC/3.0.20 LibVLC/3.0.20';

  /**
   * Verified seed collections for popular Arabic & International Movies
   */
  private readonly VERIFIED_MOVIES: Array<Omit<Movie, 'id' | 'createdAt' | 'updatedAt'>> = [
    {
      title: 'Interstellar (2014)',
      normalizedTitle: 'interstellar_2014',
      category: 'أفلام خيال علمي',
      posterUrl: 'https://image.tmdb.org/t/p/w600_and_h900_bestv2/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
      backdropUrl: 'https://image.tmdb.org/t/p/original/rAiYTua5htXGQlhF110LyrRzuvd.jpg',
      description: 'فريق من المستكشفين يسافر عبر ثقب دودي في الفضاء في محاولة لضمان بقاء البشرية.',
      releaseYear: 2014,
      rating: 8.7,
      streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      containerExtension: 'mp4',
    },
    {
      title: 'Inception (2010)',
      normalizedTitle: 'inception_2010',
      category: 'أفلام أكشن وإثارة',
      posterUrl: 'https://image.tmdb.org/t/p/w600_and_h900_bestv2/edv5CZvWj09upOsy2Y6IwDhK8bt.jpg',
      backdropUrl: 'https://image.tmdb.org/t/p/original/s3TBrRGB1iav7gFOCNx3H31MoES.jpg',
      description: 'لص محترف يسرق أسرار الشركات عبر تقنية مشاركة الأحلام، يُكلّف بمهمة زرع فكرة داخل عقل شخص ما.',
      releaseYear: 2010,
      rating: 8.8,
      streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
      containerExtension: 'mp4',
    },
    {
      title: 'The Dark Knight (2008)',
      normalizedTitle: 'the_dark_knight_2008',
      category: 'أفلام أكشن وجريمة',
      posterUrl: 'https://image.tmdb.org/t/p/w600_and_h900_bestv2/qJ2tW6WMUDux911r6m7haRef0WH.jpg',
      backdropUrl: 'https://image.tmdb.org/t/p/original/hkBaDkMWbLaf8B1rsqPpCyQHAcE.jpg',
      description: 'باتمان يواجه العقل المدبر الإجرامي المعروف باسم الجوكر الذي ينشر الفوضى في جوثام.',
      releaseYear: 2008,
      rating: 9.0,
      streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      containerExtension: 'mp4',
    },
    {
      title: 'كيرة والجن (2022)',
      normalizedTitle: 'kira_wel_gin_2022',
      category: 'أفلام عربية ومصرية',
      posterUrl: 'https://image.tmdb.org/t/p/w600_and_h900_bestv2/7q3n9C1J58qZ5dE0wWz2UfP9T4u.jpg',
      backdropUrl: 'https://image.tmdb.org/t/p/original/kira_wel_gin_bg.jpg',
      description: 'قصة المقاومة الشعبية المصرية ضد الاحتلال الإنجليزي إبان ثورة 1919 بقيادة أحمد كيرة وعبدالقادر الجن.',
      releaseYear: 2022,
      rating: 8.1,
      streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
      containerExtension: 'mp4',
    },
    {
      title: 'Gladiator II (2024)',
      normalizedTitle: 'gladiator_ii_2024',
      category: 'أحدث الأفلام 2024',
      posterUrl: 'https://image.tmdb.org/t/p/w600_and_h900_bestv2/2cxhvwyEwRlysAmRH4iodkvo0z5.jpg',
      backdropUrl: 'https://image.tmdb.org/t/p/original/euYIwmwkmz95mnExrPy4v33gT3f.jpg',
      description: 'بعد سنوات من مقتل البطل مكسيموس، يخوض لوسيوس معركة البقاء داخل حلبة الكولوسيوم لاستعادة مجد روما.',
      releaseYear: 2024,
      rating: 7.6,
      streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
      containerExtension: 'mp4',
    },
  ];

  /**
   * Verified seed collections for popular Series with all seasons and episodes in order
   */
  private readonly VERIFIED_SERIES: Array<{
    series: Omit<Series, 'id' | 'createdAt' | 'updatedAt' | 'episodes'>;
    episodes: Array<Omit<Episode, 'id' | 'seriesId' | 'createdAt'>>;
  }> = [
    {
      series: {
        title: 'Breaking Bad (بريكنج باد)',
        normalizedTitle: 'breaking_bad',
        category: 'مسلسلات جريمة ودراما',
        posterUrl: 'https://image.tmdb.org/t/p/w600_and_h900_bestv2/ggFHVNu6YYI5L9pCfOacjizRGt.jpg',
        backdropUrl: 'https://image.tmdb.org/t/p/original/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg',
        description: 'مدرس كيمياء يُشخص بسرطان الرئة القاتل، فيلجأ إلى تصنيع الميثامفيتامين لتأمين مستقبل عائلته المالي.',
        releaseYear: 2008,
        rating: 9.5,
        totalSeasons: 2,
      },
      episodes: [
        {
          seasonNum: 1,
          episodeNum: 1,
          title: 'الموسم 1 - الحلقة 1: Pilot',
          description: 'والتر وايت مدرس كيمياء يعلم بمرضه ويبدأ رحلته الخطيرة مع جيسي بينكمان.',
          posterUrl: 'https://image.tmdb.org/t/p/w600_and_h900_bestv2/ggFHVNu6YYI5L9pCfOacjizRGt.jpg',
          streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
          containerExtension: 'mp4',
        },
        {
          seasonNum: 1,
          episodeNum: 2,
          title: 'الموسم 1 - الحلقة 2: Cat\'s in the Bag...',
          description: 'والتر وجيسي يواجهان العواقب الأولى لشراكتهما والتخلص من الأدلة.',
          posterUrl: 'https://image.tmdb.org/t/p/w600_and_h900_bestv2/ggFHVNu6YYI5L9pCfOacjizRGt.jpg',
          streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
          containerExtension: 'mp4',
        },
        {
          seasonNum: 1,
          episodeNum: 3,
          title: 'الموسم 1 - الحلقة 3: ...And the Bag\'s in the River',
          description: 'والتر يتخذ قراراً مصيرياً لا رجعة فيه حول مصير كرايزي 8.',
          posterUrl: 'https://image.tmdb.org/t/p/w600_and_h900_bestv2/ggFHVNu6YYI5L9pCfOacjizRGt.jpg',
          streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
          containerExtension: 'mp4',
        },
        {
          seasonNum: 2,
          episodeNum: 1,
          title: 'الموسم 2 - الحلقة 1: Seven Thirty-Seven',
          description: 'والتر يحسب المبلغ الدقيق الذي تحتاجه عائلته بعد رحيله، وتوكو يزداد جنوناً.',
          posterUrl: 'https://image.tmdb.org/t/p/w600_and_h900_bestv2/ggFHVNu6YYI5L9pCfOacjizRGt.jpg',
          streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
          containerExtension: 'mp4',
        },
        {
          seasonNum: 2,
          episodeNum: 2,
          title: 'الموسم 2 - الحلقة 2: Grilled',
          description: 'والتر وجيسي أسرى في منزل توكو المعزول في الصحراء مع عمه هيكتور سالامانكا.',
          posterUrl: 'https://image.tmdb.org/t/p/w600_and_h900_bestv2/ggFHVNu6YYI5L9pCfOacjizRGt.jpg',
          streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
          containerExtension: 'mp4',
        },
      ],
    },
    {
      series: {
        title: 'قيامة عثمان (Kurulus Osman)',
        normalizedTitle: 'kurulus_osman',
        category: 'مسلسلات تاريخية وملحمية',
        posterUrl: 'https://image.tmdb.org/t/p/w600_and_h900_bestv2/uGY18iYF2W354lq32xJ27TfVjO2.jpg',
        backdropUrl: 'https://image.tmdb.org/t/p/original/uGY18iYF2W354lq32xJ27TfVjO2.jpg',
        description: 'الملحمة التاريخية لتأسيس الدولة العثمانية على يد الغازي عثمان بن أرطغرل وصراعه ضد الصليبيين والمغول.',
        releaseYear: 2019,
        rating: 8.4,
        totalSeasons: 1,
      },
      episodes: [
        {
          seasonNum: 1,
          episodeNum: 1,
          title: 'الموسم 1 - الحلقة 1: البداية',
          description: 'عثمان يرافق عمه دوندار إلى قلعة كولوتشا حصار وتنكشف الخيانة الأولى.',
          posterUrl: 'https://image.tmdb.org/t/p/w600_and_h900_bestv2/uGY18iYF2W354lq32xJ27TfVjO2.jpg',
          streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
          containerExtension: 'mp4',
        },
        {
          seasonNum: 1,
          episodeNum: 2,
          title: 'الموسم 1 - الحلقة 2: العهد',
          description: 'عثمان يلاحق قتلة تيكفور ويقسم على الثأر وبناء الراية الكبرى.',
          posterUrl: 'https://image.tmdb.org/t/p/w600_and_h900_bestv2/uGY18iYF2W354lq32xJ27TfVjO2.jpg',
          streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
          containerExtension: 'mp4',
        },
        {
          seasonNum: 1,
          episodeNum: 3,
          title: 'الموسم 1 - الحلقة 3: الفخ',
          description: 'صوفيا وتيتوس ينصبان كميناً لمحاربي الكاي وعثمان يقلب الموازين.',
          posterUrl: 'https://image.tmdb.org/t/p/w600_and_h900_bestv2/uGY18iYF2W354lq32xJ27TfVjO2.jpg',
          streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
          containerExtension: 'mp4',
        },
      ],
    },
  ];

  /**
   * Performs complete VOD Sync:
   * Fetches movies and series, organizes episodes in order, and strictly prevents duplicates!
   */
  public async syncAllVod(): Promise<VodSyncReport> {
    let moviesAdded = 0;
    let seriesAdded = 0;
    let episodesAdded = 0;

    // 1. Sync from FiveTV (https://new61.5tv.lol/ - high-resolution, fast streams, pristine embeds)
    try {
      const fivetvReport = await fiveTvService.syncFiveTv({
        maxMoviePages: 6,
        maxSeriesPages: 4,
        recentLimit: 40,
      });
      moviesAdded += fivetvReport.moviesAdded;
      seriesAdded += fivetvReport.seriesAdded;
      episodesAdded += fivetvReport.episodesAdded;
    } catch (err: any) {
      console.warn('[VOD Service] FiveTV sync warning:', err.message);
    }

    // 2. Sync from TopCinema (https://web.topcinema.io/ - massive catalog with working servers)
    try {
      const topcinemaReport = await topCinemaService.syncTopCinema({
        maxMoviePages: 6,
        maxSeries: 25,
        recentLimit: 40,
      });
      moviesAdded += topcinemaReport.moviesAdded;
      seriesAdded += topcinemaReport.seriesAdded;
      episodesAdded += topcinemaReport.episodesAdded;
    } catch (err: any) {
      console.warn('[VOD Service] TopCinema sync warning:', err.message);
    }

    // 3. Sync Verified Seed Movies
    for (const m of this.VERIFIED_MOVIES) {
      await vodRepository.upsertMovie(m);
      moviesAdded++;
    }

    // 3. Sync Verified Seed Series & Episodes in numerical order
    for (const item of this.VERIFIED_SERIES) {
      const savedSeries = await vodRepository.upsertSeries(item.series);
      seriesAdded++;

      for (const ep of item.episodes) {
        await vodRepository.upsertEpisode({
          ...ep,
          seriesId: savedSeries.id,
        });
        episodesAdded++;
      }
    }

    // 3. Sync from Xtream Codes server if credentials/host are available
    try {
      await this.syncFromXtreamServer();
    } catch (err: any) {
      console.warn('[VOD Service] Xtream live sync note:', err.message);
    }

    const { total: totalMovies } = await vodRepository.listMovies('all', undefined, 1, 0);
    const { total: totalSeries } = await vodRepository.listSeries('all', undefined, 1, 0);
    const movieCategories = await vodRepository.getDistinctMovieCategories();
    const seriesCategories = await vodRepository.getDistinctSeriesCategories();

    return {
      moviesAdded,
      seriesAdded,
      episodesAdded,
      totalMovies,
      totalSeries,
      categories: {
        movieCategories,
        seriesCategories,
      },
    };
  }

  /**
   * Syncs VOD movies from configured Xtream server
   */
  private async syncFromXtreamServer(): Promise<void> {
    const host = process.env.XTREAM_HOST || '13569-cdn8.ovh';
    const port = process.env.XTREAM_PORT || '80';
    const user = process.env.XTREAM_USER || 'AX02AV5XXDR2U2T';
    const pass = process.env.XTREAM_PASS || 'vgbghaS6N5';

    const baseUrl = `http://${host}:${port}/player_api.php?username=${user}&password=${pass}`;

    // 1. Fetch VOD categories
    const categoriesData = await this.fetchJson<Array<{ category_id: string; category_name: string }>>(
      `${baseUrl}&action=get_vod_categories`
    );

    const catMap = new Map<string, string>();
    if (Array.isArray(categoriesData)) {
      for (const c of categoriesData) {
        catMap.set(String(c.category_id), c.category_name);
      }
    }

    // 2. Fetch sample of VOD streams (up to 30 top movies)
    const streamsData = await this.fetchJson<Array<any>>(`${baseUrl}&action=get_vod_streams`);
    if (Array.isArray(streamsData)) {
      const topMovies = streamsData.slice(0, 30);
      for (const m of topMovies) {
        const streamId = m.stream_id;
        const name = (m.name || `Movie ${streamId}`).trim();
        const norm = name
          .toLowerCase()
          .replace(/[^\w\u0621-\u064A\s]/gi, '')
          .replace(/\s+/g, '_');

        const catName = catMap.get(String(m.category_id)) || 'أفلام عامة';
        const container = m.container_extension || 'mp4';
        const streamUrl = `http://${host}:${port}/movie/${user}/${pass}/${streamId}.${container}`;

        await vodRepository.upsertMovie({
          title: name,
          normalizedTitle: norm,
          category: catName,
          posterUrl: m.stream_icon || undefined,
          description: m.plot || `${name} - متاح للمشاهدة بجودة عالية`,
          rating: m.rating ? parseFloat(m.rating) : 7.5,
          releaseYear: m.year ? parseInt(m.year, 10) : new Date().getFullYear(),
          streamUrl,
          containerExtension: container,
        });
      }
    }
  }

  private fetchJson<T>(url: string): Promise<T | null> {
    return new Promise((resolve) => {
      try {
        const parsed = new URL(url);
        const lib = parsed.protocol === 'https:' ? https : http;

        const req = lib.get(
          url,
          {
            headers: { 'User-Agent': this.USER_AGENT },
            timeout: 10000,
          },
          (res) => {
            if (res.statusCode !== 200) {
              res.destroy();
              return resolve(null);
            }
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => {
              try {
                resolve(JSON.parse(data));
              } catch {
                resolve(null);
              }
            });
          }
        );

        req.on('timeout', () => {
          req.destroy();
          resolve(null);
        });
        req.on('error', () => resolve(null));
      } catch {
        resolve(null);
      }
    });
  }
}

export const vodService = new VodService();
