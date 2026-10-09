'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { HlsPlayerModal } from '@/components/player/hls-player';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api-client';
import { Channel, Source, TranscodingPresetId, StreamProbeInfo } from '@aspreen/shared';
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
} from 'lucide-react';

export default function ChannelsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);

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
  const [generatedResult, setGeneratedResult] = useState<{ rawToken: string; playbackUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Transcoding actions
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

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
    setCopied(false);
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
      });
    } catch (err: any) {
      alert(`Token generation failed: ${err.message}`);
    }
  };

  const handlePlayPreview = async (channel: Channel) => {
    // Generate a temporary inspection token if none exists, or prompt
    try {
      const res = await api.createStreamToken(channel.id, {
        name: 'Console Preview Temporary Token',
        lifetimeHours: 1,
      });
      setActivePlayerUrl(res.playbackUrl);
      setActivePlayerName(channel.name);
      setPlayerModalOpen(true);
    } catch (err: any) {
      alert(`Failed to prepare preview link: ${err.message}`);
    }
  };

  // Extract distinct groups for filter
  const distinctGroups = Array.from(new Set(channels.map((c) => c.groupTitle).filter(Boolean)));

  return (
    <div className="min-h-screen bg-[#080808] flex">
      <Sidebar />

      <main className="flex-1 ml-64 flex flex-col min-h-screen">
        <Header
          title="Imported Channels"
          subtitle="Configure transcoding presets, inspect audio/video codecs, and issue protected tokens"
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
              CHANNELS: {channels.length}
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
                    {channels.map((ch) => (
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
                  <div className="p-3 bg-[#0A0A0A] border border-[#262626] rounded text-xs space-y-2">
                    <div className="text-[10px] text-[#71717A] uppercase font-mono">Protected HLS Playback URL</div>
                    <div className="font-mono text-xs text-[#F5F5F5] break-all select-all p-2 bg-[#141414] rounded border border-[#222]">
                      {generatedResult.playbackUrl}
                    </div>
                  </div>

                  <p className="text-[11px] text-[#A1A1AA]">
                    Important: Copy this bearer URL now. For security, raw tokens cannot be retrieved again from the database once closed.
                  </p>

                  <div className="pt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(generatedResult.playbackUrl);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className="btn-primary py-1.5 px-4 text-xs gap-1.5"
                    >
                      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? 'Copied URL!' : 'Copy Playback URL'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setTokenModalOpen(false)}
                      className="btn-secondary py-1.5 px-3 text-xs"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
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
