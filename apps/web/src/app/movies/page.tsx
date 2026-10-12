'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Film,
  Search,
  Star,
  Play,
  Calendar,
  RefreshCw,
  X,
  ExternalLink,
  Layers,
  ChevronDown,
  Copy,
  Check,
} from 'lucide-react';
import { Sidebar } from '@/components/layout/sidebar';
import { VodPlayer } from '@/components/player/vod-player';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api-client';

export default function MoviesPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [movies, setMovies] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalMovies, setTotalMovies] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [copiedStream, setCopiedStream] = useState(false);

  const PAGE_SIZE = 60;

  // Selected movie modal
  const [selectedMovie, setSelectedMovie] = useState<any | null>(null);
  const [playingStream, setPlayingStream] = useState<string | null>(null);
  const [playerMode, setPlayerMode] = useState<'auto' | 'embed' | 'direct'>('auto');
  const [directStreamUrl, setDirectStreamUrl] = useState<string | null>(null);

  useEffect(() => {
    if (playingStream) {
      setDirectStreamUrl(null);
      if (playingStream.includes('71stream.one')) {
        api.resolveStream(playingStream)
          .then((res) => {
            if (res.directUrl) setDirectStreamUrl(res.directUrl);
          })
          .catch(() => {});
      }
    }
  }, [playingStream]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }
    if (user) {
      loadMovies(false);
    }
  }, [user, authLoading, selectedCategory, router]);

  const loadMovies = async (isAppend = false) => {
    if (isAppend) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    try {
      const offset = isAppend ? movies.length : 0;
      const data = await api.getMovies({
        category: selectedCategory === 'all' ? undefined : selectedCategory,
        q: searchQuery || undefined,
        limit: PAGE_SIZE,
        offset,
      });

      if (isAppend) {
        setMovies((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newItems = (data.items || []).filter((m: any) => !existingIds.has(m.id));
          return [...prev, ...newItems];
        });
      } else {
        setMovies(data.items || []);
      }
      setTotalMovies(data.total || 0);
      setCategories(data.categories || []);
    } catch (err: any) {
      console.error('Failed to load movies:', err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadMovies(false);
  };

  const handleTopCinemaSync = async (deep = false) => {
    setSyncing(true);
    try {
      const res = await api.syncTopCinema({
        deep,
        maxMoviePages: deep ? 15 : 6,
        maxSeries: deep ? 40 : 20,
        recentLimit: deep ? 60 : 35,
      });
      alert(
        `🍿 تمت مزامنة موقع TopCinema بنجاح!\n` +
        `الأفلام المضافة/المحدثة: ${res.report?.moviesAdded || 0}\n` +
        `المسلسلات المضافة: ${res.report?.seriesAdded || 0}\n` +
        `الحلقات المرتبة: ${res.report?.episodesAdded || 0}`
      );
      await loadMovies();
    } catch (err: any) {
      alert(`فشل التحديث من TopCinema: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleFiveTvSync = async (deep = false) => {
    setSyncing(true);
    try {
      const res = await api.syncFiveTv({
        deep,
        maxMoviePages: deep ? 15 : 6,
        maxSeriesPages: deep ? 10 : 4,
        recentLimit: deep ? 60 : 35,
      });
      alert(
        `🍿 تمت مزامنة موقع FiveTV (1080p) بنجاح!\n` +
        `الأفلام المضافة: ${res.report?.moviesAdded || 0}\n` +
        `المسلسلات المضافة: ${res.report?.seriesAdded || 0}\n` +
        `الحلقات المنظمة: ${res.report?.episodesAdded || 0}`
      );
      await loadMovies();
    } catch (err: any) {
      alert(`فشل التحديث من FiveTV: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await api.fullSyncVod({ deep: true });
      alert(
        `🍿 تمت المزامنة الشاملة لجميع المصادر بنجاح!\n` +
        `إجمالي الأفلام: ${res.report?.totalMovies || 0}\n` +
        `إجمالي المسلسلات: ${res.report?.totalSeries || 0}\n` +
        `إجمالي الحلقات: ${res.report?.totalEpisodes || 0}`
      );
      await loadMovies();
    } catch (err: any) {
      alert(`فشل التحديث: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleDeepSync = async () => {
    setSyncing(true);
    try {
      const res = await api.deepSyncVod();
      alert(res.message || '🚀 بدأ سحب المكتبات بالكامل من الألف إلى الياء في الخلفية!');
    } catch (err: any) {
      alert(`فشل بدء السحب العميق: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080808] flex text-[#F5F5F5]">
      <Sidebar />

      <main className="flex-1 ml-64 p-8 min-w-0 overflow-x-hidden">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-[#1F1F1F]">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-600/10 border border-red-500/20 flex items-center justify-center text-red-500">
                <Film className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                  مكتبة الأفلام (Movies VOD)
                </h1>
                <p className="text-xs text-[#A1A1AA] mt-0.5">
                  تصفح وشاهد أحدث الأفلام العالمية والعربية مع البوسترات والأوصاف وبدون أي تكرار
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleDeepSync}
              disabled={syncing}
              className="px-3.5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-lg flex items-center gap-2 shadow-lg shadow-emerald-950/20 transition-all disabled:opacity-50"
              title="سحب كافة صفحات الموقعين من الألف إلى الياء في الخلفية بدون حدود"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>🚀 سحب شامل (A-Z)</span>
            </button>

            <button
              onClick={() => handleFiveTvSync(false)}
              disabled={syncing}
              className="px-3.5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold rounded-lg flex items-center gap-2 shadow-lg shadow-blue-950/20 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>FiveTV (1080p)</span>
            </button>

            <button
              onClick={() => handleTopCinemaSync(false)}
              disabled={syncing}
              className="px-3.5 py-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-xs font-semibold rounded-lg flex items-center gap-2 shadow-lg shadow-orange-950/20 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>TopCinema</span>
            </button>

            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-3.5 py-2 bg-[#222222] hover:bg-[#2c2c2c] border border-[#333333] text-white text-xs font-semibold rounded-lg flex items-center gap-2 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>تحديث سريع</span>
            </button>
          </div>
        </div>

        {/* Filters & Search Bar */}
        <div className="my-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <form onSubmit={handleSearchSubmit} className="relative w-full md:w-96">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#71717A]" />
            <input
              type="text"
              placeholder="ابحث عن فيلم بالاسم أو الوصف..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#121212] border border-[#262626] rounded-lg pl-9 pr-4 py-2 text-xs text-white placeholder-[#71717A] focus:outline-none focus:border-red-500 transition-colors"
            />
          </form>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto pb-2 md:pb-0">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                selectedCategory === 'all'
                  ? 'bg-red-600 text-white'
                  : 'bg-[#141414] text-[#A1A1AA] hover:bg-[#1E1E1E] hover:text-white border border-[#262626]'
              }`}
            >
              الكل {selectedCategory === 'all' && totalMovies > 0 ? `(${totalMovies})` : `(${movies.length})`}
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  selectedCategory === cat
                    ? 'bg-red-600 text-white'
                    : 'bg-[#141414] text-[#A1A1AA] hover:bg-[#1E1E1E] hover:text-white border border-[#262626]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Movies Grid */}
        {loading ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3 text-[#A1A1AA]">
            <RefreshCw className="w-6 h-6 animate-spin text-red-500" />
            <span className="text-xs">جاري تحميل قائمة الأفلام...</span>
          </div>
        ) : movies.length === 0 ? (
          <div className="py-24 bg-[#101010] border border-[#262626] rounded-xl flex flex-col items-center justify-center gap-4 text-center p-6">
            <Film className="w-12 h-12 text-[#3F3F46]" />
            <div className="max-w-md">
              <h3 className="text-sm font-bold text-white">لا توجد أفلام حالياً</h3>
              <p className="text-xs text-[#71717A] mt-1">
                اضغط على زر &quot;مزامنة الأفلام والمسلسلات&quot; بالأعلى لجلب أحدث الأفلام والبوسترات فوراً.
              </p>
            </div>
            <button
              onClick={handleSync}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold rounded-lg"
            >
              مزامنة الآن
            </button>
          </div>
        ) : (
          <div
            className="grid gap-4"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
              gap: '16px',
            }}
          >
            {movies.map((movie) => (
              <div
                key={movie.id}
                onClick={() => {
                  setSelectedMovie(movie);
                  setPlayingStream(null);
                }}
                className="group bg-[#121212] border border-[#262626] hover:border-red-500/50 rounded-xl overflow-hidden cursor-pointer transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-red-950/20 flex flex-col"
              >
                {/* Poster */}
                <div className="relative aspect-[2/3] w-full max-h-[290px] bg-[#1A1A1A] overflow-hidden">
                  {movie.posterUrl ? (
                    <img
                      src={movie.posterUrl}
                      alt={movie.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-[#52525B] p-4 text-center">
                      <Film className="w-8 h-8 mb-2" />
                      <span className="text-[10px]">{movie.title}</span>
                    </div>
                  )}

                  {/* Rating Badge */}
                  {movie.rating && (
                    <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-black/70 backdrop-blur-md border border-yellow-500/30 rounded text-[10px] font-bold text-yellow-400 flex items-center gap-1">
                      <Star className="w-2.5 h-2.5 fill-yellow-400" />
                      <span>{Number(movie.rating).toFixed(1)}</span>
                    </div>
                  )}

                  {/* Year Pill */}
                  {movie.releaseYear && (
                    <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-black/70 backdrop-blur-md border border-white/10 rounded text-[10px] font-mono text-zinc-300">
                      {movie.releaseYear}
                    </div>
                  )}

                  {/* Hover Overlay Play Button */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="w-10 h-10 rounded-full bg-red-600 text-white flex items-center justify-center shadow-lg transform scale-75 group-hover:scale-100 transition-transform">
                      <Play className="w-4 h-4 fill-white ml-0.5" />
                    </div>
                  </div>
                </div>

                {/* Details */}
                <div className="p-3 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="text-xs font-semibold text-white line-clamp-1 group-hover:text-red-400 transition-colors">
                      {movie.title}
                    </h3>
                    <p className="text-[10px] text-[#71717A] mt-0.5 line-clamp-1">
                      {movie.category}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Load More Button & Stats Footer */}
        {!loading && movies.length > 0 && (
          <div className="mt-10 mb-8 flex flex-col items-center justify-center gap-3">
            <div className="text-xs text-[#71717A] flex items-center gap-1.5">
              <span>عرض</span>
              <span className="text-white font-bold">{movies.length}</span>
              <span>من أصل</span>
              <span className="text-red-400 font-bold">{totalMovies}</span>
              <span>فيلم متوفر</span>
            </div>

            {movies.length < totalMovies ? (
              <button
                onClick={() => loadMovies(true)}
                disabled={loadingMore}
                className="px-6 py-2.5 bg-[#181818] hover:bg-[#222222] border border-[#2E2E2E] hover:border-red-500/50 text-white text-xs font-semibold rounded-xl flex items-center gap-2.5 shadow-lg transition-all disabled:opacity-50 group cursor-pointer"
              >
                {loadingMore ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-red-500" />
                    <span>جاري جلب الأفلام الإضافية...</span>
                  </>
                ) : (
                  <>
                    <span className="group-hover:text-red-400 transition-colors">
                      تحميل المزيد من الأفلام (+{Math.min(PAGE_SIZE, totalMovies - movies.length)})
                    </span>
                    <ChevronDown className="w-4 h-4 text-red-500 group-hover:translate-y-0.5 transition-transform" />
                  </>
                )}
              </button>
            ) : (
              <div className="px-4 py-1.5 bg-[#121212] border border-[#222222] rounded-full text-[11px] text-[#71717A] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                <span>تم عرض جميع الأفلام في هذه القائمة بالكامل ({totalMovies} فيلم)</span>
              </div>
            )}
          </div>
        )}

        {/* Movie Details & Player Modal */}
        {selectedMovie && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-[#121212] border border-[#2E2E2E] rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
              {/* Modal Header */}
              <div className="relative">
                {selectedMovie.backdropUrl && (
                  <div className="h-44 w-full overflow-hidden relative">
                    <img
                      src={selectedMovie.backdropUrl}
                      alt={selectedMovie.title}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#121212] via-[#121212]/60 to-transparent" />
                  </div>
                )}

                <button
                  onClick={() => setSelectedMovie(null)}
                  className="absolute top-4 right-4 w-8 h-8 rounded-full bg-black/60 hover:bg-black text-white flex items-center justify-center transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 -mt-12 relative z-10">
                <div className="flex gap-5">
                  {selectedMovie.posterUrl && (
                    <img
                      src={selectedMovie.posterUrl}
                      alt={selectedMovie.title}
                      className="w-28 h-40 object-cover rounded-lg shadow-xl border border-white/10 shrink-0"
                    />
                  )}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 bg-red-600/20 border border-red-500/30 text-red-400 text-[10px] font-semibold rounded">
                        {selectedMovie.category}
                      </span>
                      {selectedMovie.releaseYear && (
                        <span className="text-xs text-[#A1A1AA] flex items-center gap-1 font-mono">
                          <Calendar className="w-3 h-3" /> {selectedMovie.releaseYear}
                        </span>
                      )}
                      {selectedMovie.rating && (
                        <span className="text-xs text-yellow-400 flex items-center gap-1 font-bold">
                          <Star className="w-3 h-3 fill-yellow-400" /> {selectedMovie.rating}
                        </span>
                      )}
                    </div>

                    <h2 className="text-lg font-bold text-white mt-2">
                      {selectedMovie.title}
                    </h2>

                    <p className="text-xs text-[#A1A1AA] mt-2 line-clamp-4 leading-relaxed">
                      {selectedMovie.description || 'لا يوجد وصف متوفر لهذا الفيلم حالياً.'}
                    </p>
                  </div>
                </div>

                {/* Player Section */}
                <div className="mt-6 pt-5 border-t border-[#262626]">
                  {playingStream ? (
                    <VodPlayer
                      title={selectedMovie.title}
                      streamUrl={playingStream}
                      posterUrl={selectedMovie.posterUrl || selectedMovie.backdropUrl}
                      onClose={() => setPlayingStream(null)}
                    />
                  ) : (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-2.5">
                        <button
                          onClick={() => setPlayingStream(`/api/vod/stream/movie/${selectedMovie.id}/stream.mp4`)}
                          className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-red-950/30 transition-all cursor-pointer"
                        >
                          <Play className="w-4 h-4 fill-white" />
                          <span>تشغيل الفيلم الآن (نقرة واحدة)</span>
                        </button>

                        <button
                          onClick={() => {
                            const origin = typeof window !== 'undefined' ? window.location.origin : '';
                            const directUrl = `${origin}/api/vod/stream/movie/${selectedMovie.id}/stream.mp4`;
                            navigator.clipboard.writeText(directUrl);
                            setCopiedStream(true);
                            setTimeout(() => setCopiedStream(false), 2500);
                          }}
                          className="px-4 py-3 bg-[#1C1C1C] hover:bg-[#262626] border border-[#333] text-white text-xs font-medium rounded-xl flex items-center justify-center gap-1.5 transition-colors shrink-0 cursor-pointer"
                          title="نسخ رابط MP4 المباشر لتشغيله في أي تطبيق أندرويد أو موقع خارجي أو VLC"
                        >
                          {copiedStream ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-emerald-400 font-semibold">تم نسخ الرابط!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-[#A1A1AA]" />
                              <span>نسخ رابط الفيديو (أندرويد / خارجي)</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
