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
  Clock,
  Star,
  Clapperboard,
  Swords,
  Subtitles,
  ExternalLink,
} from 'lucide-react';

interface DramaSummary {
  id: number;
  title: string;
  thumbnail: string;
  raw_thumbnail: string;
  episodes_count: number;
  label: string | null;
  type: string;
  details_url: string;
}

interface DramaDetail {
  id: number;
  title: string;
  description: string;
  thumbnail: string;
  raw_thumbnail: string;
  release_date: string;
  country: string;
  status: string;
  type: string;
  trailer: string | null;
  episodes_count: number;
  episodes: Array<{
    id: number;
    episode_number: number;
    title: string;
    subtitles_count: number;
    stream_url: string;
    backup_url?: string | null;
    subtitles_url: string;
  }>;
}

interface SubtitleTrack {
  src: string;
  label: string;
  land: string;
  default: boolean;
}

// Country code mappings in KissKH:
// 0: All, 1: South Korea, 2: China, 4: Japan, 5: Thailand
const CATEGORY_TABS = [
  { id: 'ALL', label: 'الكل (All)', icon: Globe, type: 0, country: 0 },
  { id: 'KDRAMA', label: '🇰🇷 دراما كورية (K-Drama)', icon: Flame, type: 1, country: 1 },
  { id: 'CDRAMA', label: '🇨🇳 دراما صينية (C-Drama)', icon: Tv, type: 1, country: 2 },
  { id: 'JDRAMA', label: '🇯🇵 دراما يابانية (J-Drama)', icon: Tv, type: 1, country: 4 },
  { id: 'MOVIES', label: '🎬 أفلام آسيوية (Movies)', icon: Film, type: 2, country: 0 },
  { id: 'ANIME', label: '⚔️ أنمي (Anime)', icon: Swords, type: 3, country: 0 },
];

