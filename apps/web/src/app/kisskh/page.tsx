'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { useAuth } from '@/lib/auth-context';
import { HlsPlayerModal } from '@/components/player/hls-player';
import {
  Sparkles,
  Search,
  Play,
  Film,
  Tv,
  Layers,
  Copy,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Globe,
  Flame,
  Star,
  Swords,
  Subtitles,
  Server,
  Filter,
  Clapperboard,
} from 'lucide-react';

interface GlobalMediaSummary {
  id: number;
  tmdb_id: number;
  title: string;
  original_title?: string;
  overview: string;
  thumbnail: string;
  raw_thumbnail: string;
  backdrop: string | null;
  release_date: string;
  type: 'movie' | 'tv';
  rating: number;
  country: string;
  genres: string[];
}

interface GlobalMediaDetail {
  id: number;
  tmdb_id: number;
  title: string;
  original_title?: string;
  overview: string;
  thumbnail: string;
  raw_thumbnail: string;
  backdrop: string | null;
  release_date: string;
  type: 'movie' | 'tv';
  rating: number;
  country: string;
  genres: string[];
  seasons_count: number;
  episodes_count: number;
  seasons: Array<{
    season_number: number;
    name: string;
    episode_count: number;
  }>;
  episodes: Array<{
    id: number;
    episode_number: number;
    season_number: number;
    title: string;
    overview: string;
    thumbnail: string | null;
    stream_url: string;
    subtitles_url: string;
  }>;
}

interface SubtitleTrack {
  src: string;
  vtt_url?: string;
  label: string;
  land: string;
  default?: boolean;
}

// Media type tabs
const MEDIA_TYPE_TABS = [
  { id: 'all', label: 'الكل (All)', icon: Globe },
  { id: 'movie', label: '🎬 أفلام سينمائية (Movies)', icon: Film },
  { id: 'tv', label: '📺 مسلسلات تلفزيونية (Series)', icon: Tv },
  { id: 'anime', label: '⚔️ أنمي ياباني (Anime)', icon: Swords },
];

// Country filters (Strictly excluding Turkey because Turkey is in 3isk)
const COUNTRY_OPTIONS = [
  { id: 'ALL', label: '🌍 جميع دول العالم' },
  { id: 'US', label: '🇺🇸 هوليوود وأمريكا (Hollywood)' },
  { id: 'KR', label: '🇰🇷 كوريا الجنوبية (K-Drama)' },
  { id: 'CN', label: '🇨🇳 الصين (C-Drama)' },
  { id: 'JP', label: '🇯🇵 اليابان (J-Drama / Anime)' },
  { id: 'GB', label: '🇬🇧 بريطانيا وأوروبا (UK & EU)' },
  { id: 'FR', label: '🇫🇷 فرنسا (France)' },
  { id: 'DE', label: '🇩🇪 ألمانيا (Germany)' },
  { id: 'ES', label: '🇪🇸 إسبانيا (Spain)' },
  { id: 'IN', label: '🇮🇳 بوليوود والهند (Bollywood)' },
  { id: 'EG', label: '🇪🇬 العالم العربي ومصر (Arab Cinema)' },
];

// Genre filters
const GENRE_OPTIONS = [
  { id: 'ALL', label: 'جميع التصنيفات' },
  { id: '28', label: '💥 أكشن (Action)' },
  { id: '12', label: '🧭 مغامرة (Adventure)' },
  { id: '35', label: '😂 كوميديا (Comedy)' },
  { id: '18', label: '🎭 دراما (Drama)' },
  { id: '27', label: '👻 رعب (Horror)' },
  { id: '878', label: '🚀 خيال علمي (Sci-Fi)' },
  { id: '10749', label: '❤️ رومانسية (Romance)' },
  { id: '80', label: '🕵️ جريمة وغموض (Crime)' },
  { id: '16', label: '🎨 رسوم متحركة (Animation)' },
  { id: '10751', label: '👨‍👩‍👧‍👦 عائلي (Family)' },
  { id: '53', label: '⚡ إثارة وتشويق (Thriller)' },
];

