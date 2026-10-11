'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { HlsPlayerModal } from '@/components/player/hls-player';
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

  // Player preview modal
  const [playerModalOpen, setPlayerModalOpen] = useState(false);
  const [activePlayerUrl, setActivePlayerUrl] = useState('');
  const [activePlayerName, setActivePlayerName] = useState('');

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

  const fetchChannels = async () => {
    try {
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

  const fetchSources = async () => {
    try {
      const data = await api.getSources();
      setSources(data);
    } catch {}
  };

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }
    if (user) {
      fetchSources();
      fetchChannels();
    }
  }, [user, authLoading, selectedSourceId, selectedGroup, router]);

  const handleStart = async (channelId: string) => {
    setActionInProgress(channelId);
    try {
      await api.startChannel(channelId);
      await fetchChannels();
    } catch (err: any) {
      alert(`Start failed: ${err.message}`);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleStop = async (channelId: string) => {
    setActionInProgress(channelId);
    try {
      await api.stopChannel(channelId);
      await fetchChannels();
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

  const handlePlayPreview = async (channel: Channel) => {
    try {
      if (channel.transcodingStatus !== 'RUNNING') {
        await api.startChannel(channel.id);
      }
      const res = await api.createStreamToken(channel.id, {
        name: 'Console Preview Temporary Token',
        lifetimeHours: 1,
      });
      setActivePlayerUrl(res.playbackUrl);
      setActivePlayerName(channel.name);
      setPlayerModalOpen(true);
      fetchChannels();
    } catch (err: any) {
      alert(`Failed to prepare preview link: ${err.message}`);
    }
  };

  const handleBulkStart = async () => {
    const targetDesc = selectedSourceId ? 'all channels in selected source' : 'ALL channels';
    if (!confirm(`Are you sure you want to start ${targetDesc} using Compatible Stream Copy mode?`)) {
      return;
    }
    setBulkStarting(true);
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
      fetchChannels();
    } catch (err: any) {
      alert(`Bulk start failed: ${err.message}`);
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
    try {
      const res = await api.bulkStopChannels(selectedSourceId || undefined);
      setBulkResultModal({
        open: true,
        title: 'Channels Stopped',
        message: `Successfully stopped ${res.stoppedCount} active transcoding processes.`,
      });
      fetchChannels();
    } catch (err: any) {
      alert(`Bulk stop failed: ${err.message}`);
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

  const totalChannels = channels.length;
  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(totalChannels / pageSize));
  const paginatedChannels = pageSize === 0
    ? channels
    : channels.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="min-h-screen bg-[#080808] flex">
      <Sidebar />

      <main className="flex-1 ml-64 flex flex-col min-h-screen">
        <Header
          title="Imported Channels"
          subtitle="Configure transcoding presets, inspect audio/video codecs, and issue protected tokens"
          action={
            <div className="flex items-center gap-2 flex-wrap">
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

              <button
                onClick={handleExportLinks}
                disabled={exportLoading || loading || channels.length === 0}
                className="btn-secondary py-1.5 px-3 text-xs gap-1.5 bg-[#171717] hover:bg-[#222222] border-neutral-700"
                title="Export all working channel links to TXT and M3U formats"
              >
                <Download className={`w-3.5 h-3.5 ${exportLoading ? 'animate-bounce' : ''}`} />
                <span>{exportLoading ? 'Exporting...' : 'Export All Links (TXT/M3U)'}</span>
              </button>
            </div>
          }
        />

        <div className="p-8 space-y-6 flex-1">
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
              CHANNELS: {channels.length.toLocaleString()}
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
                      <th className="py-3 px-4 font-normal">Status</th>
                      <th className="py-3 px-4 font-normal text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1A1A1A]">
                    {paginatedChannels.map((ch) => (
                      <tr key={ch.id} className="hover:bg-[#141414] transition-colors">
                        <td className="py-3 px-4 font-medium text-[#F5F5F5]">
                          <div className="flex items-center gap-2">
                            {ch.logoUrl ? (
                              <img src={ch.logoUrl} alt="" className="w-5 h-5 rounded object-cover bg-neutral-900" />
                            ) : (
                              <Tv className="w-4 h-4 text-[#71717A]" />
                            )}
                            <span>{ch.name}</span>
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
                          <span
                            className={
                              ch.transcodingStatus === 'RUNNING'
                                ? 'badge-running'
                                : ch.transcodingStatus === 'FAILED'
                                ? 'badge-failed'
                                : 'badge-stopped'
                            }
                          >
                            {ch.transcodingStatus}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            {/* Start or Stop Transcoding */}
                            {ch.transcodingStatus === 'RUNNING' ? (
                              <button
                                onClick={() => handleStop(ch.id)}
                                disabled={actionInProgress === ch.id}
                                title="Stop Transcoding"
                                className="p-1 rounded text-[#A1A1AA] hover:text-white hover:bg-[#1E1E1E] transition-colors"
                              >
                                <Square className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <button
                                onClick={() => handleStart(ch.id)}
                                disabled={actionInProgress === ch.id}
                                title="Start Transcoding"
                                className="p-1 rounded text-[#A1A1AA] hover:text-white hover:bg-[#1E1E1E] transition-colors"
                              >
                                <Play className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {/* Inspect Stream */}
                            <button
                              onClick={() => handleInspect(ch)}
                              title="Inspect Codec & Media Info"
                              className="p-1 rounded text-[#A1A1AA] hover:text-white hover:bg-[#1E1E1E] transition-colors"
                            >
                              <Info className="w-3.5 h-3.5" />
                            </button>

                            {/* Issue Token */}
                            <button
                              onClick={() => handleOpenTokenModal(ch)}
                              title="Generate Protected Playback Token"
                              className="p-1 rounded text-[#A1A1AA] hover:text-white hover:bg-[#1E1E1E] transition-colors"
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                            </button>

                            {/* Stream Preview (If Running) */}
                            {ch.transcodingStatus === 'RUNNING' && (
                              <button
                                onClick={() => handlePlayPreview(ch)}
                                title="Watch Stream Preview"
                                className="p-1 rounded text-white bg-[#1A1A1A] hover:bg-[#262626] border border-[#333333] transition-colors"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                            )}
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

                  {/* Direct MPEG-TS URL */}
                  {generatedResult.tsPlaybackUrl && (
                    <div className="p-3 bg-[#0A0A0A] border border-[#262626] rounded text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-[#A1A1AA] uppercase font-mono font-medium">
                          Direct MPEG-TS Stream URL (.ts)
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(generatedResult.tsPlaybackUrl!);
                            setCopiedType('ts');
                            setTimeout(() => setCopiedType(null), 2000);
                          }}
                          className="btn-secondary py-0.5 px-2 text-[10px] gap-1"
                        >
                          {copiedType === 'ts' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedType === 'ts' ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>
                      <div className="font-mono text-[11px] text-[#F5F5F5] break-all select-all p-2 bg-[#141414] rounded border border-[#222]">
                        {generatedResult.tsPlaybackUrl}
                      </div>
                    </div>
                  )}

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
                      {activeExportTab === 'TXT' ? exportResult.txtContent : exportResult.m3uContent}
                    </pre>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* HLS Player Modal */}
        <HlsPlayerModal
          streamUrl={activePlayerUrl}
          channelName={activePlayerName}
          isOpen={playerModalOpen}
          onClose={() => setPlayerModalOpen(false)}
        />
      </main>
    </div>
  );
}