export default function KisskhPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [activeTab, setActiveTab] = useState<string>('ALL');
  const [order, setOrder] = useState<number>(1); // 1: Popularity, 2: Latest, 3: Release, 4: Top Rated
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [page, setPage] = useState<number>(1);

  const [items, setItems] = useState<DramaSummary[]>([]);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalTitles, setTotalTitles] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);

  // Selected Drama Drawer
  const [selectedDrama, setSelectedDrama] = useState<DramaDetail | null>(null);
  const [loadingDrama, setLoadingDrama] = useState<boolean>(false);

  // Player state
  const [playerOpen, setPlayerOpen] = useState<boolean>(false);
  const [playerTitle, setPlayerTitle] = useState<string>('');
  const [playerStreamUrl, setPlayerStreamUrl] = useState<string>('');
  const [playerBackupUrl, setPlayerBackupUrl] = useState<string | null>(null);
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
      const activeCategory = CATEGORY_TABS.find((t) => t.id === activeTab) || CATEGORY_TABS[0];
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('pageSize', '36');
      params.set('order', order.toString());

      if (debouncedSearch) {
        params.set('q', debouncedSearch);
      } else {
        if (activeCategory.type !== 0) params.set('type', activeCategory.type.toString());
        if (activeCategory.country !== 0) params.set('country', activeCategory.country.toString());
      }

      const res = await fetch(`/api/app/kisskh/catalog?${params.toString()}`, {
        credentials: 'include',
      });
      const data = await res.json();
      if (data && data.success) {
        setItems(data.items || []);
        setTotalPages(data.total_pages || 1);
        setTotalTitles(data.total_titles || 0);
      }
    } catch (err) {
      console.error('Failed to load KissKH catalog:', err);
    } finally {
      setLoading(false);
    }
  }, [page, activeTab, order, debouncedSearch]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // Open drama drawer
  const handleSelectDrama = async (item: DramaSummary) => {
    setLoadingDrama(true);
    setSelectedDrama(null);
    try {
      const res = await fetch(`/api/app/kisskh/drama/${item.id}`, { credentials: 'include' });
      const data = await res.json();
      if (data && data.success && data.drama) {
        setSelectedDrama(data.drama);
      }
    } catch (err) {
      console.error('Failed to load drama details:', err);
    } finally {
      setLoadingDrama(false);
    }
  };

  // Play episode
  const handlePlayEpisode = async (
    drama: DramaDetail,
    ep: { id: number; episode_number: number; title: string; stream_url: string; backup_url?: string | null; subtitles_url: string }
  ) => {
    setPlayerTitle(`${drama.title} - ${ep.title}`);
    setPlayerStreamUrl(ep.stream_url);
    setPlayerBackupUrl(ep.backup_url || null);
    setPlayerOpen(true);

    // Fetch subtitles in background
    try {
      const subRes = await fetch(`/api/app/kisskh/subtitles?epId=${ep.id}`, { credentials: 'include' });
      const subData = await subRes.json();
      if (subData && subData.success && Array.isArray(subData.tracks)) {
        setSubtitles(subData.tracks);
      } else {
        setSubtitles([]);
      }
    } catch {
      setSubtitles([]);
    }
  };

  const handleCopyApiUrl = () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const apiUrl = `${origin}/api/app/kisskh/catalog`;
    navigator.clipboard.writeText(apiUrl);
    setCopiedApi(true);
    setTimeout(() => setCopiedApi(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#070707] text-[#EDEDED] flex flex-col font-sans selection:bg-[#E50914] selection:text-white" dir="rtl">
      <div className="flex flex-1">
        <Sidebar />

        <main className="flex-1 lg:pr-64 flex flex-col min-w-0">
          <Header
            title="دراما وآسيوية (KissKH VIP)"
            subtitle="المكتبة الشاملة للمسلسلات الكورية، الصينية، اليابانية، الأفلام، والأنمي"
          />

          <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto w-full">
            {/* VIP Header Banner */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#140808] via-[#0E0E0E] to-[#0A0A0A] border border-[#2E1010] p-6 md:p-8 shadow-2xl">
              <div className="absolute -left-10 -bottom-10 w-64 h-64 bg-[#E50914]/10 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute right-0 top-0 w-80 h-80 bg-[#B81D24]/10 rounded-full blur-3xl pointer-events-none" />

              <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#E50914]/15 border border-[#E50914]/30 text-[#FF5A5F] text-xs font-semibold">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>مكتبة الدراما والسينما الآسيوية الشاملة (KissKH VIP)</span>
                  </div>
                  <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
                    أضخم مكتبة مسلسلات وأفلام آسيوية (+13,000 عمل)
                  </h1>
                  <p className="text-xs md:text-sm text-[#A1A1AA] max-w-2xl leading-relaxed">
                    تصفح وشاهد كافة المسلسلات الكورية، الصينية، اليابانية، الأفلام، والأنمي من الألف إلى الياء.
                    إعادة بث مباشر فائقة السرعة تدعم مشغلات HLS مع ترجمات فورية متعددة اللغات.
                  </p>

                  <div className="flex flex-wrap items-center gap-3 pt-2 text-xs text-[#D4D4D8]">
                    <div className="px-3 py-1 rounded-lg bg-[#181818] border border-[#27272A] flex items-center gap-1.5 font-mono">
                      <Clapperboard className="w-3.5 h-3.5 text-[#E50914]" />
                      <span>{totalTitles.toLocaleString()} عمل متاح</span>
                    </div>
                    <div className="px-3 py-1 rounded-lg bg-[#181818] border border-[#27272A] flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-blue-400" />
                      <span>كوريا • الصين • اليابان • تايلاند</span>
                    </div>
                    <div className="px-3 py-1 rounded-lg bg-[#181818] border border-[#27272A] flex items-center gap-1.5">
                      <Subtitles className="w-3.5 h-3.5 text-emerald-400" />
                      <span>ترجمة عربي وإنجليزي تلقائية</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:w-auto">
                  <button
                    onClick={handleCopyApiUrl}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#1B1B1B] hover:bg-[#252525] border border-[#333333] text-xs font-medium text-white transition-all shadow-sm"
                  >
                    {copiedApi ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-[#A1A1AA]" />}
                    <span>{copiedApi ? 'تم نسخ رابط API !' : 'نسخ رابط الـ API المباشر'}</span>
                  </button>

                  <button
                    onClick={loadCatalog}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#E50914] hover:bg-[#B81D24] text-white text-xs font-semibold shadow-lg shadow-[#E50914]/25 transition-all"
                  >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    <span>تحديث القائمة</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Filter Tabs & Search Controls */}
            <div className="space-y-4">
              <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
                {/* Category Pills */}
                <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
                  {CATEGORY_TABS.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => {
                          setActiveTab(tab.id);
                          setPage(1);
                        }}
                        className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${
                          isActive
                            ? 'bg-[#E50914] text-white shadow-md shadow-[#E50914]/30'
                            : 'bg-[#121212] text-[#A1A1AA] hover:text-white hover:bg-[#1A1A1A] border border-[#222222]'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Sort dropdown */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#71717A] shrink-0">الترتيب:</span>
                  <select
                    value={order}
                    onChange={(e) => {
                      setOrder(parseInt(e.target.value, 10));
                      setPage(1);
                    }}
                    className="bg-[#121212] border border-[#27272A] text-xs text-[#EDEDED] rounded-xl px-3 py-2 outline-none focus:border-[#E50914]"
                  >
                    <option value={1}>الأكثر شهرة (Popular)</option>
                    <option value={2}>الأحدث تحديثاً (Latest)</option>
                    <option value={3}>تاريخ الإصدار (Release)</option>
                    <option value={4}>الأعلى تقييماً (Top Rated)</option>
                  </select>
                </div>
              </div>

              {/* Search Bar */}
              <div className="relative">
                <Search className="w-4 h-4 text-[#71717A] absolute right-4 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ابحث عن أي دراما كورية، صينية، أنمي، أو فيلم آسيوي (مثال: Queen of Tears, Solo Leveling, Hidden Love)..."
                  className="w-full bg-[#101010] border border-[#242424] rounded-xl pr-11 pl-10 py-3 text-xs md:text-sm text-white placeholder-[#52525B] outline-none focus:border-[#E50914] focus:ring-1 focus:ring-[#E50914] transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-[#71717A] hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Catalog Grid */}
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 space-y-3">
                <RefreshCw className="w-8 h-8 text-[#E50914] animate-spin" />
                <p className="text-xs text-[#A1A1AA]">جاري جلب أحدث الأعمال الآسيوية من السيرفر...</p>
              </div>
            ) : items.length === 0 ? (
              <div className="text-center py-20 bg-[#0E0E0E] rounded-2xl border border-[#1E1E1E] space-y-3">
                <Film className="w-12 h-12 text-[#52525B] mx-auto" />
                <h3 className="text-sm font-semibold text-white">لم يتم العثور على أي نتائج</h3>
                <p className="text-xs text-[#71717A]">جرّب كتابة اسم العمل باللغة الإنجليزية أو اختر قسماً آخر.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5 md:gap-4">
                {items.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => handleSelectDrama(item)}
                    className="group relative bg-[#101010] hover:bg-[#151515] rounded-xl overflow-hidden border border-[#1F1F1F] hover:border-[#E50914]/50 cursor-pointer transition-all duration-300 hover:shadow-xl hover:shadow-[#E50914]/10 hover:-translate-y-1 flex flex-col"
                  >
                    {/* Poster */}
                    <div className="relative aspect-[2/3] w-full overflow-hidden bg-[#181818]">
                      {item.thumbnail ? (
                        <img
                          src={item.thumbnail}
                          alt={item.title}
                          loading="lazy"
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          onError={(e) => {
                            // Fallback to raw thumbnail if proxy fails
                            if (item.raw_thumbnail && (e.target as HTMLImageElement).src !== item.raw_thumbnail) {
                              (e.target as HTMLImageElement).src = item.raw_thumbnail;
                            }
                          }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[#52525B]">
                          <Film className="w-8 h-8" />
                        </div>
                      )}

                      {/* Top Badges */}
                      <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
                        {item.type && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-black/80 backdrop-blur-md text-white border border-white/10">
                            {item.type === 'Movie' ? 'فيلم' : item.type === 'Anime' ? 'أنمي' : 'مسلسل'}
                          </span>
                        )}
                        {item.label && (
                          <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-[#E50914] text-white">
                            {item.label}
                          </span>
                        )}
                      </div>

                      {/* Bottom Episodes Pill */}
                      {item.episodes_count > 0 && (
                        <div className="absolute bottom-2 left-2">
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-black/75 backdrop-blur-md text-[#E4E4E7] border border-white/10">
                            {item.episodes_count} {item.episodes_count === 1 ? 'حلقة' : 'حلقات'}
                          </span>
                        </div>
                      )}

                      {/* Hover Play Overlay */}
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <div className="w-11 h-11 rounded-full bg-[#E50914] text-white flex items-center justify-center shadow-lg transform group-hover:scale-110 transition-transform">
                          <Play className="w-5 h-5 fill-white mr-0.5" />
                        </div>
                      </div>
                    </div>

                    {/* Meta info */}
                    <div className="p-2.5 flex-1 flex flex-col justify-between">
                      <h4 className="text-xs font-semibold text-white line-clamp-2 leading-tight group-hover:text-[#FF5A5F] transition-colors">
                        {item.title}
                      </h4>
                      <div className="mt-2 flex items-center justify-between text-[10px] text-[#71717A]">
                        <span>KissKH VIP</span>
                        <span className="text-emerald-400 font-medium">مترجم</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Pagination Controls */}
            {!debouncedSearch && totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-6 pb-12">
                <button
                  disabled={page <= 1 || loading}
                  onClick={() => {
                    setPage((prev) => Math.max(1, prev - 1));
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#141414] hover:bg-[#1E1E1E] disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium border border-[#27272A] transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                  <span>السابق</span>
                </button>

                <div className="px-4 py-2 rounded-xl bg-[#101010] border border-[#222222] text-xs font-mono text-[#D4D4D8]">
                  صفحة <span className="text-white font-bold">{page}</span> من{' '}
                  <span className="text-[#A1A1AA]">{totalPages.toLocaleString()}</span>
                </div>

                <button
                  disabled={page >= totalPages || loading}
                  onClick={() => {
                    setPage((prev) => prev + 1);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#141414] hover:bg-[#1E1E1E] disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium border border-[#27272A] transition-colors"
                >
                  <span>التالي</span>
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Episode Details Drawer / Modal */}
      {(selectedDrama || loadingDrama) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-3xl bg-[#0E0E0E] border border-[#2A2A2A] rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 md:p-5 border-b border-[#202020] bg-[#121212]">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#E50914]" />
                <h3 className="text-sm md:text-base font-bold text-white truncate max-w-md">
                  {selectedDrama?.title || 'جاري تحميل تفاصيل العمل...'}
                </h3>
              </div>
              <button
                onClick={() => setSelectedDrama(null)}
                className="p-1.5 rounded-lg text-[#71717A] hover:text-white hover:bg-[#202020] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            {loadingDrama ? (
              <div className="flex flex-col items-center justify-center py-24 space-y-3">
                <RefreshCw className="w-8 h-8 text-[#E50914] animate-spin" />
                <p className="text-xs text-[#A1A1AA]">جاري جلب تفاصيل الحلقات وروابط البث...</p>
              </div>
            ) : selectedDrama ? (
              <div className="p-4 md:p-6 overflow-y-auto space-y-6">
                {/* Meta Hero */}
                <div className="flex flex-col sm:flex-row gap-5 items-start">
                  <div className="w-32 sm:w-40 aspect-[2/3] rounded-xl overflow-hidden bg-[#1A1A1A] shrink-0 border border-[#2E2E2E] shadow-lg">
                    <img
                      src={selectedDrama.thumbnail}
                      alt={selectedDrama.title}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        if (selectedDrama.raw_thumbnail) {
                          (e.target as HTMLImageElement).src = selectedDrama.raw_thumbnail;
                        }
                      }}
                    />
                  </div>

                  <div className="flex-1 space-y-3">
                    <h2 className="text-lg md:text-xl font-bold text-white leading-tight">
                      {selectedDrama.title}
                    </h2>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="px-2.5 py-1 rounded-lg bg-[#E50914]/15 border border-[#E50914]/30 text-[#FF5A5F] font-semibold">
                        {selectedDrama.type}
                      </span>
                      <span className="px-2.5 py-1 rounded-lg bg-[#181818] border border-[#27272A] text-[#D4D4D8]">
                        الدولة: {selectedDrama.country}
                      </span>
                      <span className="px-2.5 py-1 rounded-lg bg-[#181818] border border-[#27272A] text-emerald-400">
                        {selectedDrama.status}
                      </span>
                      {selectedDrama.release_date && (
                        <span className="px-2.5 py-1 rounded-lg bg-[#181818] border border-[#27272A] text-[#A1A1AA]">
                          {selectedDrama.release_date}
                        </span>
                      )}
                    </div>

                    {selectedDrama.description && (
                      <p className="text-xs text-[#A1A1AA] leading-relaxed line-clamp-4">
                        {selectedDrama.description}
                      </p>
                    )}
                  </div>
                </div>

                {/* Episodes Grid */}
                <div className="space-y-3 pt-2 border-t border-[#1C1C1C]">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs md:text-sm font-bold text-white flex items-center gap-2">
                      <Tv className="w-4 h-4 text-[#E50914]" />
                      <span>قائمة الحلقات المتاحة ({selectedDrama.episodes?.length || 0})</span>
                    </h4>
                    <span className="text-[11px] text-[#71717A]">اضغط على أي حلقة لتشغيل البث الفوري</span>
                  </div>

                  {selectedDrama.episodes && selectedDrama.episodes.length > 0 ? (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 max-h-64 overflow-y-auto p-1">
                      {selectedDrama.episodes.map((ep) => (
                        <button
                          key={ep.id}
                          onClick={() => handlePlayEpisode(selectedDrama, ep)}
                          className="group flex flex-col items-center justify-center py-3 px-2 rounded-xl bg-[#141414] hover:bg-[#E50914] border border-[#222222] hover:border-[#E50914] text-white transition-all shadow-sm"
                        >
                          <Play className="w-4 h-4 mb-1 text-[#A1A1AA] group-hover:text-white group-hover:fill-white transition-colors" />
                          <span className="text-xs font-semibold">{ep.title}</span>
                          <span className="text-[9px] text-[#71717A] group-hover:text-white/80 font-mono mt-0.5">
                            {ep.subtitles_count > 0 ? `${ep.subtitles_count} ترجمات` : 'HLS VIP'}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="p-6 text-center text-xs text-[#71717A] bg-[#121212] rounded-xl border border-[#222222]">
                      لا توجد حلقات متاحة حالياً لهذا العمل
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Built-in HLS Player Modal */}
      <HlsPlayerModal
        isOpen={playerOpen}
        onClose={() => setPlayerOpen(false)}
        streamUrl={playerStreamUrl}
        backupUrl={playerBackupUrl}
        channelName={playerTitle}
        subtitles={subtitles}
      />
    </div>
  );
}
