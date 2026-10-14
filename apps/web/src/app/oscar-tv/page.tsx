'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { HlsPlayerModal } from '@/components/player/hls-player';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api-client';
import { Channel, StreamProbeInfo } from '@aspreen/shared';
import {
  Sparkles,
  Search,
  Play,
  Square,
  KeyRound,
  RefreshCw,
  Copy,
  Check,
  Download,
  Radio,
  Tv,
  ExternalLink,
  ShieldCheck,
  Activity,
  Code2,
  Sliders,
} from 'lucide-react';

export default function OscarTvPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [bulkStarting, setBulkStarting] = useState(false);
  const [bulkStopping, setBulkStopping] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');

  // Player preview modal
  const [playerModalOpen, setPlayerModalOpen] = useState(false);
  const [activePlayerUrl, setActivePlayerUrl] = useState('');
  const [activePlayerName, setActivePlayerName] = useState('');

  // API Integration Modal
  const [apiModalOpen, setApiModalOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  // Token Modal
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [tokenName, setTokenName] = useState('');
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [generatingToken, setGeneratingToken] = useState(false);

  const fetchOscarChannels = async (autoSyncIfEmpty = true) => {
    try {
      const allChannels = await api.getChannels();
      // Strictly filter for genuine Oscar TV channels ONLY (sourceId === 'oscar-tv-live')
      let oscarOnly = allChannels.filter(
        (c) =>
          c.sourceId === 'oscar-tv-live' ||
          c.externalIdentifier?.startsWith('oscar-')
      );

      // If no Oscar channels exist yet in DB, trigger auto-sync once
      if (oscarOnly.length === 0 && autoSyncIfEmpty) {
        try {
          await api.syncOscarChannels();
          const refreshed = await api.getChannels();
          oscarOnly = refreshed.filter(
            (c) =>
              c.sourceId === 'oscar-tv-live' ||
              c.externalIdentifier?.startsWith('oscar-')
          );
        } catch {}
      }

      setChannels(oscarOnly);
    } catch (err) {
      console.error('Failed to fetch Oscar channels:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }
    if (user) {
      fetchOscarChannels();
    }
  }, [user, authLoading, router]);

  const handleSyncOscar = async () => {
    setSyncing(true);
    try {
      await api.syncOscarChannels();
      await fetchOscarChannels();
    } catch (err: any) {
      alert(`فشل التحديث: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleBulkStart = async () => {
    setBulkStarting(true);
    try {
      await api.bulkStartChannels({ preset: 'COPY' });
      await fetchOscarChannels();
    } catch (err: any) {
      alert(`خطأ في تشغيل البث: ${err.message}`);
    } finally {
      setBulkStarting(false);
    }
  };

  const handleBulkStop = async () => {
    setBulkStopping(true);
    try {
      await api.bulkStopChannels('oscar-tv-live');
      await fetchOscarChannels();
    } catch (err: any) {
      alert(`خطأ في الإيقاف: ${err.message}`);
    } finally {
      setBulkStopping(false);
    }
  };

  const handlePlayPreview = async (ch: Channel) => {
    try {
      const res = await api.createStreamToken(ch.id, {
        name: `Preview - ${ch.name}`,
        lifetimeHours: 1,
      });
      setActivePlayerUrl(res.playbackUrl);
      setActivePlayerName(ch.name);
      setPlayerModalOpen(true);
    } catch (err: any) {
      alert(`تعذر تشغيل المعاينة: ${err.message}`);
    }
  };

  const handleCreateToken = async () => {
    if (!selectedChannel) return;
    setGeneratingToken(true);
    try {
      const res = await api.createStreamToken(selectedChannel.id, {
        name: tokenName || `User Link - ${selectedChannel.name}`,
      });
      setGeneratedLink(res.playbackUrl);
    } catch (err: any) {
      alert(`فشل إنشاء الرابط: ${err.message}`);
    } finally {
      setGeneratingToken(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedLink(id);
    setTimeout(() => setCopiedLink(null), 2500);
  };

  // Categories
  const groups = Array.from(new Set(channels.map((c) => c.groupTitle || 'أخرى'))).filter(Boolean);

  // Filtered
  const filteredChannels = channels.filter((ch) => {
    const matchesSearch =
      ch.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (ch.groupTitle && ch.groupTitle.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesGroup = selectedGroup === 'all' || ch.groupTitle === selectedGroup;
    return matchesSearch && matchesGroup;
  });

  const apiHost = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const m3uUrl = `${apiHost}/api/app/oscar/playlist.m3u`;
  const jsonUrl = `${apiHost}/api/app/oscar/channels`;

  return (
    <div className="min-h-screen bg-[#070707] text-[#EDEDED] flex">
      <Sidebar />

      <main className="flex-1 ml-64 flex flex-col min-h-screen">
        <Header title="قنوات أوسكار تي في (Oscar TV)" />

        <div className="p-8 space-y-6 max-w-7xl mx-auto w-full">
          {/* Hero Banner */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#141419] via-[#0E0E12] to-[#141419] border border-[#23232C] p-7 shadow-2xl">
            <div className="absolute top-0 right-0 w-96 h-96 bg-[#8B5CF6]/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-80 h-80 bg-[#3B82F6]/10 rounded-full blur-3xl pointer-events-none" />

            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#8B5CF6]/15 border border-[#8B5CF6]/30 text-[#C4B5FD] text-xs font-semibold tracking-wide">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>قسم قنوات أوسكار تي في الحصري (Oscar TV Hub)</span>
                </div>
                <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white">
                  قنوات أوسكار تي في المباشرة
                </h1>
                <p className="text-sm text-[#A1A1AA] max-w-2xl leading-relaxed">
                  قنوات مفكوكة التشفير بنسبة 100% وبث Full HD حي ومباشر يتم التقاطه من تطبيق أوسكار تلقائياً وإعادة بثه لزوار موقعك وتطبيق الأندرويد.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleSyncOscar}
                  disabled={syncing}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#6D28D9] hover:from-[#7C3AED] hover:to-[#5B21B6] text-white text-xs font-semibold shadow-lg shadow-purple-500/20 transition-all active:scale-95 disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                  <span>{syncing ? 'جارٍ المزامنة...' : '🔄 مزامنة القنوات من أوسكار'}</span>
                </button>

                <button
                  onClick={handleBulkStart}
                  disabled={bulkStarting}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1E1E24] hover:bg-[#282832] border border-[#33333F] text-white text-xs font-semibold transition-all active:scale-95"
                >
                  <Play className="w-4 h-4 text-emerald-400" />
                  <span>{bulkStarting ? 'جارٍ التشغيل...' : 'تشغيل البث الحي (COPY)'}</span>
                </button>

                <button
                  onClick={() => setApiModalOpen(true)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1E1E24] hover:bg-[#282832] border border-[#33333F] text-[#E0E7FF] text-xs font-semibold transition-all active:scale-95"
                >
                  <Code2 className="w-4 h-4 text-[#818CF8]" />
                  <span>🔗 روابط الـ API وتطبيق الأندرويد</span>
                </button>
              </div>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-[#23232C]">
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-[#71717A] uppercase tracking-wider">إجمالي القنوات</span>
                <p className="text-xl font-black text-white">{channels.length} قناة</p>
              </div>
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-[#71717A] uppercase tracking-wider">الحالة</span>
                <p className="text-xl font-black text-emerald-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  ONLINE 100%
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-[#71717A] uppercase tracking-wider">جودة البث</span>
                <p className="text-xl font-black text-white">Full HD 1080p</p>
              </div>
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-[#71717A] uppercase tracking-wider">فك التشفير</span>
                <p className="text-xl font-black text-[#A78BFA] flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4" />
                  مفكوكة تلقائياً
                </p>
              </div>
            </div>
          </div>

          {/* Search & Category Filter Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-[#111116] border border-[#22222B] p-3 rounded-xl">
            <div className="relative w-full sm:w-80">
              <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#71717A]" />
              <input
                type="text"
                placeholder="ابحث عن قناة في أوسكار تي في..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#17171F] border border-[#2B2B38] rounded-lg pl-3 pr-10 py-2 text-xs text-white placeholder-[#71717A] focus:outline-none focus:border-[#8B5CF6] transition-colors"
              />
            </div>

            {/* Category Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0 scrollbar-none">
              <button
                onClick={() => setSelectedGroup('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 ${
                  selectedGroup === 'all'
                    ? 'bg-[#8B5CF6] text-white shadow-sm'
                    : 'bg-[#181820] text-[#A1A1AA] hover:text-white hover:bg-[#20202B]'
                }`}
              >
                جميع القنوات ({channels.length})
              </button>
              {groups.map((grp) => (
                <button
                  key={grp}
                  onClick={() => setSelectedGroup(grp)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 ${
                    selectedGroup === grp
                      ? 'bg-[#8B5CF6] text-white shadow-sm'
                      : 'bg-[#181820] text-[#A1A1AA] hover:text-white hover:bg-[#20202B]'
                  }`}
                >
                  {grp}
                </button>
              ))}
            </div>
          </div>

          {/* Channels Grid */}
          {loading ? (
            <div className="text-center py-20 text-[#71717A]">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-[#8B5CF6]" />
              <p>جارٍ تحميل قنوات أوسكار تي في...</p>
            </div>
          ) : filteredChannels.length === 0 ? (
            <div className="text-center py-16 bg-[#111116] border border-[#22222B] rounded-2xl p-8 space-y-4">
              <Tv className="w-12 h-12 mx-auto text-[#71717A]" />
              <h3 className="text-base font-bold text-white">لم يتم العثور على قنوات تطابق البحث</h3>
              <p className="text-xs text-[#71717A] max-w-md mx-auto">
                اضغط على زر "مزامنة القنوات من أوسكار" لسحب جميع القنوات الجديدة المسجلة في ملف المراقبة الذكي.
              </p>
              <button
                onClick={handleSyncOscar}
                className="px-4 py-2 rounded-xl bg-[#8B5CF6] text-white text-xs font-semibold hover:bg-[#7C3AED] transition-colors"
              >
                مزامنة الآن
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredChannels.map((ch) => {
                const isRunning = ch.transcodingStatus === 'RUNNING';
                return (
                  <div
                    key={ch.id}
                    className="group relative bg-[#121217] hover:bg-[#16161D] border border-[#23232C] hover:border-[#3B3B48] rounded-xl p-4 transition-all duration-200 flex flex-col justify-between space-y-4 hover:shadow-xl hover:shadow-black/50"
                  >
                    {/* Top Row: Logo & Badges */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="w-12 h-12 rounded-lg bg-[#1A1A22] border border-[#2B2B38] p-1.5 flex items-center justify-center shrink-0 overflow-hidden">
                        {ch.logoUrl ? (
                          <img
                            src={ch.logoUrl}
                            alt={ch.name}
                            className="w-full h-full object-contain"
                            loading="lazy"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <Tv className="w-6 h-6 text-[#71717A]" />
                        )}
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          ONLINE
                        </span>
                        <span className="text-[10px] text-[#A1A1AA] bg-[#1E1E26] px-2 py-0.5 rounded border border-[#2D2D38]">
                          {ch.groupTitle || 'أوسكار'}
                        </span>
                      </div>
                    </div>

                    {/* Middle: Channel Info */}
                    <div>
                      <h4 className="text-sm font-bold text-white group-hover:text-[#A78BFA] transition-colors truncate">
                        {ch.name}
                      </h4>
                      <p className="text-[11px] text-[#71717A] mt-0.5 font-mono">
                        {ch.preset || 'COPY'} • HLS 1080p
                      </p>
                    </div>

                    {/* Bottom: Action Buttons */}
                    <div className="pt-3 border-t border-[#23232C] flex items-center justify-between gap-2">
                      <button
                        onClick={() => handlePlayPreview(ch)}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#8B5CF6]/15 hover:bg-[#8B5CF6] text-[#C4B5FD] hover:text-white text-xs font-semibold border border-[#8B5CF6]/30 hover:border-[#8B5CF6] transition-all"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>مشاهدة</span>
                      </button>

                      <button
                        onClick={() => {
                          setSelectedChannel(ch);
                          setGeneratedLink(null);
                          setTokenModalOpen(true);
                        }}
                        title="إنشاء رابط بث مباشر"
                        className="p-1.5 rounded-lg bg-[#1C1C24] hover:bg-[#252530] text-[#A1A1AA] hover:text-white border border-[#2B2B38] transition-colors"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Video Preview Modal */}
      {playerModalOpen && (
        <HlsPlayerModal
          isOpen={playerModalOpen}
          onClose={() => setPlayerModalOpen(false)}
          streamUrl={activePlayerUrl}
          channelName={activePlayerName}
        />
      )}

      {/* API & Android Links Modal */}
      {apiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#121217] border border-[#282835] rounded-2xl max-w-xl w-full p-6 space-y-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#23232C] pb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#8B5CF6]/20 border border-[#8B5CF6]/40 flex items-center justify-center text-[#A78BFA]">
                  <Code2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">روابط الـ API وتطبيق الأندرويد</h3>
                  <p className="text-xs text-[#71717A]">استخدم هذه الروابط لربط قنوات أوسكار بتطبيقك أو موقعك الخارجي</p>
                </div>
              </div>
              <button
                onClick={() => setApiModalOpen(false)}
                className="text-[#71717A] hover:text-white p-1 rounded-lg hover:bg-[#1E1E26]"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {/* M3U8 Playlist URL */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#A1A1AA] flex items-center justify-between">
                  <span>📥 رابط قائمة التشغيل M3U8 (لـ VLC وتطبيقات IPTV والأندرويد):</span>
                  <span className="text-[10px] text-emerald-400">تحديث حي ومباشر</span>
                </label>
                <div className="flex items-center gap-2 bg-[#0A0A0D] border border-[#23232C] rounded-xl p-2.5">
                  <input
                    type="text"
                    readOnly
                    value={m3uUrl}
                    className="flex-1 bg-transparent text-xs text-white font-mono focus:outline-none"
                  />
                  <button
                    onClick={() => copyToClipboard(m3uUrl, 'm3u')}
                    className="p-2 rounded-lg bg-[#1F1F2A] hover:bg-[#2A2A38] text-white text-xs flex items-center gap-1.5 transition-colors"
                  >
                    {copiedLink === 'm3u' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedLink === 'm3u' ? 'تم النسخ!' : 'نسخ'}</span>
                  </button>
                </div>
              </div>

              {/* JSON Feed URL */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#A1A1AA] flex items-center justify-between">
                  <span>📱 رابط JSON API المباشر (لتطبيق هاتفك ومواقعك الأخرى):</span>
                  <span className="text-[10px] text-[#818CF8]">يدعم اللوجو والفئات</span>
                </label>
                <div className="flex items-center gap-2 bg-[#0A0A0D] border border-[#23232C] rounded-xl p-2.5">
                  <input
                    type="text"
                    readOnly
                    value={jsonUrl}
                    className="flex-1 bg-transparent text-xs text-white font-mono focus:outline-none"
                  />
                  <button
                    onClick={() => copyToClipboard(jsonUrl, 'json')}
                    className="p-2 rounded-lg bg-[#1F1F2A] hover:bg-[#2A2A38] text-white text-xs flex items-center gap-1.5 transition-colors"
                  >
                    {copiedLink === 'json' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedLink === 'json' ? 'تم النسخ!' : 'نسخ'}</span>
                  </button>
                </div>
              </div>

              {/* Instruction Note */}
              <div className="bg-[#181822] border border-[#2A2A3A] rounded-xl p-3.5 text-xs text-[#A1A1AA] space-y-1.5 leading-relaxed">
                <p className="font-semibold text-white">💡 كيفية الاستخدام:</p>
                <p>1. **تطبيقات الأندرويد و IPTV:** فقط ضع رابط الـ M3U8 أعلاه وسيقوم التطبيق بتحميل القنوات بشعاراتها فوراً.</p>
                <p>2. **موقعك الإلكتروني الآخر:** يمكنك استدعاء رابط الـ JSON لتحصل على مصفوفة القنوات مع روابط البث الجاهزة بدون أي تشفير أو تعقيدات.</p>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setApiModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-[#23232C] hover:bg-[#2E2E3A] text-white text-xs font-semibold transition-colors"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Token Link Generation Modal */}
      {tokenModalOpen && selectedChannel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#121217] border border-[#282835] rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#23232C] pb-3">
              <h3 className="text-base font-bold text-white">إنشاء رابط بث: {selectedChannel.name}</h3>
              <button
                onClick={() => setTokenModalOpen(false)}
                className="text-[#71717A] hover:text-white p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-[#A1A1AA] block mb-1">اسم الرابط / الملاحظة (اختياري):</label>
                <input
                  type="text"
                  placeholder="مثلاً: رابط الأندرويد أو رابط خارجي"
                  value={tokenName}
                  onChange={(e) => setTokenName(e.target.value)}
                  className="w-full bg-[#181820] border border-[#2C2C3A] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#8B5CF6]"
                />
              </div>

              {generatedLink && (
                <div className="space-y-1.5 pt-2">
                  <span className="text-xs font-semibold text-emerald-400">✓ تم إنشاء رابط البث بنجاح:</span>
                  <div className="flex items-center gap-2 bg-[#0A0A0D] border border-[#23232C] rounded-lg p-2">
                    <input
                      type="text"
                      readOnly
                      value={generatedLink}
                      className="flex-1 bg-transparent text-xs text-white font-mono focus:outline-none"
                    />
                    <button
                      onClick={() => copyToClipboard(generatedLink, 'single-link')}
                      className="p-1.5 rounded bg-[#1F1F2A] hover:bg-[#2A2A38] text-white text-xs flex items-center gap-1"
                    >
                      {copiedLink === 'single-link' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedLink === 'single-link' ? 'تم!' : 'نسخ'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#23232C]">
              <button
                onClick={() => setTokenModalOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-[#A1A1AA] hover:text-white"
              >
                إغلاق
              </button>
              <button
                onClick={handleCreateToken}
                disabled={generatingToken}
                className="px-4 py-2 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {generatingToken ? 'جارٍ الإنشاء...' : 'توليد الرابط'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
