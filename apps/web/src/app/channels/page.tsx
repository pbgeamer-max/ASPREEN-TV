'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api-client';
import { Channel, Source, TranscodingPresetId, StreamProbeInfo, ExportLinksResult } from '@aspreen/shared';
import {
  Tv,
  Search,
  Play,
  Square,
  KeyRound,
  Eye,
  Info,
  Sliders,
  Copy,
  Check,
  X,
  AlertCircle,
  Radio,
  Download,
  FileText,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Image as ImageIcon,
  AlertTriangle,
  Pause,
  ShieldCheck,
  Zap,
} from 'lucide-react';

export default function ChannelsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [channelFilterTab, setChannelFilterTab] = useState<'ALL' | 'BEIN' | 'LIVE' | 'NO_EVENT'>('ALL');

  // beIN Sports VIP controls & limits (Strict 2 Max Channels)
  const [beinStatus, setBeinStatus] = useState<{
    activeCount: number;
    maxLimit: number;
    activeChannels: { id: string; name: string }[];
  }>({ activeCount: 2, maxLimit: 2, activeChannels: [] });
  const [limitWarningModal, setLimitWarningModal] = useState<{
    open: boolean;
    channelName: string;
    activeNames: string[];
    pendingChannelId?: string;
  }>({ open: false, channelName: '', activeNames: [] });
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [broadcastTogglingId, setBroadcastTogglingId] = useState<string | null>(null);

  // Stream Links & Distribution modal
  const [linksModalOpen, setLinksModalOpen] = useState(false);
  const [selectedChannelForLinks, setSelectedChannelForLinks] = useState<Channel | null>(null);
  const [copiedChannelId, setCopiedChannelId] = useState<string | null>(null);
  const [copiedServerKey, setCopiedServerKey] = useState<string | null>(null);



  // Inspect modal
  const [inspectModalOpen, setInspectModalOpen] = useState(false);
  const [probeInfo, setProbeInfo] = useState<StreamProbeInfo | null>(null);
  const [inspectingName, setInspectingName] = useState('');
  const [inspectLoading, setInspectLoading] = useState(false);

  // Token creation modal
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [tokenChannelId, setTokenChannelId] = useState<string | null>(null);
  const [tokenChannelName, setTokenChannelName] = useState('');
  const [tokenName, setTokenName] = useState('');
  const [tokenLifetime, setTokenLifetime] = useState(0);
  const [generatedResult, setGeneratedResult] = useState<{
    rawToken: string;
    playbackUrl: string;
    tsPlaybackUrl?: string;
  } | null>(null);
  const [copiedType, setCopiedType] = useState<'hls' | 'ts' | null>(null);

  // Transcoding actions
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Bulk operations state
  const [bulkStarting, setBulkStarting] = useState(false);
  const [bulkStopping, setBulkStopping] = useState(false);
  const [bulkResultModal, setBulkResultModal] = useState<{
    open: boolean;
    title: string;
    message: string;
    details?: string[];
  }>({ open: false, title: '', message: '' });

  // Export links state
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportResult, setExportResult] = useState<ExportLinksResult | null>(null);
  const [activeExportTab, setActiveExportTab] = useState<'TXT' | 'M3U'>('TXT');
  const [copiedExport, setCopiedExport] = useState(false);


  const isBein = (ch: Channel) => {
    const id = (ch.id || '').toLowerCase();
    const name = (ch.name || '').toLowerCase();
    const grp = (ch.groupTitle || '').toLowerCase();
    return id.includes('bein') || name.includes('bein') || grp.includes('bein');
  };

  const activeBeinChannels = useMemo(() => {
    return channels.filter(
      (c) =>
        isBein(c) &&
        c.inputStatus !== 'OFFLINE' &&
        (c as any).status !== 'event_only'
    );
  }, [channels]);

  const activeBeinCount = activeBeinChannels.length;

  const fetchChannels = async () => {
    setLoading(true);
    try {
      // 1. Fetch from high-speed public app channels API
      const res = await fetch(`/api/app/channels?limit=5000&_t=${Date.now()}`, {
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
      });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.channels) && data.channels.length > 0) {
          const mapped: Channel[] = data.channels.map((c: any) => {
            const isNoEvent = c.status === 'OFFLINE' || c.event_status === 'no_event';
            return {
              id: c.id,
              sourceId: c.sourceId || (String(c.id).startsWith('tlfaz-') ? 'tlfaz-arabic' : 'private-vip'),
              name: c.name,
              normalizedName: (c.name || '').toLowerCase(),
              groupTitle: c.group || c.category || 'عام',
              logoUrl: c.raw_logo || (c.logo && !c.logo.includes('/image-proxy') ? c.logo : (c.raw_logo || c.logo || '')),
              inputType: 'HLS',
              inputStatus: isNoEvent ? 'OFFLINE' : 'ONLINE',
              preset: 'COPY',
              transcodingStatus: isNoEvent ? 'STOPPED' : 'RUNNING',
              orderIndex: c.order || 0,
              enabled: true,
              servers: c.servers || undefined,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              status: isNoEvent ? 'event_only' : 'live',
              status_message: c.status_message || (isNoEvent ? 'لا يوجد حدث حالياً' : 'بث مباشر فائق الدقة'),
              is_live: !isNoEvent,
            } as any;
          });

          setChannels(mapped);
          setLoading(false);

          fetch(`/api/channels/bein-status?_t=${Date.now()}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((bData) => {
              if (bData && typeof bData.activeCount === 'number') {
                setBeinStatus(bData);
              }
            })
            .catch(() => {});
          return;
        }
      }

      // 2. Fallback to admin api if user is authenticated
      const data = await api.getChannels({
        sourceId: selectedSourceId || undefined,
        group: selectedGroup || undefined,
        q: searchQuery || undefined,
      });
      setChannels(data);
    } catch (err) {
      console.error('Failed to load channels:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleBroadcast = async (ch: Channel, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const isCurrentlyLive = ch.inputStatus !== 'OFFLINE' && (ch as any).status !== 'event_only';
    const willBeLive = !isCurrentlyLive;

    // Strict Limit Enforcement for beIN Sports (Max 2 channels)
    if (willBeLive && isBein(ch)) {
      if (activeBeinCount >= 2 && !activeBeinChannels.some((c) => c.id === ch.id)) {
        setLimitWarningModal({
          open: true,
          channelName: ch.name,
          activeNames: activeBeinChannels.map((c) => c.name),
          pendingChannelId: ch.id,
        });
        return;
      }
    }

    setBroadcastTogglingId(ch.id);

    // Optimistic UI update
    setChannels((prev) =>
      prev.map((c) => {
        if (c.id === ch.id) {
          return {
            ...c,
            inputStatus: willBeLive ? 'ONLINE' : 'OFFLINE',
            transcodingStatus: willBeLive ? 'RUNNING' : 'STOPPED',
            status: willBeLive ? 'live' : 'event_only',
            status_message: willBeLive ? 'بث مباشر فائق الدقة' : 'لا يوجد حدث حالياً',
            is_live: willBeLive,
          } as any;
        }
        return c;
      })
    );

    try {
      const res = await api.toggleChannelBroadcast(ch.id, willBeLive);
      if (res && res.activeBeinChannels) {
        setBeinStatus({
          activeCount: res.activeBeinCount,
          maxLimit: 2,
          activeChannels: res.activeBeinChannels,
        });
      }
      setToastMessage(
        willBeLive
          ? `🟢 تم تشغيل بث (${ch.name}) بنجاح. القنوات النشطة: ${willBeLive ? activeBeinCount + 1 : activeBeinCount}/2`
          : `⏸️ تم إيقاف بث (${ch.name}). يظهر الآن "لا يوجد حدث" في موقع العرض وتطبيق الأندرويد.`
      );
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err: any) {
      // Revert on error
      setChannels((prev) =>
        prev.map((c) => {
          if (c.id === ch.id) {
            return {
              ...c,
              inputStatus: isCurrentlyLive ? 'ONLINE' : 'OFFLINE',
              transcodingStatus: isCurrentlyLive ? 'RUNNING' : 'STOPPED',
              status: isCurrentlyLive ? 'live' : 'event_only',
              status_message: isCurrentlyLive ? 'بث مباشر فائق الدقة' : 'لا يوجد حدث حالياً',
              is_live: isCurrentlyLive,
            } as any;
          }
          return c;
        })
      );
      if (err.message && err.message.includes('BEIN_LIMIT_REACHED')) {
        setLimitWarningModal({
          open: true,
          channelName: ch.name,
          activeNames: activeBeinChannels.map((c) => c.name),
          pendingChannelId: ch.id,
        });
      } else {
        alert(`فشل تحديث حالة البث: ${err.message}`);
      }
    } finally {
      setBroadcastTogglingId(null);
    }
  };

  const handleSwitchBeinChannel = async (channelToStopId: string, channelToStartId: string) => {
    setLimitWarningModal((prev) => ({ ...prev, open: false }));
    setBroadcastTogglingId(channelToStartId);

    try {
      // 1. Stop the active channel
      await api.toggleChannelBroadcast(channelToStopId, false);
      // 2. Start the pending channel
      const res = await api.toggleChannelBroadcast(channelToStartId, true);
      if (res && res.activeBeinChannels) {
        setBeinStatus({
          activeCount: res.activeBeinCount,
          maxLimit: 2,
          activeChannels: res.activeBeinChannels,
        });
      }
      await fetchChannels();
      setToastMessage(`🔄 تم استبدال القناة وتشغيل (${limitWarningModal.channelName}) بنجاح`);
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err: any) {
      alert(`فشل استبدال القناة: ${err.message}`);
      fetchChannels();
    } finally {
      setBroadcastTogglingId(null);
    }
  };

  const fetchSources = async () => {
    try {
      const data = await api.getSources();
      setSources(data);
    } catch {}
  };

  useEffect(() => {
    fetchChannels();
    if (user) {
      fetchSources();
    }
  }, [user, selectedSourceId, selectedGroup]);

  // Periodic background status refresh every 15 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetch(`/api/app/channels?limit=5000&_t=${Date.now()}`, {
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && Array.isArray(data.channels) && data.channels.length > 0) {
            setChannels((prev) => {
              if (prev.length === 0) return prev;
              return prev; // keep stable
            });
          }
        })
        .catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleStart = async (channelId: string) => {
    setActionInProgress(channelId);
    setChannels((prev) =>
      prev.map((c) => (c.id === channelId ? { ...c, transcodingStatus: 'RUNNING' } : c))
    );
    try {
      await api.startChannel(channelId);
    } catch (err: any) {
      alert(`Start failed: ${err.message}`);
      setChannels((prev) =>
        prev.map((c) => (c.id === channelId ? { ...c, transcodingStatus: 'STOPPED' } : c))
      );
    } finally {
      setActionInProgress(null);
    }
  };

  const handleStop = async (channelId: string) => {
    setActionInProgress(channelId);
    setChannels((prev) =>
      prev.map((c) => (c.id === channelId ? { ...c, transcodingStatus: 'STOPPED' } : c))
    );
    try {
      await api.stopChannel(channelId);
    } catch (err: any) {
      alert(`Stop failed: ${err.message}`);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleInspect = async (channel: Channel) => {
    setInspectModalOpen(true);
    setInspectingName(channel.name);
    setProbeInfo(null);
    setInspectLoading(true);

    try {
      const res = await api.inspectChannel(channel.id);
      setProbeInfo(res.probe);
    } catch (err: any) {
      alert(`Inspection failed: ${err.message}`);
      setInspectModalOpen(false);
    } finally {
      setInspectLoading(false);
    }
  };

  const handleOpenTokenModal = (channel: Channel) => {
    setTokenChannelId(channel.id);
    setTokenChannelName(channel.name);
    setTokenName(`Token for ${channel.name}`);
    setTokenLifetime(0);
    setGeneratedResult(null);
    setCopiedType(null);
    setTokenModalOpen(true);
  };

  const handleGenerateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenChannelId) return;

    try {
      const res = await api.createStreamToken(tokenChannelId, {
        name: tokenName,
        lifetimeHours: tokenLifetime,
      });
      setGeneratedResult({
        rawToken: res.rawToken,
        playbackUrl: res.playbackUrl,
        tsPlaybackUrl: res.tsPlaybackUrl,
      });
    } catch (err: any) {
      alert(`Token generation failed: ${err.message}`);
    }
  };

  const handleOpenStreamLinks = (channel: Channel) => {
    setSelectedChannelForLinks(channel);
    setLinksModalOpen(true);
  };



  const handleBulkStart = async () => {
    const targetDesc = selectedSourceId ? 'all channels in selected source' : 'ALL channels';
    if (!confirm(`Are you sure you want to start ${targetDesc} using Compatible Stream Copy mode?`)) {
      return;
    }
    setBulkStarting(true);
    // Instantly update UI status so user sees change without refresh!
    setChannels((prev) =>
      prev.map((c) =>
        !selectedSourceId || c.sourceId === selectedSourceId
          ? { ...c, transcodingStatus: 'RUNNING' }
          : c
      )
    );
    try {
      const res = await api.bulkStartChannels({
        sourceId: selectedSourceId || undefined,
        preset: 'COPY',
      });
      setBulkResultModal({
        open: true,
        title: 'Bulk Transcoding Initiated',
        message: `Processed ${res.totalTargeted} channels:\n• Newly Started: ${res.startedCount}\n• Already Running: ${res.alreadyRunningCount}\n• Skipped (Limit): ${res.skippedCount}`,
        details: res.errors && res.errors.length > 0 ? res.errors : undefined,
      });
    } catch (err: any) {
      alert(`Bulk start failed: ${err.message}`);
      fetchChannels();
    } finally {
      setBulkStarting(false);
    }
  };

  const handleBulkStop = async () => {
    const targetDesc = selectedSourceId ? 'all channels in selected source' : 'ALL channels';
    if (!confirm(`Are you sure you want to STOP ${targetDesc}? Active stream processes will be terminated.`)) {
      return;
    }
    setBulkStopping(true);
    // Instantly update UI status so user sees change without refresh!
    setChannels((prev) =>
      prev.map((c) =>
        !selectedSourceId || c.sourceId === selectedSourceId
          ? { ...c, transcodingStatus: 'STOPPED' }
          : c
      )
    );
    try {
      const res = await api.bulkStopChannels(selectedSourceId || undefined);
      setBulkResultModal({
        open: true,
        title: 'Channels Stopped',
        message: `Successfully stopped ${res.stoppedCount} active transcoding processes.`,
      });
    } catch (err: any) {
      alert(`Bulk stop failed: ${err.message}`);
      fetchChannels();
    } finally {
      setBulkStopping(false);
    }
  };

  const handleExportLinks = async () => {
    setExportLoading(true);
    setExportModalOpen(true);
    try {
      const res = await api.exportChannelLinks({
        sourceId: selectedSourceId || undefined,
      });
      setExportResult(res);
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
      setExportModalOpen(false);
    } finally {
      setExportLoading(false);
    }
  };


  const handleDeleteAllChannels = async () => {
    if (!confirm(`⚠️ تحذير فوري:\nهل أنت متأكد من حذف جميع القنوات (${channels.length}) بالكامل من النظام؟\nسيتم مسح كافة القنوات نهائياً للبدء من جديد بشكل نظيف ومرتب.`)) {
      return;
    }
    setLoading(true);
    try {
      const res = await api.deleteAllChannels();
      setChannels([]);
      alert(res.message || 'تم حذف جميع القنوات بنجاح.');
      await fetchChannels();
    } catch (err: any) {
      alert(`فشل الحذف: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };




  const downloadFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Extract distinct groups for filter
  const distinctGroups = Array.from(new Set(channels.map((c) => c.groupTitle).filter(Boolean)));

  const filteredChannels = useMemo(() => {
    return channels.filter((c) => {
      if (channelFilterTab === 'BEIN' && !isBein(c)) return false;
      if (channelFilterTab === 'LIVE' && (c.inputStatus === 'OFFLINE' || (c as any).status === 'event_only')) return false;
      if (channelFilterTab === 'NO_EVENT' && c.inputStatus !== 'OFFLINE' && (c as any).status !== 'event_only') return false;

      if (selectedSourceId && c.sourceId !== selectedSourceId) return false;
      if (selectedGroup && c.groupTitle?.toLowerCase() !== selectedGroup.toLowerCase()) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = c.name?.toLowerCase().includes(q);
        const matchesGroup = c.groupTitle?.toLowerCase().includes(q);
        const matchesId = c.id?.toLowerCase().includes(q);
        if (!matchesName && !matchesGroup && !matchesId) return false;
      }
      return true;
    });
  }, [channels, channelFilterTab, selectedSourceId, selectedGroup, searchQuery]);

  const totalChannels = filteredChannels.length;
  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(totalChannels / pageSize));
  const paginatedChannels = pageSize === 0
    ? filteredChannels
    : filteredChannels.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="min-h-screen bg-[#080808] flex">
      <Sidebar />

      <main className="flex-1 ml-64 flex flex-col min-h-screen">
        <Header
          title="قنوات البث المباشر (Live TV Channels)"
          subtitle="بث مباشر 24/7 بدون تقطيع لكافة القنوات الرياضية والترفيهية والإخبارية"
          action={
            <div className="flex items-center gap-2 flex-wrap">
              {user && (
                <>
                  <button
                    onClick={handleBulkStart}
                    disabled={bulkStarting || loading || channels.length === 0}
                    className="btn-primary py-1.5 px-3 text-xs gap-1.5 shadow-sm"
                    title="Start all channels with low-CPU Stream Copy mode"
                  >
                    <Play className={`w-3.5 h-3.5 fill-current ${bulkStarting ? 'animate-pulse' : ''}`} />
                    <span>{bulkStarting ? 'Starting All...' : 'Start All Channels'}</span>
                  </button>

                  <button
                    onClick={handleBulkStop}
                    disabled={bulkStopping || loading}
                    className="btn-secondary py-1.5 px-3 text-xs gap-1.5 hover:text-red-400"
                    title="Stop all active stream processes"
                  >
                    <Square className={`w-3.5 h-3.5 ${bulkStopping ? 'animate-spin' : ''}`} />
                    <span>{bulkStopping ? 'Stopping...' : 'Stop All'}</span>
                  </button>
                </>
              )}

              <button
                onClick={handleExportLinks}
                disabled={exportLoading || loading || channels.length === 0}
                className="btn-secondary py-1.5 px-3 text-xs gap-1.5 bg-[#171717] hover:bg-[#222222] border-neutral-700"
                title="تصدير قائمة القنوات بالكامل لبرامج التشغيل والشاشات الذكية"
              >
                <Download className={`w-3.5 h-3.5 ${exportLoading ? 'animate-bounce' : ''}`} />
                <span>تصدير الروابط (TXT / M3U)</span>
              </button>

              {user && (
                <>
                  <div className="w-px h-5 bg-[#333] mx-1" />
                  <button
                    onClick={handleDeleteAllChannels}
                    disabled={loading || totalChannels === 0}
                    className="py-1.5 px-3 text-xs gap-1.5 flex items-center rounded-md border border-red-800 text-red-300 bg-red-950/20 hover:bg-red-900/40 transition-colors disabled:opacity-50"
                    title="حذف جميع القنوات بالكامل للبدء من جديد"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    <span>حذف الكل ({totalChannels})</span>
                  </button>
                </>
              )}
            </div>
          }
        />

        <div className="p-8 space-y-6 flex-1">
          {/* Toast Notification */}
          {toastMessage && (
            <div className="fixed top-6 right-6 z-50 flex items-center gap-2 bg-[#171717] border border-emerald-500/40 text-emerald-300 text-xs py-2.5 px-4 rounded-lg shadow-2xl animate-fade-in backdrop-blur-md">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{toastMessage}</span>
            </div>
          )}

          {/* beIN Sports VIP Smart Line Manager Banner */}
          <div className="bg-gradient-to-r from-[#141414] via-[#161616] to-[#121212] border border-[#2A2A2A] rounded-xl p-5 shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-full bg-gradient-to-l from-red-600/5 to-transparent pointer-events-none" />
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-red-950/40 border border-red-800/40 flex items-center justify-center">
                    <Radio className="w-4 h-4 text-red-400 animate-pulse" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-white flex items-center gap-2">
                      <span>إدارة بث قنوات beIN Sports VIP الفضائية</span>
                      <span className="text-[10px] font-mono font-normal px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-300 border border-neutral-700">
                        سعة الاشتراك: قناتان متزامنتان
                      </span>
                    </h2>
                    <p className="text-xs text-[#A1A1AA]">
                      يمكنك تشغيل قناتين كحد أقصى في نفس الوقت. عند إيقاف أي قناة، يظهر فوراً للمشاهدين وتطبيق الأندرويد{' '}
                      <span className="text-amber-400 font-medium">"لا يوجد حدث حالياً"</span> لإتاحة الخط لقناة أخرى دون أي تقطيع.
                    </p>
                  </div>
                </div>

                {/* Active Channels Pills */}
                {activeBeinChannels.length > 0 && (
                  <div className="flex items-center gap-2 pt-2 flex-wrap">
                    <span className="text-[11px] text-[#71717A]">القنوات النشطة قيد البث الآن:</span>
                    {activeBeinChannels.map((c) => (
                      <span
                        key={c.id}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-950/50 border border-emerald-800/60 text-emerald-300 text-[11px] font-medium"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span>{c.name}</span>
                        <button
                          onClick={() => handleToggleBroadcast(c)}
                          title="إيقاف بث هذه القناة فوراً"
                          className="mr-1 text-emerald-400 hover:text-rose-400 transition-colors"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Status Badge & Indicator */}
              <div className="flex items-center gap-3 shrink-0">
                <div
                  className={`px-4 py-2.5 rounded-lg border text-center transition-all ${
                    activeBeinCount >= 2
                      ? 'bg-amber-950/20 border-amber-800/60 text-amber-300'
                      : 'bg-emerald-950/20 border-emerald-800/60 text-emerald-300'
                  }`}
                >
                  <div className="text-[10px] uppercase font-mono tracking-wider opacity-80">
                    القنوات النشطة
                  </div>
                  <div className="text-lg font-bold font-mono">
                    {activeBeinCount} / 2
                  </div>
                  <div className="text-[10px] opacity-75">
                    {activeBeinCount >= 2 ? 'مكتمل (الحد الأقصى)' : 'متاح تفعيل قناة إضافية'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Filter Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => { setChannelFilterTab('ALL'); setCurrentPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                channelFilterTab === 'ALL'
                  ? 'bg-neutral-800 text-white border border-neutral-700'
                  : 'bg-neutral-900/60 text-neutral-400 hover:text-white border border-transparent'
              }`}
            >
              الكل ({channels.length})
            </button>
            <button
              onClick={() => { setChannelFilterTab('BEIN'); setCurrentPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                channelFilterTab === 'BEIN'
                  ? 'bg-red-950/60 text-red-300 border border-red-800'
                  : 'bg-neutral-900/60 text-neutral-400 hover:text-red-300 border border-transparent'
              }`}
            >
              <span>🏆 قنوات beIN Sports</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-neutral-800">
                {channels.filter(isBein).length}
              </span>
            </button>
            <button
              onClick={() => { setChannelFilterTab('LIVE'); setCurrentPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                channelFilterTab === 'LIVE'
                  ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800'
                  : 'bg-neutral-900/60 text-neutral-400 hover:text-emerald-300 border border-transparent'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>قيد البث المباشر</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-neutral-800">
                {channels.filter((c) => c.inputStatus === 'ONLINE' && (c as any).status !== 'event_only').length}
              </span>
            </button>
            <button
              onClick={() => { setChannelFilterTab('NO_EVENT'); setCurrentPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                channelFilterTab === 'NO_EVENT'
                  ? 'bg-neutral-800 text-neutral-300 border border-neutral-600'
                  : 'bg-neutral-900/60 text-neutral-400 hover:text-neutral-300 border border-transparent'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-neutral-500" />
              <span>لا يوجد حدث حالياً</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-neutral-800">
                {channels.filter((c) => c.inputStatus === 'OFFLINE' || (c as any).status === 'event_only').length}
              </span>
            </button>
          </div>

          {/* Controls: Search & Filters */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3 w-full sm:w-auto flex-1 max-w-2xl">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-[#71717A] absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fetchChannels()}
                  placeholder="Search channels..."
                  className="form-input pl-9 text-xs"
                />
              </div>

              {/* Source Filter */}
              <select
                value={selectedSourceId}
                onChange={(e) => setSelectedSourceId(e.target.value)}
                className="form-input text-xs w-44"
              >
                <option value="">All Sources</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>

              {/* Group Filter */}
              {distinctGroups.length > 0 && (
                <select
                  value={selectedGroup}
                  onChange={(e) => setSelectedGroup(e.target.value)}
                  className="form-input text-xs w-36"
                >
                  <option value="">All Groups</option>
                  {distinctGroups.map((g) => (
                    <option key={g} value={g as string}>
                      {g}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <span className="text-xs font-mono text-[#71717A] shrink-0">
              CHANNELS: {totalChannels.toLocaleString()}{totalChannels !== channels.length ? ` (من أصل ${channels.length})` : ''}
            </span>
          </div>

          {/* Channels Table */}
          <div className="bg-[#111111] border border-[#262626] rounded-lg overflow-hidden">
            {loading ? (
              <div className="p-12 text-center text-xs text-[#71717A]">Loading channels...</div>
            ) : channels.length === 0 ? (
              <div className="p-12 text-center text-[#71717A] space-y-2">
                <Tv className="w-8 h-8 text-[#333333] mx-auto" />
                <p className="text-xs font-medium text-[#A1A1AA]">No channels found</p>
                <p className="text-[11px] text-[#71717A]">
                  Import an M3U playlist or add direct streams under Sources.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#262626] text-[#71717A] font-mono bg-[#0D0D0D]">
                      <th className="py-3 px-4 font-normal">Channel Name</th>
                      <th className="py-3 px-4 font-normal">Group</th>
                      <th className="py-3 px-4 font-normal">Format</th>
                      <th className="py-3 px-4 font-normal">Preset</th>
                      <th className="py-3 px-4 font-normal">حالة البث والحدث</th>
                      <th className="py-3 px-4 font-normal text-right">التحكم والبث</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1A1A1A]">
                    {paginatedChannels.map((ch) => (
                      <tr
                        key={ch.id}
                        onClick={() => handleOpenStreamLinks(ch)}
                        className="hover:bg-[#1A1A1A] cursor-pointer transition-colors group"
                      >
                        <td className="py-3 px-4 font-medium text-[#F5F5F5]">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-md bg-neutral-900 border border-neutral-800 flex items-center justify-center overflow-hidden shrink-0">
                              {ch.logoUrl || ch.name?.toLowerCase().includes('bein') ? (
                                <img
                                  src={
                                    ch.logoUrl?.startsWith('/') || ch.logoUrl?.startsWith('data:')
                                      ? ch.logoUrl
                                      : ch.logoUrl
                                      ? `/api/app/image-proxy?url=${encodeURIComponent(ch.logoUrl)}`
                                      : '/logos/bein-sports.png'
                                  }
                                  alt=""
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-contain p-0.5"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    const isBeinChan = ch.name?.toLowerCase().includes('bein') || ch.groupTitle?.toLowerCase().includes('bein');
                                    if (!target.dataset.triedFallback) {
                                      target.dataset.triedFallback = 'true';
                                      if (isBeinChan) {
                                        target.src = '/logos/bein-sports.png';
                                      } else if (ch.logoUrl && ch.logoUrl.startsWith('http')) {
                                        target.src = ch.logoUrl;
                                      } else {
                                        target.style.display = 'none';
                                      }
                                    } else if (isBeinChan && !target.src.includes('/logos/bein-sports.png')) {
                                      target.src = '/logos/bein-sports.png';
                                    } else {
                                      target.style.display = 'none';
                                    }
                                  }}
                                />
                              ) : (
                                <Tv className="w-4 h-4 text-[#71717A]" />
                              )}
                            </div>
                            <div className="flex flex-col">
                              <span className="font-medium text-white group-hover:text-red-400 transition-colors">{ch.name}</span>
                              {ch.orderIndex !== undefined && ch.orderIndex > 0 && (
                                <span className="text-[10px] font-mono text-[#71717A]">#{ch.orderIndex}</span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-[#A1A1AA] text-[11px]">
                          {ch.groupTitle || 'General'}
                        </td>
                        <td className="py-3 px-4 font-mono text-[10px] text-[#71717A]">
                          {ch.inputType}
                        </td>
                        <td className="py-3 px-4">
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#171717] text-[#D4D4D8] border border-[#262626]">
                            {ch.preset}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {ch.inputStatus === 'ONLINE' && (ch as any).status !== 'event_only' ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950/70 text-emerald-400 border border-emerald-800/80">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                              <span>بث مباشر (نشط)</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-neutral-900 text-amber-400/90 border border-amber-900/40">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                              <span>لا يوجد حدث</span>
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex items-center gap-2">
                            {/* Broadcast On/Off Button (Stop/Start Event) */}
                            <button
                              onClick={(e) => handleToggleBroadcast(ch, e)}
                              disabled={broadcastTogglingId === ch.id}
                              title={
                                ch.inputStatus === 'ONLINE' && (ch as any).status !== 'event_only'
                                  ? 'إيقاف البث فوراً وإظهار (لا يوجد حدث) في تطبيق الأندرويد وموقع العرض'
                                  : 'تشغيل البث المباشر للقناة'
                              }
                              className={`px-3 py-1 rounded flex items-center gap-1.5 font-medium text-xs transition-all shadow-sm ${
                                ch.inputStatus === 'ONLINE' && (ch as any).status !== 'event_only'
                                  ? 'bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60'
                                  : 'bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-800/60'
                              } disabled:opacity-50`}
                            >
                              {broadcastTogglingId === ch.id ? (
                                <span className="animate-spin text-xs">⏳</span>
                              ) : ch.inputStatus === 'ONLINE' && (ch as any).status !== 'event_only' ? (
                                <>
                                  <Pause className="w-3.5 h-3.5 text-rose-400" />
                                  <span>إيقاف البث</span>
                                </>
                              ) : (
                                <>
                                  <Play className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400/20" />
                                  <span>تشغيل البث</span>
                                </>
                              )}
                            </button>

                            {/* Open Stream Links Modal */}
                            <button
                              onClick={() => handleOpenStreamLinks(ch)}
                              title="عرض وتوزيع روابط البث المباشر لكافة السيرفرات"
                              className="px-3 py-1 rounded bg-[#0284C7]/20 hover:bg-[#0284C7]/30 text-[#38BDF8] border border-[#0284C7]/40 flex items-center gap-1.5 font-medium text-xs transition-colors shadow-sm"
                            >
                              <Radio className="w-3.5 h-3.5" />
                              <span>روابط البث</span>
                            </button>

                            {/* Copy Direct M3U8 Link Button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const fullUrl = `${window.location.origin}/live/${ch.id}.m3u8?server=1`;
                                navigator.clipboard.writeText(fullUrl);
                                setCopiedChannelId(ch.id);
                                setTimeout(() => setCopiedChannelId(null), 2000);
                              }}
                              title="نسخ رابط البث المباشر HLS M3U8"
                              className="px-2.5 py-1 rounded bg-[#1A1A1A] hover:bg-[#262626] text-[#D4D4D8] hover:text-white flex items-center gap-1.5 font-medium text-xs transition-colors border border-[#2A2A2A]"
                            >
                              {copiedChannelId === ch.id ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  <span className="text-emerald-400">تم النسخ</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5 text-[#38BDF8]" />
                                  <span>نسخ M3U8</span>
                                </>
                              )}
                            </button>


                            {/* Issue Token */}
                            <button
                              onClick={() => handleOpenTokenModal(ch)}
                              title="Generate Protected Playback Token"
                              className="p-1 rounded text-[#71717A] hover:text-white hover:bg-[#1E1E1E] transition-colors"
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                            </button>

                            {/* Inspect Stream */}
                            <button
                              onClick={() => handleInspect(ch)}
                              title="Inspect Codec & Media Info"
                              className="p-1 rounded text-[#71717A] hover:text-white hover:bg-[#1E1E1E] transition-colors"
                            >
                              <Info className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls */}
            {totalChannels > 0 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 bg-[#0D0D0D] border-t border-[#262626] text-xs text-[#A1A1AA]">
                <div className="flex items-center gap-2">
                  <span>
                    Showing {pageSize === 0 ? 1 : Math.min((currentPage - 1) * pageSize + 1, totalChannels)} to {pageSize === 0 ? totalChannels : Math.min(currentPage * pageSize, totalChannels)} of {totalChannels.toLocaleString()} channels
                  </span>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[#71717A]">Per page:</span>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      className="form-input text-xs py-1 px-2 bg-[#171717] border-[#333333]"
                    >
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={250}>250</option>
                      <option value={500}>500</option>
                      <option value={1000}>1,000</option>
                      <option value={0}>All ({totalChannels.toLocaleString()})</option>
                    </select>
                  </div>

                  {pageSize > 0 && totalPages > 1 && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage <= 1}
                        className="p-1 rounded border border-[#262626] bg-[#141414] hover:bg-[#202020] disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Previous page"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <span className="px-2 font-mono text-[#D4D4D8]">
                        {currentPage} / {totalPages}
                      </span>
                      <button
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage >= totalPages}
                        className="p-1 rounded border border-[#262626] bg-[#141414] hover:bg-[#202020] disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Next page"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Inspect Codec Modal */}
        {inspectModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-[#111111] border border-[#262626] rounded-lg max-w-md w-full overflow-hidden shadow-2xl">
              <div className="px-5 py-4 border-b border-[#262626] flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#F5F5F5]">{inspectingName} — Stream Probe</h3>
                <button
                  onClick={() => setInspectModalOpen(false)}
                  className="text-[#71717A] hover:text-[#F5F5F5] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4 text-xs">
                {inspectLoading ? (
                  <div className="py-8 text-center text-[#71717A] space-y-2">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" />
                    <p>Executing FFprobe against authorized stream...</p>
                  </div>
                ) : probeInfo ? (
                  <div className="space-y-3 font-mono">
                    <div className="p-3 bg-[#0D0D0D] border border-[#262626] rounded space-y-1">
                      <div className="text-[10px] text-[#71717A] uppercase">Format & Container</div>
                      <div className="text-[#F5F5F5]">{probeInfo.formatName}</div>
                      {probeInfo.bitrate && (
                        <div className="text-[#A1A1AA]">Bitrate: {Math.round(probeInfo.bitrate / 1000)} kbps</div>
                      )}
                    </div>

                    {probeInfo.video && (
                      <div className="p-3 bg-[#0D0D0D] border border-[#262626] rounded space-y-1">
                        <div className="text-[10px] text-[#71717A] uppercase">Video Stream</div>
                        <div className="text-[#F5F5F5]">Codec: {probeInfo.video.codec.toUpperCase()}</div>
                        <div className="text-[#A1A1AA]">
                          Resolution: {probeInfo.video.width}x{probeInfo.video.height}
                        </div>
                      </div>
                    )}

                    {probeInfo.audio && (
                      <div className="p-3 bg-[#0D0D0D] border border-[#262626] rounded space-y-1">
                        <div className="text-[10px] text-[#71717A] uppercase">Audio Stream</div>
                        <div className="text-[#F5F5F5]">Codec: {probeInfo.audio.codec.toUpperCase()}</div>
                        <div className="text-[#A1A1AA]">
                          Channels: {probeInfo.audio.channels} • {probeInfo.audio.sampleRate} Hz
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-center text-[#71717A]">No probe information available.</p>
                )}

                <div className="pt-2 flex justify-end">
                  <button
                    onClick={() => setInspectModalOpen(false)}
                    className="btn-secondary py-1.5 px-4 text-xs"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Generate Token Modal */}
        {tokenModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-[#111111] border border-[#262626] rounded-lg max-w-lg w-full overflow-hidden shadow-2xl">
              <div className="px-5 py-4 border-b border-[#262626] flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#F5F5F5]">
                  Issue Playback Token — {tokenChannelName}
                </h3>
                <button
                  onClick={() => setTokenModalOpen(false)}
                  className="text-[#71717A] hover:text-[#F5F5F5] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {!generatedResult ? (
                <form onSubmit={handleGenerateToken} className="p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-[#A1A1AA] mb-1">Token Label / Client</label>
                    <input
                      type="text"
                      value={tokenName}
                      onChange={(e) => setTokenName(e.target.value)}
                      required
                      placeholder="e.g. Living Room Android TV"
                      className="form-input text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#A1A1AA] mb-1">
                      Lifetime (Hours, 0 = Indefinite)
                    </label>
                    <input
                      type="number"
                      value={tokenLifetime}
                      onChange={(e) => setTokenLifetime(parseInt(e.target.value, 10) || 0)}
                      min={0}
                      max={8760}
                      className="form-input text-xs font-mono"
                    />
                  </div>

                  <p className="text-[11px] text-[#71717A]">
                    A cryptographically random token will be created. Only its SHA-256 hash is persisted in Firestore.
                  </p>

                  <div className="pt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setTokenModalOpen(false)}
                      className="btn-secondary py-1.5 px-3 text-xs"
                    >
                      Cancel
                    </button>
                    <button type="submit" className="btn-primary py-1.5 px-4 text-xs">
                      Generate Playback URL
                    </button>
                  </div>
                </form>
              ) : (
                <div className="p-5 space-y-4">
                  {/* HLS URL */}
                  <div className="p-3 bg-[#0A0A0A] border border-[#262626] rounded text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-[#A1A1AA] uppercase font-mono font-medium">
                        HLS Playback URL (.m3u8)
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(generatedResult.playbackUrl);
                          setCopiedType('hls');
                          setTimeout(() => setCopiedType(null), 2000);
                        }}
                        className="btn-secondary py-0.5 px-2 text-[10px] gap-1"
                      >
                        {copiedType === 'hls' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedType === 'hls' ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                    <div className="font-mono text-[11px] text-[#F5F5F5] break-all select-all p-2 bg-[#141414] rounded border border-[#222]">
                      {generatedResult.playbackUrl}
                    </div>
                  </div>



                  <p className="text-[11px] text-[#71717A]">
                    Important: Copy these bearer URLs now. For security, raw tokens cannot be retrieved again from the database once closed.
                  </p>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setTokenModalOpen(false)}
                      className="btn-primary py-1.5 px-4 text-xs"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Bulk Action Result Modal */}
        {bulkResultModal.open && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#111111] border border-[#262626] rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-[#222] pb-3">
                <h3 className="text-sm font-bold text-[#F5F5F5]">{bulkResultModal.title}</h3>
                <button
                  onClick={() => setBulkResultModal({ open: false, title: '', message: '' })}
                  className="text-[#71717A] hover:text-[#F5F5F5]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="whitespace-pre-wrap font-mono text-xs text-[#D4D4D8] bg-[#161616] p-3 rounded border border-[#262626]">
                {bulkResultModal.message}
              </div>

              {bulkResultModal.details && bulkResultModal.details.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-mono text-[#A1A1AA]">Details / Warnings:</span>
                  <div className="max-h-28 overflow-auto bg-[#141414] p-2 rounded text-[11px] text-[#A1A1AA] font-mono space-y-1 border border-[#222]">
                    {bulkResultModal.details.map((d, i) => (
                      <div key={i}>• {d}</div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setBulkResultModal({ open: false, title: '', message: '' })}
                  className="btn-primary py-1.5 px-4 text-xs"
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        )}


        {/* Export Links Modal */}
        {exportModalOpen && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#111111] border border-[#262626] rounded-xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-[#262626]">
                <div className="flex items-center gap-2.5">
                  <FileText className="w-5 h-5 text-white" />
                  <div>
                    <h3 className="text-sm font-bold text-[#F5F5F5]">Export Working Channel Links</h3>
                    <p className="text-[11px] text-[#71717A]">
                      {exportResult
                        ? `${exportResult.totalChannels} channels exported with secure playback tokens`
                        : 'Generating tokens and links...'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setExportModalOpen(false)}
                  className="text-[#71717A] hover:text-[#F5F5F5] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {exportLoading ? (
                <div className="p-16 text-center text-xs text-[#71717A] space-y-3">
                  <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" />
                  <p>Generating cryptographically signed playback tokens for all channels...</p>
                </div>
              ) : exportResult ? (
                <div className="flex-1 flex flex-col p-5 overflow-hidden space-y-4">
                  {/* Format Tabs & Download Buttons */}
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-[#222] pb-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setActiveExportTab('TXT')}
                        className={`py-1 px-3 text-xs rounded transition-colors ${
                          activeExportTab === 'TXT'
                            ? 'bg-white text-black font-semibold'
                            : 'bg-[#181818] text-[#A1A1AA] hover:text-white'
                        }`}
                      >
                        TXT Format (List)
                      </button>
                      <button
                        onClick={() => setActiveExportTab('M3U')}
                        className={`py-1 px-3 text-xs rounded transition-colors ${
                          activeExportTab === 'M3U'
                            ? 'bg-white text-black font-semibold'
                            : 'bg-[#181818] text-[#A1A1AA] hover:text-white'
                        }`}
                      >
                        M3U Playlist (IPTV)
                      </button>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => {
                          const content = activeExportTab === 'TXT' ? exportResult.txtContent : exportResult.m3uContent;
                          navigator.clipboard.writeText(content);
                          setCopiedExport(true);
                          setTimeout(() => setCopiedExport(false), 2000);
                        }}
                        className="btn-secondary py-1 px-2.5 text-xs gap-1"
                      >
                        {copiedExport ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedExport ? 'Copied!' : 'Copy'}</span>
                      </button>

                      <button
                        onClick={() =>
                          downloadFile(
                            exportResult.txtContent,
                            `aspreen_channels_${new Date().toISOString().slice(0, 10)}.txt`,
                            'text/plain'
                          )
                        }
                        className="btn-primary py-1 px-3 text-xs gap-1"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download .TXT</span>
                      </button>

                      <button
                        onClick={() =>
                          downloadFile(
                            exportResult.m3uContent,
                            `aspreen_playlist_${new Date().toISOString().slice(0, 10)}.m3u`,
                            'audio/x-mpegurl'
                          )
                        }
                        className="btn-secondary py-1 px-3 text-xs gap-1 border-neutral-600"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download .M3U</span>
                      </button>
                    </div>
                  </div>

                  {/* Code / Text Preview */}
                  <div className="flex-1 overflow-auto bg-[#0A0A0A] border border-[#222] rounded-lg p-3 max-h-96">
                    <pre className="font-mono text-[11px] text-[#D4D4D8] leading-relaxed whitespace-pre-wrap select-all">
                      {(() => {
                        const content = activeExportTab === 'TXT' ? exportResult.txtContent : exportResult.m3uContent;
                        if (content.length > 50000) {
                          return content.slice(0, 50000) + `\n\n... [Preview truncated in view: ${exportResult.totalChannels.toLocaleString()} total channels. Click "Download .M3U" or "Copy" above for the complete file.]`;
                        }
                        return content;
                      })()}
                    </pre>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* Stream Links & Server Dispatcher Modal */}
        {linksModalOpen && selectedChannelForLinks && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
            <div className="bg-[#111111] border border-[#262626] rounded-xl max-w-2xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
              {/* Header */}
              <div className="px-6 py-4 border-b border-[#262626] flex items-center justify-between bg-[#141414]">
                <div className="flex items-center gap-3">
                  {selectedChannelForLinks.logoUrl || selectedChannelForLinks.name?.toLowerCase().includes('bein') ? (
                    <img
                      src={
                        selectedChannelForLinks.logoUrl?.startsWith('/')
                          ? selectedChannelForLinks.logoUrl
                          : selectedChannelForLinks.logoUrl || '/logos/bein-sports.png'
                      }
                      alt={selectedChannelForLinks.name}
                      className="w-10 h-10 object-contain rounded bg-[#0A0A0A] p-1 border border-[#262626]"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        if (selectedChannelForLinks.name?.toLowerCase().includes('bein') && !target.src.includes('/logos/bein-sports.png')) {
                          target.src = '/logos/bein-sports.png';
                        }
                      }}
                    />
                  ) : (
                    <div className="w-10 h-10 rounded bg-[#1E293B] flex items-center justify-center border border-[#334155]">
                      <Radio className="w-5 h-5 text-[#38BDF8]" />
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-white">{selectedChannelForLinks.name}</h3>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                        مباشر • LIVE
                      </span>
                    </div>
                    <p className="text-xs text-[#A1A1AA] mt-0.5">
                      موزع الروابط المباشرة • {selectedChannelForLinks.groupTitle || 'عام'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setLinksModalOpen(false)}
                  className="text-[#71717A] hover:text-white p-1 rounded-md hover:bg-[#222] transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Body */}
              <div className="p-6 overflow-y-auto space-y-5">
                {/* Notice */}
                <div className="p-3.5 bg-[#0F172A]/80 border border-[#1E3A8A]/50 rounded-lg text-xs flex items-start gap-3">
                  <Info className="w-4 h-4 text-[#38BDF8] shrink-0 mt-0.5" />
                  <div className="text-[#94A3B8] leading-relaxed">
                    <span className="text-white font-semibold">روابط البث المباشر الرسمية (M3U8):</span>
                    <br />
                    جميع روابط السيرفرات تعمل بصيغة <strong className="text-[#38BDF8]">M3U8 (HLS)</strong> النقية بدون TS، وهي متوافقة 100% مع مشغل VLC وكافة تطبيقات IPTV والشاشات الذكية.
                  </div>
                </div>

                {/* Available Servers */}
                <div className="space-y-4">
                  {(selectedChannelForLinks.servers && selectedChannelForLinks.servers.length > 0
                    ? selectedChannelForLinks.servers
                    : [
                        { id: 'server-1', name: 'سيرفر 1 (البث المباشر الرئيسي - M3U8)', quality: 'FHD' },
                        { id: 'server-2', name: 'سيرفر 2 (سيرفر احتياطي - M3U8)', quality: 'HD' },
                      ]
                  ).map((srv: any, idx: number) => {
                    const srvNum = idx + 1;
                    const hlsUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/live/${selectedChannelForLinks.id}.m3u8?server=${srvNum}`;
                    const keyHls = `hls_${srvNum}`;

                    return (
                      <div key={srv.id || idx} className="p-4 bg-[#0A0A0A] border border-[#262626] rounded-xl space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            <span className="text-xs font-bold text-white">{srv.name || `سيرفر ${srvNum}`}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1F2937] text-[#9CA3AF] border border-[#374151]">
                              {srv.quality || 'FHD'}
                            </span>
                            {srv.resolution && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#111827] text-emerald-400 border border-emerald-900/50">
                                {srv.resolution}
                              </span>
                            )}
                          </div>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(hlsUrl);
                              setCopiedServerKey(keyHls);
                              setTimeout(() => setCopiedServerKey(null), 2000);
                            }}
                            className="px-3 py-1 rounded bg-[#0284C7]/20 hover:bg-[#0284C7]/40 text-[#38BDF8] border border-[#0284C7]/30 flex items-center gap-1.5 transition-colors font-medium text-xs shadow-sm"
                          >
                            {copiedServerKey === keyHls ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                <span className="text-emerald-400 font-bold">تم النسخ!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>نسخ رابط M3U8</span>
                              </>
                            )}
                          </button>
                        </div>

                        {/* HLS Link Box */}
                        <div className="bg-[#141414] border border-[#2A2A2A] rounded p-2.5 font-mono text-[11px] text-[#A1A1AA] select-all break-all">
                          {hlsUrl}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Single Channel M3U Download Button */}
                <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
                  <button
                    onClick={() => {
                      const origin = window.location.origin;
                      const m3uContent = `#EXTM3U\n#EXTINF:-1 tvg-id="${selectedChannelForLinks.id}" tvg-name="${selectedChannelForLinks.name}" tvg-logo="${selectedChannelForLinks.logoUrl || ''}" group-title="${selectedChannelForLinks.groupTitle || 'Live'}",${selectedChannelForLinks.name}\n${origin}/live/${selectedChannelForLinks.id}.m3u8?server=1\n`;
                      const blob = new Blob([m3uContent], { type: 'audio/x-mpegurl;charset=utf-8' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${selectedChannelForLinks.name.replace(/[^a-zA-Z0-9_\u0600-\u06FF]+/g, '_')}.m3u`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    }}
                    className="w-full btn-secondary py-2 px-4 text-xs gap-2 justify-center bg-[#1E293B] hover:bg-[#334155] text-white border-[#334155]"
                  >
                    <Download className="w-3.5 h-3.5 text-[#38BDF8]" />
                    <span>تحميل ملف M3U لهذه القناة (M3U8 Pure)</span>
                  </button>

                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/playlist.m3u`);
                      alert('تم نسخ رابط قائمة كل القنوات المباشرة M3U!');
                    }}
                    className="w-full btn-secondary py-2 px-4 text-xs gap-2 justify-center"
                  >
                    <Copy className="w-3.5 h-3.5 text-[#A1A1AA]" />
                    <span>نسخ رابط جميع القنوات (/playlist.m3u)</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* beIN Sports Capacity Limit Warning Modal */}
        {limitWarningModal.open && (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#121212] border border-[#2A2A2A] rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-fade-in">
              <div className="flex items-start justify-between border-b border-[#222222] pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-950/40 border border-amber-600/30 flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-5 h-5 text-amber-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">
                      تم بلوغ الحد الأقصى (قناتين بي إن سبورت)
                    </h3>
                    <p className="text-xs text-[#A1A1AA] mt-0.5">
                      سيرفر المصدر يسمح بتشغيل <span className="text-amber-400 font-semibold">قناتين فقط</span> في نفس الوقت
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setLimitWarningModal({ open: false, channelName: '', activeNames: [] })}
                  className="text-[#71717A] hover:text-white transition-colors p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 text-xs text-[#D4D4D8]">
                <p className="leading-relaxed bg-[#181818] p-3.5 rounded-xl border border-[#262626]">
                  للحفاظ على ثبات البث بدون أي تقطيع أو تجميد، قمنا بحماية اشتراكك من تجاوز الحد.
                  تريد تشغيل <span className="text-emerald-400 font-bold">"{limitWarningModal.channelName}"</span>؟
                  اختر إحدى القناتين التاليتين لإيقافها وتشغيل الجديدة مكانها بنقرة واحدة:
                </p>

                <div className="space-y-2 pt-1">
                  <div className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wider">
                    القنوات التي تبث الآن (اختر قناة لاستبدالها):
                  </div>
                  {activeBeinChannels.length > 0 ? (
                    activeBeinChannels.map((activeCh) => (
                      <div
                        key={activeCh.id}
                        className="flex items-center justify-between p-3 rounded-xl bg-[#171717] border border-[#2B2B2B] hover:border-neutral-600 transition-all"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                          <span className="font-semibold text-white text-xs">{activeCh.name}</span>
                          <span className="text-[10px] text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-800/40">
                            تبث حالياً
                          </span>
                        </div>
                        {limitWarningModal.pendingChannelId && (
                          <button
                            onClick={() =>
                              handleSwitchBeinChannel(activeCh.id, limitWarningModal.pendingChannelId!)
                            }
                            disabled={broadcastTogglingId !== null}
                            className="px-3 py-1.5 rounded-lg bg-red-950/60 hover:bg-red-900 border border-red-700/60 text-red-200 text-xs font-medium transition-colors flex items-center gap-1.5"
                          >
                            <span>إيقاف هذه والتبديل</span>
                            <span>←</span>
                          </button>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="p-3 text-center text-[#71717A] bg-[#161616] rounded-xl border border-[#262626]">
                      {limitWarningModal.activeNames.join(' ، ')}
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#222222]">
                <button
                  type="button"
                  onClick={() => setLimitWarningModal({ open: false, channelName: '', activeNames: [] })}
                  className="btn-secondary py-2 px-4 text-xs font-medium"
                >
                  إلغاء الأمر
                </button>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
