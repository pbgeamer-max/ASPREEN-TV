'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { useAuth } from '@/lib/auth-context';
import { HlsPlayerModal } from '@/components/player/hls-player';
import {
  Film,
  Tv,
  Play,
  Search,
  Sparkles,
  Layers,
  Copy,
  Check,
  X,
  ExternalLink,
  ChevronRight,
  BookOpen,
  Filter,
  RefreshCw,
} from 'lucide-react';

interface Episode {
  episode_number: number;
  title: string;
  watch_url: string;
  stream_url: string;
  hls_stream_url?: string;
}

interface CatalogItem {
  id: string;
  title: string;
  type: 'SERIES' | 'MOVIE';
  category: string;
  poster: string | null;
  raw_poster: string | null;
  description: string;
  episodes_count?: number;
  episodes?: Episode[];
  watch_url?: string;
  stream_url?: string;
  hls_stream_url?: string;
}

export default function ThreeIskPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [activeTab, setActiveTab] = useState<'ALL' | 'SERIES' | 'MOVIES'>('SERIES');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  const [series, setSeries] = useState<CatalogItem[]>([]);
  const [movies, setMovies] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  // Selected Series for episodes drawer/modal
  const [selectedSeries, setSelectedSeries] = useState<CatalogItem | null>(null);

  // Video Player state
  const [playerOpen, setPlayerOpen] = useState(false);
  const [playerTitle, setPlayerTitle] = useState('');
  const [playerStreamUrl, setPlayerStreamUrl] = useState('');
  const [playerBackupUrl, setPlayerBackupUrl] = useState<string | null>(null);

  // Copy API state
  const [copiedApi, setCopiedApi] = useState(false);

  const fetchCatalog = async () => {
    try {
      const res = await fetch('/api/app/3isk/catalog', { credentials: 'include' });
      const data = await res.json();
      if (data && data.success) {
        setSeries(data.series || []);
        setMovies(data.movies || []);
        if (data.updated_at) setLastUpdated(data.updated_at);
      }
    } catch (err) {
      console.error('Failed to load 3isk catalog:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSeries = async (item: CatalogItem) => {
    setSelectedSeries(item);
    if (!item.episodes || item.episodes.length === 0) {
      setLoadingEpisodes(true);
      try {
        const res = await fetch(`/api/app/3isk/series/${item.id}/episodes`, { credentials: 'include' });
        const data = await res.json();
        if (data && data.success && data.episodes) {
          const origin = typeof window !== 'undefined' ? window.location.origin : '';
          const eps: Episode[] = data.episodes.map((ep: any) => ({
            episode_number: ep.episodeNumber,
            title: ep.title,
            watch_url: ep.watchUrl,
            stream_url: `${origin}/api/app/3isk/video.mp4?url=${encodeURIComponent(ep.watchUrl)}`,
            hls_stream_url: `${origin}/api/app/3isk/stream?url=${encodeURIComponent(ep.watchUrl)}`,
          }));
          setSelectedSeries((prev) => (prev ? { ...prev, episodes: eps, episodes_count: eps.length } : prev));
        }
      } catch (err) {
        console.error('Failed to load on-demand episodes:', err);
      } finally {
        setLoadingEpisodes(false);
      }
    }
  };

  const handleManualSync = async () => {
    try {
      setSyncing(true);
      const res = await fetch('/api/app/3isk/sync', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (data && data.success) {
        await fetchCatalog();
      }
    } catch (err) {
      console.error('Manual sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }
    if (user) {
      fetchCatalog();
    }
  }, [user, authLoading, router]);

  // Filter items
  const allItems = [...series, ...movies];
  let displayedItems: CatalogItem[] = [];
  if (activeTab === 'SERIES') displayedItems = series;
  else if (activeTab === 'MOVIES') displayedItems = movies;
  else displayedItems = allItems;

  if (selectedCategory !== 'ALL') {
    displayedItems = displayedItems.filter((i) => i.category.includes(selectedCategory));
  }

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    displayedItems = displayedItems.filter(
      (i) => i.title.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)
    );
  }

  const handlePlayMovie = (movie: CatalogItem) => {
    setPlayerTitle(movie.title);
    setPlayerStreamUrl(movie.stream_url || '');
    setPlayerBackupUrl(movie.hls_stream_url || null);
    setPlayerOpen(true);
  };

  const handlePlayEpisode = (ep: Episode, seriesTitle: string) => {
    setPlayerTitle(`${seriesTitle} - ${ep.title}`);
    setPlayerStreamUrl(ep.stream_url);
    setPlayerBackupUrl(ep.hls_stream_url || null);
    setPlayerOpen(true);
  };

  const copyApiUrl = () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://aspreen-tv-production.up.railway.app';
    const apiUrl = `${origin}/api/app/3isk/catalog`;
    navigator.clipboard.writeText(apiUrl);
    setCopiedApi(true);
    setTimeout(() => setCopiedApi(false), 2000);
  };

  return (
    <div className="flex h-screen bg-[#0A0A0A] text-[#F5F5F5] font-sans">
      <Sidebar />

      <div className="flex-1 flex flex-col pl-64 overflow-hidden">
        <Header
          title="قصة عشق (3isk Drama & Movies)"
          subtitle="قسم مخصص للمسلسلات والأفلام التركية المترجمة والمدبلجة مع إعادة البث التلقائي"
        />

        <main className="flex-1 overflow-y-auto p-8 space-y-6 max-w-7xl mx-auto w-full">
          {/* Header Banner & API Info */}
          <div className="p-6 rounded-2xl bg-gradient-to-r from-red-950/40 via-[#141414] to-[#121212] border border-red-900/30 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-950/80 border border-red-800/60 text-red-400 text-xs font-semibold">
                <Sparkles className="w-3.5 h-3.5" />
                <span>قسم الأفلام والمسلسلات الحصري (قصة عشق 3iskk)</span>
              </div>
              <h1 className="text-2xl font-black text-white tracking-tight">
                مكتبة المسلسلات والأفلام التركية
              </h1>
              <p className="text-xs text-[#A1A1AA] max-w-2xl leading-relaxed">
                يتم جلب الحلقات وتفاصيل القصص وتحديث الروابط الأصلية وتوفير إعادة بث فوري عالي السرعة وبدون إعلانات مزعجة.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <button
                onClick={handleManualSync}
                disabled={syncing}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold text-xs transition-colors shrink-0 shadow-lg shadow-red-600/20"
              >
                <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                <span>{syncing ? 'جاري فحص وتحديث قصة عشق...' : 'تحديث الأعمال الآن'}</span>
              </button>

              <button
                onClick={copyApiUrl}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white hover:bg-[#E4E4E7] text-black font-semibold text-xs transition-colors shrink-0"
              >
                {copiedApi ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                <span>{copiedApi ? 'تم نسخ رابط API الكتالوج!' : 'نسخ رابط API للتطبيق'}</span>
              </button>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-[#121212] border border-[#262626] flex items-center justify-between">
              <div>
                <p className="text-[11px] text-[#71717A] uppercase font-mono tracking-wider">إجمالي المسلسلات</p>
                <p className="text-2xl font-bold text-white mt-1">{series.length} <span className="text-xs font-normal text-[#A1A1AA]">مسلسل تركي</span></p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
                <Tv className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#121212] border border-[#262626] flex items-center justify-between">
              <div>
                <p className="text-[11px] text-[#71717A] uppercase font-mono tracking-wider">إجمالي الأفلام</p>
                <p className="text-2xl font-bold text-white mt-1">{movies.length} <span className="text-xs font-normal text-[#A1A1AA]">فيلم تركي</span></p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                <Film className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#121212] border border-[#262626] flex items-center justify-between">
              <div>
                <p className="text-[11px] text-[#71717A] uppercase font-mono tracking-wider">تقنية إعادة البث (VOD)</p>
                <p className="text-lg font-bold text-emerald-400 mt-1">HLS 720P Direct</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <Layers className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#121212] border border-[#262626] flex items-center justify-between">
              <div>
                <p className="text-[11px] text-[#71717A] uppercase font-mono tracking-wider">التحديث التلقائي (Auto-Sync)</p>
                <p className="text-sm font-bold text-cyan-400 mt-1">نشط كل 15 دقيقة</p>
                <p className="text-[10px] text-[#71717A] mt-0.5">يعمل 24/7 بدون تدخل</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                <RefreshCw className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Controls: Tabs, Filters & Search */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#262626] pb-4">
            {/* Tabs */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab('SERIES')}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors flex items-center gap-2 ${
                  activeTab === 'SERIES'
                    ? 'bg-red-600 text-white'
                    : 'bg-[#141414] text-[#A1A1AA] hover:text-white border border-[#262626]'
                }`}
              >
                <Tv className="w-3.5 h-3.5" />
                <span>المسلسلات ({series.length})</span>
              </button>

              <button
                onClick={() => setActiveTab('MOVIES')}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors flex items-center gap-2 ${
                  activeTab === 'MOVIES'
                    ? 'bg-red-600 text-white'
                    : 'bg-[#141414] text-[#A1A1AA] hover:text-white border border-[#262626]'
                }`}
              >
                <Film className="w-3.5 h-3.5" />
                <span>الأفلام ({movies.length})</span>
              </button>

              <button
                onClick={() => setActiveTab('ALL')}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
                  activeTab === 'ALL'
                    ? 'bg-red-600 text-white'
                    : 'bg-[#141414] text-[#A1A1AA] hover:text-white border border-[#262626]'
                }`}
              >
                الكل ({allItems.length})
              </button>
            </div>

            {/* Category Filter Pills & Search */}
            <div className="flex items-center gap-3">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="bg-[#141414] border border-[#262626] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
              >
                <option value="ALL">جميع الأقسام</option>
                <option value="مدبلج">مدبلج فقط</option>
                <option value="مترجم">مترجم فقط</option>
              </select>

              <div className="relative">
                <Search className="w-4 h-4 text-[#71717A] absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="ابحث عن مسلسل أو فيلم..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-[#141414] border border-[#262626] rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-[#71717A] focus:outline-none focus:border-red-500 w-64"
                />
              </div>
            </div>
          </div>

          {/* Cards Grid */}
          {loading ? (
            <div className="p-12 text-center text-[#71717A] text-xs">جاري تحميل كتالوج قصة عشق...</div>
          ) : displayedItems.length === 0 ? (
            <div className="p-12 text-center text-[#71717A] text-xs bg-[#121212] rounded-2xl border border-[#262626]">
              لا توجد نتائج مطابقة لبحثك.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {displayedItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => (item.type === 'SERIES' ? handleSelectSeries(item) : handlePlayMovie(item))}
                  className="group bg-[#121212] hover:bg-[#1A1A1A] border border-[#222] hover:border-red-600/50 rounded-2xl overflow-hidden cursor-pointer transition-all duration-300 flex flex-col"
                >
                  {/* Poster Wrapper */}
                  <div className="relative aspect-[2/3] bg-[#0A0A0A] overflow-hidden">
                    {item.poster ? (
                      <img
                        src={item.poster}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        onError={(e: any) => {
                          e.target.style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[#333]">
                        <Film className="w-12 h-12" />
                      </div>
                    )}

                    {/* Badge */}
                    <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md text-[10px] font-bold bg-black/75 backdrop-blur-sm text-white border border-white/10">
                      {item.type === 'SERIES'
                        ? item.episodes_count ? `${item.episodes_count} حلقة` : 'مسلسل'
                        : 'فيلم'}
                    </div>

                    {/* Category pill */}
                    <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md text-[9px] font-medium bg-red-600/90 text-white">
                      {item.category.includes('مدبلج') ? 'مدبلج' : 'مترجم'}
                    </div>

                    {/* Play Hover Overlay */}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="w-12 h-12 rounded-full bg-red-600 text-white flex items-center justify-center shadow-lg transform group-hover:scale-110 transition-transform">
                        <Play className="w-5 h-5 ml-0.5 fill-current" />
                      </div>
                    </div>
                  </div>

                  {/* Title & Info */}
                  <div className="p-3 flex-1 flex flex-col justify-between">
                    <div>
                      <h3 className="text-xs font-bold text-white line-clamp-2 leading-snug group-hover:text-red-400 transition-colors">
                        {item.title}
                      </h3>
                      <p className="text-[10px] text-[#71717A] line-clamp-2 mt-1">
                        {item.description}
                      </p>
                    </div>

                    <div className="mt-3 pt-2 border-t border-[#222] flex items-center justify-between text-[10px] text-[#A1A1AA]">
                      <span>{item.type === 'SERIES' ? 'استعراض الحلقات' : 'تشغيل الفيلم'}</span>
                      <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180 text-red-500" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Series Episodes Modal / Drawer */}
          {selectedSeries && (
            <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-[#121212] border border-[#2E2E2E] rounded-2xl max-w-4xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
                {/* Modal Header */}
                <div className="p-6 border-b border-[#262626] flex items-start justify-between gap-4">
                  <div className="flex gap-4">
                    {selectedSeries.poster && (
                      <img
                        src={selectedSeries.poster}
                        alt={selectedSeries.title}
                        className="w-20 h-28 object-cover rounded-xl border border-[#333] shrink-0"
                      />
                    )}
                    <div>
                      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold bg-red-950 text-red-400 border border-red-800/40 mb-2">
                        {selectedSeries.category}
                      </div>
                      <h2 className="text-lg font-bold text-white">{selectedSeries.title}</h2>
                      <p className="text-xs text-[#A1A1AA] mt-1 max-w-xl leading-relaxed">
                        {selectedSeries.description}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => setSelectedSeries(null)}
                    className="p-2 rounded-xl bg-[#1E1E1E] hover:bg-[#282828] text-[#A1A1AA] hover:text-white transition-colors shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Episodes Grid */}
                <div className="p-6 overflow-y-auto flex-1 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-red-500" />
                      قائمة الحلقات المتوفرة ({selectedSeries.episodes?.length || 0} حلقة)
                    </h3>
                    <span className="text-[11px] text-[#71717A]">اضغط على أي حلقة لبدء البث الفوري</span>
                  </div>

                  {loadingEpisodes ? (
                    <div className="p-12 text-center text-xs text-[#A1A1AA] bg-[#0A0A0A] rounded-xl border border-[#222] flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="w-5 h-5 animate-spin text-red-500" />
                      <span>جاري جلب جميع حلقات المسلسل من قصة عشق...</span>
                    </div>
                  ) : (!selectedSeries.episodes || selectedSeries.episodes.length === 0) ? (
                    <div className="p-8 text-center text-xs text-[#71717A] bg-[#0A0A0A] rounded-xl border border-[#222]">
                      لا توجد حلقات مدرجة لهذا المسلسل حالياً.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
                      {selectedSeries.episodes.map((ep) => (
                        <button
                          key={ep.episode_number}
                          onClick={() => handlePlayEpisode(ep, selectedSeries.title)}
                          className="group p-3 rounded-xl bg-[#171717] hover:bg-red-600 border border-[#262626] hover:border-transparent text-center transition-all flex flex-col items-center justify-center gap-1"
                        >
                          <Play className="w-4 h-4 text-red-400 group-hover:text-white group-hover:scale-110 transition-transform" />
                          <span className="text-xs font-bold text-white">{ep.title}</span>
                          <span className="text-[9px] text-[#71717A] group-hover:text-red-100">تشغيل مباشر</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Built-in Video Player Modal */}
          {playerOpen && (
            <HlsPlayerModal
              isOpen={playerOpen}
              onClose={() => setPlayerOpen(false)}
              streamUrl={playerStreamUrl}
              backupUrl={playerBackupUrl}
              channelName={playerTitle}
            />
          )}
        </main>
      </div>
    </div>
  );
}
