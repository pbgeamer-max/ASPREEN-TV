'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Clapperboard,
  Search,
  Star,
  Play,
  Calendar,
  RefreshCw,
  X,
  ExternalLink,
  Layers,
  Tv,
} from 'lucide-react';
import { Sidebar } from '@/components/layout/sidebar';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api-client';

export default function SeriesPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [seriesList, setSeriesList] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Selected series modal with episodes
  const [selectedSeries, setSelectedSeries] = useState<any | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [activeEpisode, setActiveEpisode] = useState<any | null>(null);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [playerMode, setPlayerMode] = useState<'auto' | 'embed' | 'direct'>('auto');

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }
    if (user) {
      loadSeries();
    }
  }, [user, authLoading, selectedCategory, router]);

  const loadSeries = async () => {
    setLoading(true);
    try {
      const data = await api.getSeries({
        category: selectedCategory === 'all' ? undefined : selectedCategory,
        q: searchQuery || undefined,
        limit: 100,
      });
      setSeriesList(data.items || []);
      setCategories(data.categories || []);
    } catch (err: any) {
      console.error('Failed to load series:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenSeries = async (series: any) => {
    setSelectedSeries(series);
    setActiveEpisode(null);
    setSelectedSeason(1);
    setLoadingEpisodes(true);

    try {
      const fullSeries = await api.getSeriesDetails(series.id);
      setSelectedSeries(fullSeries);
      if (fullSeries.episodes && fullSeries.episodes.length > 0) {
        // Group seasons
        const seasons = Array.from(new Set(fullSeries.episodes.map((e: any) => e.seasonNum))).sort(
          (a: any, b: any) => a - b
        );
        setSelectedSeason(Number(seasons[0] || 1));
      }
    } catch (err: any) {
      console.error('Failed to load episodes:', err);
    } finally {
      setLoadingEpisodes(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadSeries();
  };

  const handleTopCinemaSync = async () => {
    setSyncing(true);
    try {
      const res = await api.syncTopCinema({ maxMoviePages: 3, maxSeries: 15, recentLimit: 40 });
      alert(
        `🍿 تمت مزامنة موقع TopCinema بنجاح!\n` +
        `المسلسلات المضافة: ${res.report?.seriesAdded || 0}\n` +
        `الحلقات المرتبة: ${res.report?.episodesAdded || 0}\n` +
        `الأفلام المضافة: ${res.report?.moviesAdded || 0}`
      );
      await loadSeries();
    } catch (err: any) {
      alert(`فشل التحديث من TopCinema: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await api.syncVod();
      alert(`تمت مزامنة المسلسلات بنجاح!\nالمسلسلات المحدثة: ${res.report?.totalSeries || 0}\nالحلقات المنظمة: ${res.report?.episodesAdded || 0}`);
      await loadSeries();
    } catch (err: any) {
      alert(`فشل التحديث: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  // Filter episodes for the currently selected season
  const currentSeasonEpisodes = (selectedSeries?.episodes || []).filter(
    (ep: any) => ep.seasonNum === selectedSeason
  );

  // Get distinct seasons available for this series
  const availableSeasons: number[] = Array.from(
    new Set((selectedSeries?.episodes || []).map((e: any) => e.seasonNum))
  )
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <div className="min-h-screen bg-[#080808] flex text-[#F5F5F5]">
      <Sidebar />

      <main className="flex-1 ml-64 p-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-[#1F1F1F]">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-600/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
                <Clapperboard className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                  مكتبة المسلسلات (TV Series)
                </h1>
                <p className="text-xs text-[#A1A1AA] mt-0.5">
                  جميع المسلسلات مرتبة بالمواسم والحلقات الكاملة (1, 2, 3...) وبدون أي تكرار
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleTopCinemaSync}
              disabled={syncing}
              className="px-4 py-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-xs font-semibold rounded-lg flex items-center gap-2 shadow-lg shadow-orange-950/20 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'جاري الزحف...' : 'مزامنة TopCinema'}</span>
            </button>

            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-4 py-2 bg-[#222222] hover:bg-[#2c2c2c] border border-[#333333] text-white text-xs font-semibold rounded-lg flex items-center gap-2 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>مزامنة شاملة</span>
            </button>
          </div>
        </div>

        {/* Filters & Search Bar */}
        <div className="my-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <form onSubmit={handleSearchSubmit} className="relative w-full md:w-96">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#71717A]" />
            <input
              type="text"
              placeholder="ابحث عن مسلسل بالاسم..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#121212] border border-[#262626] rounded-lg pl-9 pr-4 py-2 text-xs text-white placeholder-[#71717A] focus:outline-none focus:border-amber-500 transition-colors"
            />
          </form>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto pb-2 md:pb-0">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                selectedCategory === 'all'
                  ? 'bg-amber-600 text-white'
                  : 'bg-[#141414] text-[#A1A1AA] hover:bg-[#1E1E1E] hover:text-white border border-[#262626]'
              }`}
            >
              الكل ({seriesList.length})
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  selectedCategory === cat
                    ? 'bg-amber-600 text-white'
                    : 'bg-[#141414] text-[#A1A1AA] hover:bg-[#1E1E1E] hover:text-white border border-[#262626]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Series Grid */}
        {loading ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3 text-[#A1A1AA]">
            <RefreshCw className="w-6 h-6 animate-spin text-amber-500" />
            <span className="text-xs">جاري تحميل قائمة المسلسلات...</span>
          </div>
        ) : seriesList.length === 0 ? (
          <div className="py-24 bg-[#101010] border border-[#262626] rounded-xl flex flex-col items-center justify-center gap-4 text-center p-6">
            <Clapperboard className="w-12 h-12 text-[#3F3F46]" />
            <div className="max-w-md">
              <h3 className="text-sm font-bold text-white">لا توجد مسلسلات حالياً</h3>
              <p className="text-xs text-[#71717A] mt-1">
                اضغط على زر &quot;مزامنة المسلسلات والحلقات&quot; لجلب أحدث المسلسلات مع مواسمها وحلقاتها الكاملة فوراً.
              </p>
            </div>
            <button
              onClick={handleSync}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg"
            >
              مزامنة الآن
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {seriesList.map((series) => (
              <div
                key={series.id}
                onClick={() => handleOpenSeries(series)}
                className="group bg-[#121212] border border-[#262626] hover:border-amber-500/50 rounded-xl overflow-hidden cursor-pointer transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-amber-950/20 flex flex-col"
              >
                {/* Poster */}
                <div className="relative aspect-[2/3] bg-[#1A1A1A] overflow-hidden">
                  {series.posterUrl ? (
                    <img
                      src={series.posterUrl}
                      alt={series.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-[#52525B] p-4 text-center">
                      <Clapperboard className="w-8 h-8 mb-2" />
                      <span className="text-[10px]">{series.title}</span>
                    </div>
                  )}

                  {/* Rating Badge */}
                  {series.rating && (
                    <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-black/70 backdrop-blur-md border border-yellow-500/30 rounded text-[10px] font-bold text-yellow-400 flex items-center gap-1">
                      <Star className="w-2.5 h-2.5 fill-yellow-400" />
                      <span>{Number(series.rating).toFixed(1)}</span>
                    </div>
                  )}

                  {/* Seasons Pill */}
                  <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-black/70 backdrop-blur-md border border-white/10 rounded text-[10px] font-medium text-amber-300 flex items-center gap-1">
                    <Layers className="w-2.5 h-2.5" />
                    <span>{series.totalSeasons || 1} مواسم</span>
                  </div>

                  {/* Hover Overlay */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="px-3 py-1.5 rounded-full bg-amber-600 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
                      <Play className="w-3.5 h-3.5 fill-white" />
                      <span>عرض الحلقات</span>
                    </div>
                  </div>
                </div>

                {/* Details */}
                <div className="p-3 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="text-xs font-semibold text-white line-clamp-1 group-hover:text-amber-400 transition-colors">
                      {series.title}
                    </h3>
                    <p className="text-[10px] text-[#71717A] mt-0.5 line-clamp-1">
                      {series.category}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Series Episodes Modal */}
        {selectedSeries && (
          <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-[#121212] border border-[#2E2E2E] rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
              {/* Header Banner */}
              <div className="p-6 border-b border-[#262626] flex items-start justify-between gap-4 bg-[#161616]">
                <div className="flex gap-4">
                  {selectedSeries.posterUrl && (
                    <img
                      src={selectedSeries.posterUrl}
                      alt={selectedSeries.title}
                      className="w-20 h-28 object-cover rounded-lg shadow-lg border border-white/10 shrink-0"
                    />
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-amber-600/20 border border-amber-500/30 text-amber-400 text-[10px] font-semibold rounded">
                        {selectedSeries.category}
                      </span>
                      {selectedSeries.rating && (
                        <span className="text-xs text-yellow-400 flex items-center gap-1 font-bold">
                          <Star className="w-3 h-3 fill-yellow-400" /> {selectedSeries.rating}
                        </span>
                      )}
                    </div>
                    <h2 className="text-lg font-bold text-white mt-1.5">
                      {selectedSeries.title}
                    </h2>
                    <p className="text-xs text-[#A1A1AA] mt-1.5 line-clamp-2 leading-relaxed">
                      {selectedSeries.description || 'مسلسل كامل الحلقات بدون تكرار وبجودة عالية.'}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setSelectedSeries(null)}
                  className="w-8 h-8 rounded-full bg-[#262626] hover:bg-[#333333] text-white flex items-center justify-center transition-colors shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Active Player View (if playing an episode) */}
              {activeEpisode && (
                <div className="p-6 bg-black border-b border-[#262626] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-400 flex items-center gap-2">
                      <Play className="w-3.5 h-3.5 fill-amber-400" />
                      جاري تشغيل: {activeEpisode.title}
                    </span>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 bg-[#1A1A1A] p-0.5 rounded-lg border border-[#2E2E2E]">
                        <button
                          onClick={() => setPlayerMode('auto')}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                            playerMode === 'auto' ? 'bg-amber-600 text-white' : 'text-[#A1A1AA] hover:text-white'
                          }`}
                        >
                          مشغل السيرفر (Embed)
                        </button>
                        <button
                          onClick={() => setPlayerMode('direct')}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                            playerMode === 'direct' ? 'bg-amber-600 text-white' : 'text-[#A1A1AA] hover:text-white'
                          }`}
                        >
                          مشغل مباشر
                        </button>
                      </div>
                      <button
                        onClick={() => setActiveEpisode(null)}
                        className="text-xs text-[#A1A1AA] hover:text-white mr-2"
                      >
                        إغلاق المشغل
                      </button>
                    </div>
                  </div>
                  <div className="relative aspect-video max-h-[420px] bg-black rounded-xl overflow-hidden border border-[#2E2E2E] mx-auto">
                    {playerMode === 'direct' ? (
                      <video
                        src={activeEpisode.streamUrl}
                        controls
                        autoPlay
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <iframe
                        src={activeEpisode.streamUrl}
                        className="w-full h-full border-0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                        allowFullScreen
                        referrerPolicy="no-referrer"
                      />
                    )}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[#A1A1AA]">
                    <span className="truncate max-w-md font-mono text-[10px]">
                      الرابط: {activeEpisode.streamUrl}
                    </span>
                    <a
                      href={activeEpisode.streamUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-amber-400 hover:underline flex items-center gap-1 text-xs"
                    >
                      فتح في نافذة مستقلة <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              )}

              {/* Seasons Selector Tabs */}
              <div className="px-6 py-3 bg-[#141414] border-b border-[#262626] flex items-center gap-2 overflow-x-auto">
                <span className="text-xs text-[#71717A] ml-2 shrink-0">المواسم:</span>
                {(availableSeasons.length > 0 ? availableSeasons : [1]).map((sNum) => (
                  <button
                    key={sNum}
                    onClick={() => setSelectedSeason(sNum)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors shrink-0 ${
                      selectedSeason === sNum
                        ? 'bg-amber-600 text-white'
                        : 'bg-[#1F1F1F] text-[#A1A1AA] hover:bg-[#2A2A2A] hover:text-white'
                    }`}
                  >
                    الموسم {sNum}
                  </button>
                ))}
              </div>

              {/* Episodes List (Strictly ordered, NO duplicates) */}
              <div className="p-6 overflow-y-auto flex-1 space-y-2">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-white">
                    حلقات الموسم {selectedSeason} ({currentSeasonEpisodes.length} حلقة)
                  </span>
                  <span className="text-[10px] text-emerald-400 bg-emerald-950/40 border border-emerald-500/20 px-2 py-0.5 rounded">
                    ممنوع التكرار ✓
                  </span>
                </div>

                {loadingEpisodes ? (
                  <div className="py-12 flex flex-col items-center justify-center gap-2 text-[#A1A1AA]">
                    <RefreshCw className="w-5 h-5 animate-spin text-amber-500" />
                    <span className="text-xs">جاري تحميل الحلقات...</span>
                  </div>
                ) : currentSeasonEpisodes.length === 0 ? (
                  <div className="py-12 text-center text-[#71717A] text-xs">
                    لا توجد حلقات مسجلة لهذا الموسم حالياً.
                  </div>
                ) : (
                  currentSeasonEpisodes.map((ep: any) => (
                    <div
                      key={ep.id}
                      className="p-3 bg-[#181818] hover:bg-[#222222] border border-[#2A2A2A] rounded-xl flex items-center justify-between gap-4 transition-colors group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-amber-600/10 border border-amber-500/20 text-amber-400 font-bold text-xs flex items-center justify-center shrink-0">
                          {ep.episodeNum}
                        </div>
                        <div className="truncate">
                          <h4 className="text-xs font-semibold text-white group-hover:text-amber-400 transition-colors truncate">
                            {ep.title}
                          </h4>
                          {ep.description && (
                            <p className="text-[10px] text-[#71717A] truncate mt-0.5">
                              {ep.description}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setActiveEpisode(ep)}
                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow transition-colors"
                        >
                          <Play className="w-3 h-3 fill-white" />
                          <span>تشغيل</span>
                        </button>
                        <a
                          href={ep.streamUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 bg-[#262626] hover:bg-[#333333] text-[#A1A1AA] hover:text-white rounded-lg transition-colors"
                          title="فتح الرابط المباشر"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
