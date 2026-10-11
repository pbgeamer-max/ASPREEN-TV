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
} from 'lucide-react';
import { Sidebar } from '@/components/layout/sidebar';
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
  const [syncing, setSyncing] = useState(false);

  // Selected movie modal
  const [selectedMovie, setSelectedMovie] = useState<any | null>(null);
  const [playingStream, setPlayingStream] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }
    if (user) {
      loadMovies();
    }
  }, [user, authLoading, selectedCategory, router]);

  const loadMovies = async () => {
    setLoading(true);
    try {
      const data = await api.getMovies({
        category: selectedCategory === 'all' ? undefined : selectedCategory,
        q: searchQuery || undefined,
        limit: 100,
      });
      setMovies(data.items || []);
      setCategories(data.categories || []);
    } catch (err: any) {
      console.error('Failed to load movies:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadMovies();
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await api.syncVod();
      alert(`تمت مزامنة الأفلام والمسلسلات بنجاح!\nالأفلام المحدثة: ${res.report?.totalMovies || 0}`);
      await loadMovies();
    } catch (err: any) {
      alert(`فشل التحديث: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080808] flex text-[#F5F5F5]">
      <Sidebar />

      <main className="flex-1 ml-64 p-8">
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

          <div className="flex items-center gap-3">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-4 py-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white text-xs font-semibold rounded-lg flex items-center gap-2 shadow-lg shadow-red-900/20 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'جاري المزامنة...' : 'مزامنة الأفلام والمسلسلات'}</span>
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
              الكل ({movies.length})
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
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
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
                <div className="relative aspect-[2/3] bg-[#1A1A1A] overflow-hidden">
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
                    <div className="space-y-3">
                      <div className="relative aspect-video bg-black rounded-xl overflow-hidden border border-[#2E2E2E]">
                        <video
                          src={playingStream}
                          controls
                          autoPlay
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-[#A1A1AA]">
                        <span className="truncate max-w-md font-mono text-[10px]">
                          رابط البث: {playingStream}
                        </span>
                        <a
                          href={playingStream}
                          target="_blank"
                          rel="noreferrer"
                          className="text-red-400 hover:underline flex items-center gap-1"
                        >
                          فتح في نافذة مستقلة <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setPlayingStream(selectedMovie.streamUrl)}
                        className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-red-950/30 transition-all"
                      >
                        <Play className="w-4 h-4 fill-white" />
                        <span>تشغيل الفيلم الآن</span>
                      </button>

                      <a
                        href={selectedMovie.streamUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-4 py-2.5 bg-[#1E1E1E] hover:bg-[#282828] text-white text-xs font-semibold rounded-xl flex items-center gap-2 border border-[#333333] transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>رابط المشاهدة</span>
                      </a>
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