export default function GlobalCinemaPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [activeType, setActiveType] = useState<string>('all');
  const [selectedCountry, setSelectedCountry] = useState<string>('ALL');
  const [selectedGenre, setSelectedGenre] = useState<string>('ALL');
  const [sortOrder, setSortOrder] = useState<string>('popularity.desc');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [page, setPage] = useState<number>(1);

  const [items, setItems] = useState<GlobalMediaSummary[]>([]);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalTitles, setTotalTitles] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);

  // Selected Item Drawer
  const [selectedItem, setSelectedItem] = useState<GlobalMediaDetail | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);

  // Player state (Unified Aspreen Native Player with Arabic Subtitles)
  const [playerOpen, setPlayerOpen] = useState<boolean>(false);
  const [playerTitle, setPlayerTitle] = useState<string>('');
  const [playerStreamUrl, setPlayerStreamUrl] = useState<string>('');
  const [subtitles, setSubtitles] = useState<SubtitleTrack[]>([]);

  // Copy API state
  const [copiedApi, setCopiedApi] = useState<boolean>(false);
  const [copiedStream, setCopiedStream] = useState<boolean>(false);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setPage(1);
    }, 450);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Load catalog
  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('type', activeType);
      params.set('country', selectedCountry);
      params.set('genre', selectedGenre);
      params.set('order', sortOrder);

      if (debouncedSearch) {
        params.set('q', debouncedSearch);
      }

      const res = await fetch(`/api/app/global/catalog?${params.toString()}`, {
        credentials: 'include',
      });

      if (!res.ok) throw new Error('Failed to fetch global catalog');
      const data = await res.json();

      if (data && data.success) {
        setItems(data.items || []);
        setTotalPages(data.total_pages || 1);
        setTotalTitles(data.total || (data.items || []).length);
      }
    } catch (err) {
      console.error('[GlobalCinema] catalog load error:', err);
    } finally {
      setLoading(false);
    }
  }, [page, activeType, selectedCountry, selectedGenre, sortOrder, debouncedSearch]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // Load Details for Drawer
  const openDetails = async (id: number, type: 'movie' | 'tv', seasonNum = 1) => {
    setLoadingDetail(true);
    setSelectedSeason(seasonNum);
    try {
      const res = await fetch(`/api/app/global/details/${id}?type=${type}&season=${seasonNum}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch details');
      const json = await res.json();
      if (json && json.success) {
        setSelectedItem(json.data);
      }
    } catch (err) {
      console.error('[GlobalCinema] details load error:', err);
    } finally {
      setLoadingDetail(false);
    }
  };

  // Play Episode or Movie inside Native VIP Player with Arabic Subtitles
  const playItem = (
    title: string,
    streamUrl: string,
    tmdbId: number,
    type: 'movie' | 'tv',
    season = 1,
    episode = 1
  ) => {
    setPlayerTitle(title);
    setPlayerStreamUrl(streamUrl);
    setSubtitles([]);
    setPlayerOpen(true);

    // Pre-fetch Arabic subtitles
    fetch(`/api/app/global/subtitles?tmdbId=${tmdbId}&type=${type}&season=${season}&ep=${episode}`, {
      credentials: 'include',
    })
      .then((res) => res.json())
      .then((data) => {
        if (data && data.success && Array.isArray(data.tracks)) {
          setSubtitles(data.tracks);
        }
      })
      .catch(() => {});
  };

  const copyApiUrl = () => {
    const url = `${window.location.origin}/api/app/global/catalog?type=${activeType}&country=${selectedCountry}&genre=${selectedGenre}`;
    navigator.clipboard.writeText(url);
    setCopiedApi(true);
    setTimeout(() => setCopiedApi(false), 2000);
  };

  const copyStreamUrl = (url: string) => {
    const full = url.startsWith('http') ? url : `${window.location.origin}${url}`;
    navigator.clipboard.writeText(full);
    setCopiedStream(true);
    setTimeout(() => setCopiedStream(false), 2000);
  };

  return (
    <div className="flex h-screen bg-[#080808] text-[#F5F5F5] select-none" dir="rtl">
      <Sidebar />

      <main className="flex-1 flex flex-col ml-64 overflow-hidden">
        <Header title="الأفلام والمسلسلات العالمية" subtitle="Global Cinema & Series Library" />

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {/* Header Banner */}
          <div className="relative rounded-2xl p-6 md:p-8 bg-gradient-to-r from-[#141414] via-[#101010] to-[#0A0A0A] border border-white/5 overflow-hidden shadow-2xl">
            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-2 max-w-2xl">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#E50914]/15 border border-[#E50914]/30 text-[#FF5A5F] text-xs font-bold">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>مكتبة السينما والتلفزيون العالمية الموحدة</span>
                  <span className="text-white/40">•</span>
                  <span>100,000+ عمل فني مترجم</span>
                </div>
                <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight">
                  الأفلام والمسلسلات العالمية
                </h1>
                <p className="text-xs md:text-sm text-[#A1A1AA] leading-relaxed">
                  أضخم مكتبة سينمائية وتلفزيونية في العالم بدون إعلانات. تشمل هوليوود، كوريا، الصين، اليابان، وأوروبا.
                  مشغل Aspreen VIP الموحد يسحب الروابط المباشرة تلقائياً مع ترجمة عربية مدمجة وفائقة الدقة.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <button
                  onClick={copyApiUrl}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1C1C1C] hover:bg-[#252525] text-white text-xs font-semibold border border-white/10 transition-colors shadow-sm"
                  title="نسخ رابط الـ API المفتوح"
                >
                  {copiedApi ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-[#A1A1AA]" />}
                  <span>{copiedApi ? 'تم نسخ رابط الـ API!' : 'رابط الـ API المفتوح (JSON)'}</span>
                </button>

                <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-semibold">
                  <Server className="w-4 h-4 text-emerald-400" />
                  <span>مشغل VIP الموحد نشط</span>
                </div>
              </div>
            </div>
          </div>

          {/* Controls Bar: Type Tabs, Country Filter, Genre Filter, Sort, & Search */}
          <div className="space-y-4">
            {/* Media Type Tabs */}
            <div className="flex flex-wrap items-center gap-2 border-b border-white/5 pb-3">
              {MEDIA_TYPE_TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeType === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setActiveType(tab.id);
                      setPage(1);
                    }}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                      isActive
                        ? 'bg-[#E50914] text-white shadow-lg shadow-[#E50914]/20 border border-[#E50914]'
                        : 'bg-[#141414] text-[#A1A1AA] hover:text-white hover:bg-[#1C1C1C] border border-white/5'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Filter Controls Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-[#111111] p-3 rounded-2xl border border-white/5">
              {/* Country Filter */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-[#888888] flex items-center gap-1.5">
                  <Globe className="w-3 h-3 text-[#A1A1AA]" />
                  <span>الدولة والمنطقة (ما عدا تركي)</span>
                </label>
                <select
                  value={selectedCountry}
                  onChange={(e) => {
                    setSelectedCountry(e.target.value);
                    setPage(1);
                  }}
                  className="w-full bg-[#1A1A1A] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#E50914] transition-colors"
                >
                  {COUNTRY_OPTIONS.map((c) => (
                    <option key={c.id} value={c.id} className="bg-[#1A1A1A] text-white">
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Genre Filter */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-[#888888] flex items-center gap-1.5">
                  <Filter className="w-3 h-3 text-[#A1A1AA]" />
                  <span>التصنيف والنوع (Genres)</span>
                </label>
                <select
                  value={selectedGenre}
                  onChange={(e) => {
                    setSelectedGenre(e.target.value);
                    setPage(1);
                  }}
                  className="w-full bg-[#1A1A1A] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#E50914] transition-colors"
                >
                  {GENRE_OPTIONS.map((g) => (
                    <option key={g.id} value={g.id} className="bg-[#1A1A1A] text-white">
                      {g.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Sort Order */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-[#888888] flex items-center gap-1.5">
                  <Flame className="w-3 h-3 text-[#A1A1AA]" />
                  <span>ترتيب النتائج</span>
                </label>
                <select
                  value={sortOrder}
                  onChange={(e) => {
                    setSortOrder(e.target.value);
                    setPage(1);
                  }}
                  className="w-full bg-[#1A1A1A] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#E50914] transition-colors"
                >
                  <option value="popularity.desc" className="bg-[#1A1A1A] text-white">🔥 الأكثر شعبية ومتابعة</option>
                  <option value="vote_average.desc" className="bg-[#1A1A1A] text-white">⭐ الأعلى تقييماً (Top Rated)</option>
                  <option value="primary_release_date.desc" className="bg-[#1A1A1A] text-white">✨ الأحدث إصداراً (Latest)</option>
                </select>
              </div>

              {/* Live Search */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-[#888888] flex items-center gap-1.5">
                  <Search className="w-3 h-3 text-[#A1A1AA]" />
                  <span>بحث بالاسم (عربي / English)</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="ابحث عن أي فيلم أو مسلسل..."
                    className="w-full bg-[#1A1A1A] border border-white/10 rounded-xl pr-9 pl-3 py-2 text-xs text-white placeholder-[#71717A] focus:outline-none focus:border-[#E50914] transition-colors"
                  />
                  <Search className="w-3.5 h-3.5 text-[#71717A] absolute right-3 top-1/2 -translate-y-1/2" />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#71717A] hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Media Items Grid */}
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 animate-pulse">
              {Array.from({ length: 18 }).map((_, idx) => (
                <div key={idx} className="bg-[#141414] rounded-2xl aspect-[2/3] border border-white/5" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl p-12 text-center bg-[#111111] border border-white/5 space-y-3">
              <Film className="w-12 h-12 text-[#71717A] mx-auto" />
              <h3 className="text-sm font-bold text-white">لم يتم العثور على أعمال مطابقة</h3>
              <p className="text-xs text-[#A1A1AA]">جرب تغيير فلاتر الدولة أو التصنيف أو تغيير نص البحث.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {items.map((item) => {
                const isMovie = item.type === 'movie';
                return (
                  <div
                    key={`${item.type}_${item.id}`}
                    onClick={() => openDetails(item.id, item.type)}
                    className="group relative bg-[#121212] hover:bg-[#181818] rounded-2xl border border-white/5 hover:border-[#E50914]/50 overflow-hidden shadow-lg transition-all duration-300 cursor-pointer flex flex-col hover:-translate-y-1 hover:shadow-2xl hover:shadow-[#E50914]/10"
                  >
                    {/* Poster Image */}
                    <div className="relative aspect-[2/3] w-full bg-neutral-900 overflow-hidden">
                      {item.thumbnail ? (
                        <img
                          src={item.thumbnail}
                          alt={item.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[#71717A]">
                          <Film className="w-8 h-8" />
                        </div>
                      )}

                      {/* Top Badges */}
                      <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold shadow-md ${
                          isMovie
                            ? 'bg-[#E50914] text-white'
                            : 'bg-indigo-600 text-white'
                        }`}>
                          {isMovie ? 'فيلم' : 'مسلسل'}
                        </span>

                        {item.rating > 0 && (
                          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-black/75 backdrop-blur-md text-amber-400 border border-amber-400/30">
                            <Star className="w-2.5 h-2.5 fill-amber-400" />
                            <span>{item.rating}</span>
                          </span>
                        )}
                      </div>

                      {/* Play Hover Overlay */}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                        <div className="w-12 h-12 rounded-full bg-[#E50914] text-white flex items-center justify-center shadow-xl transform scale-75 group-hover:scale-100 transition-transform duration-300">
                          <Play className="w-5 h-5 fill-white ml-0.5" />
                        </div>
                      </div>

                      {/* Bottom Release Year */}
                      {item.release_date && (
                        <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/70 backdrop-blur-md text-[10px] font-semibold text-neutral-300">
                          {item.release_date}
                        </div>
                      )}
                    </div>

                    {/* Meta */}
                    <div className="p-3 flex flex-col flex-1 justify-between gap-1">
                      <h4 className="text-xs font-bold text-white line-clamp-1 group-hover:text-[#FF5A5F] transition-colors" title={item.title}>
                        {item.title}
                      </h4>
                      {item.original_title && item.original_title !== item.title && (
                        <p className="text-[10px] text-[#71717A] line-clamp-1 font-mono" dir="ltr">
                          {item.original_title}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination Controls */}
          {totalPages > 1 && !loading && (
            <div className="flex items-center justify-center gap-3 py-6 border-t border-white/5">
              <button
                disabled={page <= 1}
                onClick={() => {
                  setPage((p) => Math.max(1, p - 1));
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#141414] hover:bg-[#1C1C1C] disabled:opacity-30 disabled:cursor-not-allowed text-xs font-semibold text-white border border-white/10 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
                <span>الصفحة السابقة</span>
              </button>

              <span className="text-xs text-[#A1A1AA] font-mono px-3 py-1 rounded-lg bg-[#111111] border border-white/5">
                صفحة <strong className="text-white">{page}</strong> من <strong className="text-white">{totalPages}</strong>
              </span>

              <button
                disabled={page >= totalPages}
                onClick={() => {
                  setPage((p) => p + 1);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#141414] hover:bg-[#1C1C1C] disabled:opacity-30 disabled:cursor-not-allowed text-xs font-semibold text-white border border-white/10 transition-colors"
              >
                <span>الصفحة التالية</span>
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Selected Media Details Drawer */}
        {selectedItem && (
          <div className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm flex justify-end" onClick={() => setSelectedItem(null)}>
            <div
              className="w-full max-w-2xl bg-[#0F0F0F] border-r border-white/10 h-full overflow-y-auto flex flex-col p-6 space-y-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drawer Header with Close */}
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                    selectedItem.type === 'movie' ? 'bg-[#E50914] text-white' : 'bg-indigo-600 text-white'
                  }`}>
                    {selectedItem.type === 'movie' ? 'فيلم سينمائي' : 'مسلسل تلفزيوني'}
                  </span>
                  <div className="flex items-center gap-1 text-xs text-amber-400 font-bold bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/25">
                    <Star className="w-3 h-3 fill-amber-400" />
                    <span>{selectedItem.rating}</span>
                  </div>
                </div>

                <button
                  onClick={() => setSelectedItem(null)}
                  className="p-2 rounded-lg bg-[#1C1C1C] hover:bg-[#282828] text-white transition-colors"
                  title="إغلاق"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Backdrop & Poster Banner */}
              <div className="relative rounded-2xl overflow-hidden aspect-video bg-neutral-900 border border-white/10 shadow-xl">
                {selectedItem.backdrop || selectedItem.thumbnail ? (
                  <img
                    src={selectedItem.backdrop || selectedItem.thumbnail}
                    alt={selectedItem.title}
                    className="w-full h-full object-cover"
                  />
                ) : null}
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent flex items-end p-6">
                  <div className="space-y-1">
                    <h2 className="text-xl md:text-2xl font-black text-white">{selectedItem.title}</h2>
                    {selectedItem.original_title && (
                      <p className="text-xs text-[#A1A1AA] font-mono" dir="ltr">{selectedItem.original_title}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Overview & Metadata */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#A1A1AA]">
                  {selectedItem.release_date && (
                    <span className="px-2.5 py-1 rounded-md bg-[#181818] border border-white/5">
                      سنة الإصدار: {selectedItem.release_date}
                    </span>
                  )}
                  {selectedItem.country && (
                    <span className="px-2.5 py-1 rounded-md bg-[#181818] border border-white/5">
                      البلد: {selectedItem.country}
                    </span>
                  )}
                  {selectedItem.genres && selectedItem.genres.length > 0 && (
                    <span className="px-2.5 py-1 rounded-md bg-[#181818] border border-white/5">
                      {selectedItem.genres.join(' • ')}
                    </span>
                  )}
                </div>

                <p className="text-xs md:text-sm text-[#D4D4D8] leading-relaxed bg-[#141414] p-4 rounded-xl border border-white/5">
                  {selectedItem.overview || 'مشاهدة وتحميل بجودة فائقة بدون إعلانات مع مشغل Aspreen VIP الموحد والترجمة العربية.'}
                </p>
              </div>

              {/* Episodes or Movie Play Action */}
              {selectedItem.type === 'movie' ? (
                <div className="space-y-3 pt-2">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Clapperboard className="w-4 h-4 text-[#E50914]" />
                    <span>مشاهدة الفيلم مباشرة</span>
                  </h3>

                  <button
                    onClick={() => {
                      const ep = selectedItem.episodes[0];
                      if (ep) {
                        playItem(
                          `${selectedItem.title} - فيلم كامل`,
                          ep.stream_url,
                          selectedItem.tmdb_id,
                          'movie'
                        );
                      }
                    }}
                    className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-xl bg-[#E50914] hover:bg-[#B81D24] text-white font-bold text-sm shadow-xl shadow-[#E50914]/25 transition-all transform active:scale-[0.99]"
                  >
                    <Play className="w-5 h-5 fill-white" />
                    <span>تشغيل الفيلم الآن (مشغل Aspreen VIP الموحد)</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-4 pt-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Tv className="w-4 h-4 text-[#E50914]" />
                      <span>حلقات المسلسل ({selectedItem.episodes_count} حلقة)</span>
                    </h3>

                    {/* Season Selector */}
                    {selectedItem.seasons && selectedItem.seasons.length > 1 && (
                      <div className="flex items-center gap-1 bg-[#181818] p-1 rounded-xl border border-white/10">
                        {selectedItem.seasons.map((s) => (
                          <button
                            key={s.season_number}
                            onClick={() => openDetails(selectedItem.id, 'tv', s.season_number)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                              selectedSeason === s.season_number
                                ? 'bg-[#E50914] text-white'
                                : 'text-[#A1A1AA] hover:text-white'
                            }`}
                          >
                            <span>{s.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Episodes Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-1">
                    {selectedItem.episodes.map((ep) => (
                      <div
                        key={ep.id}
                        onClick={() =>
                          playItem(
                            `${selectedItem.title} - الحلقة ${ep.episode_number}`,
                            ep.stream_url,
                            selectedItem.tmdb_id,
                            'tv',
                            ep.season_number,
                            ep.episode_number
                          )
                        }
                        className="group flex items-center gap-3 p-2.5 rounded-xl bg-[#141414] hover:bg-[#1F1F1F] border border-white/5 hover:border-[#E50914]/40 cursor-pointer transition-all"
                      >
                        <div className="relative w-20 aspect-video rounded-lg overflow-hidden bg-neutral-900 shrink-0">
                          {ep.thumbnail ? (
                            <img src={ep.thumbnail} alt={ep.title} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[#71717A]">
                              <Play className="w-4 h-4" />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-black/40 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                            <Play className="w-4 h-4 text-white fill-white opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-transform" />
                          </div>
                        </div>

                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="text-xs font-bold text-white group-hover:text-[#FF5A5F] truncate">
                            {ep.title}
                          </span>
                          <span className="text-[10px] text-[#A1A1AA]">
                            الموسم {ep.season_number} • جودة عالية 1080p
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Global Cinema VIP Player Modal */}
        <HlsPlayerModal
          isOpen={playerOpen}
          channelName={playerTitle}
          streamUrl={playerStreamUrl}
          subtitles={subtitles}
          onClose={() => setPlayerOpen(false)}
        />
      </main>
    </div>
  );
}
