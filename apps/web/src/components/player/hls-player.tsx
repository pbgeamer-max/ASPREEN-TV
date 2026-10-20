'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Hls from 'hls.js';
import { X, AlertCircle, RefreshCw, Loader2, Copy, Check, Subtitles, ChevronDown, Server, Play, Volume2, VolumeX, Maximize, Minimize } from 'lucide-react';

export interface SubtitleTrack {
  src: string;
  vtt_url?: string;
  label: string;
  land: string;
  default?: boolean;
}

export interface StreamServer {
  id: string;
  name: string;
  url: string;
  isEmbed?: boolean;
  quality?: string;
  isDefault?: boolean;
}

interface HlsPlayerModalProps {
  streamUrl: string;
  backupUrl?: string | null;
  servers?: StreamServer[];
  channelName: string;
  isOpen: boolean;
  onClose: () => void;
  subtitles?: SubtitleTrack[];
}

function checkIsEmbedUrl(url: string, explicitEmbed?: boolean): boolean {
  if (explicitEmbed === true) return true;
  if (!url) return false;
  if (url.includes('.mp4') || url.includes('.m3u8') || url.includes('/live/')) {
    return false;
  }
  const lower = url.toLowerCase();
  return (
    lower.includes('vidlink.pro') ||
    lower.includes('multiembed.mov') ||
    lower.includes('vidsrc.to') ||
    lower.includes('2embed.cc') ||
    lower.includes('streamwish') ||
    lower.includes('dwish.pro') ||
    lower.includes('/e/') ||
    lower.includes('/embed/') ||
    lower.includes('embedtv')
  );
}

export function HlsPlayerModal({
  streamUrl,
  backupUrl,
  servers = [],
  channelName,
  isOpen,
  onClose,
  subtitles = [],
}: HlsPlayerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const subMenuRef = useRef<HTMLDivElement>(null);
  const serverMenuRef = useRef<HTMLDivElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showServerMenu, setShowServerMenu] = useState(false);


  const toggleFullscreen = useCallback(() => {
    const container = playerContainerRef.current || videoRef.current;
    if (!container) return;

    if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
      if (container.requestFullscreen) {
        container.requestFullscreen().catch(() => {
          videoRef.current?.requestFullscreen?.();
        });
      } else if ((container as any).webkitRequestFullscreen) {
        (container as any).webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      }
    }
  }, []);

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
    };
  }, []);

  // Synthesize unified server list
  const effectiveServers = useMemo<StreamServer[]>(() => {
    if (servers && servers.length > 0) {
      return servers;
    }
    const list: StreamServer[] = [];
    if (streamUrl) {
      list.push({
        id: 'primary',
        name: 'سيرفر VIP فائق السرعة',
        url: streamUrl,
        isEmbed: checkIsEmbedUrl(streamUrl),
        quality: '1080p',
        isDefault: true,
      });
    }
    if (backupUrl) {
      list.push({
        id: 'backup',
        name: 'سيرفر بديل',
        url: backupUrl,
        isEmbed: checkIsEmbedUrl(backupUrl, true),
        quality: 'HD',
      });
    }
    return list;
  }, [servers, streamUrl, backupUrl]);

  // Determine initial active server index
  const [activeServerIndex, setActiveServerIndex] = useState<number>(0);

  useEffect(() => {
    if (effectiveServers.length > 0) {
      const defIdx = effectiveServers.findIndex((s) => s.isDefault);
      setActiveServerIndex(defIdx >= 0 ? defIdx : 0);
    } else {
      setActiveServerIndex(0);
    }
  }, [effectiveServers, isOpen]);

  const activeServer = effectiveServers[activeServerIndex] || effectiveServers[0] || null;
  const activeUrl = activeServer?.url || streamUrl;
  const isEmbed = checkIsEmbedUrl(activeUrl, activeServer?.isEmbed);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [selectedSub, setSelectedSub] = useState<string>('auto');
  const [showSubMenu, setShowSubMenu] = useState(false);
  const [internalSubtitles, setInternalSubtitles] = useState<SubtitleTrack[]>(subtitles || []);
  const [loadingSubtitles, setLoadingSubtitles] = useState(false);

  const fullStreamUrl = useMemo(() => {
    if (typeof window === 'undefined') return activeUrl;
    if (activeUrl.startsWith('http://') || activeUrl.startsWith('https://')) return activeUrl;
    return `${window.location.origin}${activeUrl.startsWith('/') ? activeUrl : `/${activeUrl}`}`;
  }, [activeUrl]);

  const handleCopyUrl = useCallback(() => {
    navigator.clipboard.writeText(fullStreamUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [fullStreamUrl]);

  const [isMuted, setIsMuted] = useState(false);
  const [needsClickToPlay, setNeedsClickToPlay] = useState(false);

  const handlePlayClick = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    setIsMuted(false);
    video.play().then(() => {
      setIsPlaying(true);
      setIsLoading(false);
      setNeedsClickToPlay(false);
    }).catch(() => {
      video.muted = true;
      setIsMuted(true);
      video.play().then(() => {
        setIsPlaying(true);
        setIsLoading(false);
        setNeedsClickToPlay(false);
      });
    });
  }, []);

  const handleUnmute = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    setIsMuted(false);
  }, []);

  const handleRetry = useCallback(() => {
    setError(null);
    setIsLoading(true);
    setIsPlaying(false);
    setNeedsClickToPlay(false);
    setReloadKey((prev) => prev + 1);
  }, []);

  // Update internal subtitles when props change
  useEffect(() => {
    if (subtitles && subtitles.length > 0) {
      setInternalSubtitles(subtitles);
    }
  }, [subtitles]);

  // Autonomously manage subtitles if passed via props
  useEffect(() => {
    if (!isOpen || !activeUrl || isEmbed) return;
  }, [isOpen, activeUrl, isEmbed]);

  // Close dropdowns on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (subMenuRef.current && !subMenuRef.current.contains(event.target as Node)) {
        setShowSubMenu(false);
      }
      if (serverMenuRef.current && !serverMenuRef.current.contains(event.target as Node)) {
        setShowServerMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);


  const effectiveSubtitles = useMemo(() => {
    return internalSubtitles.length > 0 ? internalSubtitles : subtitles;
  }, [internalSubtitles, subtitles]);

  // Compute active subtitle track (prioritizing Arabic by default)
  const activeTrack = useMemo(() => {
    if (!effectiveSubtitles || effectiveSubtitles.length === 0 || selectedSub === 'off') {
      return null;
    }
    if (selectedSub !== 'auto') {
      return effectiveSubtitles.find((s) => s.src === selectedSub) || null;
    }
    const ar = effectiveSubtitles.find(
      (s) => s.land?.toLowerCase() === 'ar' || s.label?.toLowerCase().includes('arab')
    );
    if (ar) return ar;
    const def = effectiveSubtitles.find((s) => s.default);
    if (def) return def;
    const en = effectiveSubtitles.find(
      (s) => s.land?.toLowerCase() === 'en' || s.label?.toLowerCase().includes('eng')
    );
    if (en) return en;
    return effectiveSubtitles[0] || null;
  }, [effectiveSubtitles, selectedSub]);

  // Ensure text tracks are set to showing mode
  useEffect(() => {
    const video = videoRef.current;
    if (!video || isEmbed) return;
    const applySubMode = () => {
      if (video.textTracks && video.textTracks.length > 0) {
        for (let i = 0; i < video.textTracks.length; i++) {
          video.textTracks[i].mode = activeTrack ? 'showing' : 'disabled';
        }
      }
    };
    applySubMode();
    const t = setTimeout(applySubMode, 600);
    return () => clearTimeout(t);
  }, [activeTrack, isPlaying, isEmbed]);

  // Setup HLS or direct video playback when NOT an embed
  useEffect(() => {
    if (!isOpen || !activeUrl) return;

    if (isEmbed) {
      // Embed iframe handles its own loading and playback
      setIsLoading(false);
      setError(null);
      setIsPlaying(true);
      return;
    }

    setError(null);
    setIsLoading(true);
    setIsPlaying(false);

    let hls: Hls | null = null;
    const video = videoRef.current;
    if (!video) return;

    let initialLoadTimer: NodeJS.Timeout | null = null;

    const clearErrorAndPlay = () => {
      setError(null);
      setIsLoading(false);
      setIsPlaying(true);
    };

    const handleReady = () => {
      setError(null);
      setIsLoading(false);
    };

    video.addEventListener('loadedmetadata', handleReady);
    video.addEventListener('loadeddata', handleReady);
    video.addEventListener('canplay', handleReady);
    video.addEventListener('canplaythrough', handleReady);
    video.addEventListener('playing', clearErrorAndPlay);
    video.addEventListener('play', clearErrorAndPlay);
    video.addEventListener('timeupdate', () => {
      if (video.currentTime > 0) {
        clearErrorAndPlay();
      }
    });
    let stallTimeout: NodeJS.Timeout | null = null;
    const handleWaiting = () => {
      setIsLoading(true);
      if (stallTimeout) clearTimeout(stallTimeout);
      // Wait patiently for buffer to fill without rewinding or jumping servers
      stallTimeout = setTimeout(() => {
        if (video && video.paused && video.readyState >= 3) {
          video.play().catch(() => {});
        }
      }, 5000);
    };

    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('pause', () => {
      setIsPlaying(false);
    });
    video.addEventListener('error', () => {
      if (video.currentTime === 0) {
        const mediaError = video.error;
        console.error('[HlsPlayer] Video element error:', mediaError);
        setError(mediaError?.message || 'تعذر تشغيل الفيديو من المصدر الأساسي.');
        setIsLoading(false);
      }
    });

    const pathnameOnly = activeUrl.split('?')[0].toLowerCase();
    const isDirectVideo =
      pathnameOnly.endsWith('.mp4') ||
      (activeUrl.toLowerCase().includes('.mp4') && !pathnameOnly.includes('.m3u8')) ||
      activeUrl.includes('format=mp4');

    if (!isDirectVideo && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false, // Smooth, stable IPTV playback without buffer drain
        backBufferLength: 30,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        liveSyncDurationCount: 3, // Keep a healthy 3-segment buffer (10-12s) to absorb network jitters
        liveMaxLatencyDurationCount: 10,
        liveDurationInfinity: true,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.2, // Skip over dropped frames/stutters in source
        nudgeMaxRetry: 10,
        maxBufferHole: 0.8, // Auto-skip micro-holes without buffering spinner
        maxFragLookUpTolerance: 0.5,
        manifestLoadingTimeOut: 10000,
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 500,
        levelLoadingTimeOut: 10000,
        levelLoadingMaxRetry: 6,
        fragLoadingTimeOut: 12000,
        fragLoadingMaxRetry: 8,
        fragLoadingRetryDelay: 500,
        progressive: true,
      });

      hls.loadSource(activeUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_LOADED, () => {
        handleReady();
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        handleReady();
        video.play().then(() => {
          setIsLoading(false);
          setIsPlaying(true);
          setNeedsClickToPlay(false);
        }).catch((err) => {
          console.log('[HlsPlayer] Unmuted autoplay blocked, attempting muted playback:', err);
          video.muted = true;
          setIsMuted(true);
          video.play().then(() => {
            setIsLoading(false);
            setIsPlaying(true);
            setNeedsClickToPlay(false);
          }).catch((err2) => {
            console.log('[HlsPlayer] Autoplay completely blocked, user interaction required:', err2);
            setIsLoading(false);
            setIsPlaying(false);
            setNeedsClickToPlay(true);
          });
        });
      });

      hls.on(Hls.Events.FRAG_LOADED, () => {
        handleReady();
      });

      let networkErrorCount = 0;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              networkErrorCount++;
              const statusCode = data.response?.code;
              // If status is 503 (line busy / stream initializing), give it time instead of flipping servers
              if (statusCode === 503) {
                console.warn('[HlsPlayer] Upstream 503 (stream initializing or line busy), retrying in 2.5s...');
                setTimeout(() => {
                  hls?.startLoad();
                }, 2500);
                break;
              }
              if (networkErrorCount >= 8) {
                // Auto-advance to next server only after sustained failures
                if (effectiveServers.length > activeServerIndex + 1) {
                  console.log('[HlsPlayer] Sustained network errors on current server, advancing to next server...');
                  setActiveServerIndex((prev) => prev + 1);
                  setError(null);
                  setIsLoading(false);
                  hls?.destroy();
                  break;
                }
                console.error('[HlsPlayer] Fatal network error limit reached:', data.details);
                setError('تعذر تحميل رابط البث من السيرفر. اضغط على زر إعادة المحاولة أو اختر سيرفر بديل.');
                setIsLoading(false);
                hls?.destroy();
                break;
              }
              console.warn('[HlsPlayer] Network error during stream load, auto-recovering...', data.details);
              setTimeout(() => {
                hls?.startLoad();
              }, 1000);
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('[HlsPlayer] Media error, attempting auto-recovery...', data.details);
              hls?.recoverMediaError();
              break;
            default:
              console.error('[HlsPlayer] Fatal stream error:', data.details);
              if (data.details === 'manifestParsingError') {
                console.log('[HlsPlayer] Direct video stream detected, switching to native player...');
                hls?.destroy();
                video.src = activeUrl;
                video.load();
                setIsLoading(false);
                video.play().catch(() => setIsLoading(false));
                return;
              }
              // If fatal, switch to next server
              if (effectiveServers.length > activeServerIndex + 1) {
                setActiveServerIndex((prev) => prev + 1);
                return;
              }
              if (video.currentTime === 0) {
                setError(`Streaming error: ${data.details}`);
              }
              hls?.destroy();
              setIsLoading(false);
              break;
          }
        }
      });

      initialLoadTimer = setTimeout(() => {
        if (video.currentTime === 0 && !video.paused) {
          if (video.readyState < 2) {
            setError('تعذر استقبال مقاطع البث من السيرفر. اضغط على زر إعادة المحاولة أو اختر سيرفر آخر.');
            setIsLoading(false);
          }
        }
      }, 18000);
    } else {
      video.src = activeUrl;
      video.load();
      video.play().catch((err) => {
        console.log('[HlsPlayer] Autoplay blocked, user interaction required:', err);
        setIsLoading(false);
      });
    }

    // Watchdog for Frozen Picture with moving audio/timer ("عداد يبقا يمشي وصورة واقفة")
    let lastCheckedTime = 0;
    let lastCheckedFrames = -1;
    let frozenFrameCount = 0;
    const frameWatchdog = setInterval(() => {
      if (!video || video.paused || video.ended || video.readyState < 2) return;
      const curTime = video.currentTime;
      let frames = 0;
      if (typeof (video as any).getVideoPlaybackQuality === 'function') {
        frames = (video as any).getVideoPlaybackQuality().totalVideoFrames || 0;
      } else if ('webkitDecodedFrameCount' in video) {
        frames = (video as any).webkitDecodedFrameCount || 0;
      }

      // If time has elapsed > 8.0s but 0 frames have decoded
      if (curTime > 8.0 && frames === 0) {
        console.warn('[HlsPlayer] Audio playing but 0 video frames decoded after 8s.');
        return;
      }

      // If clock is ticking but frames have completely halted for > 10s
      if (curTime > lastCheckedTime + 3.0) {
        if (lastCheckedFrames !== -1 && frames === lastCheckedFrames && frames > 0) {
          frozenFrameCount++;
          if (frozenFrameCount >= 3) {
            console.warn('[HlsPlayer] Video picture frozen for > 10s.');
            frozenFrameCount = 0;
          }
        } else {
          frozenFrameCount = 0;
        }
        lastCheckedTime = curTime;
        lastCheckedFrames = frames;
      }
    }, 2500);

    return () => {
      clearInterval(frameWatchdog);
      if (initialLoadTimer) clearTimeout(initialLoadTimer);
      if (stallTimeout) clearTimeout(stallTimeout);
      video.removeEventListener('loadeddata', handleReady);
      video.removeEventListener('canplay', handleReady);
      video.removeEventListener('canplaythrough', handleReady);
      video.removeEventListener('playing', clearErrorAndPlay);
      video.removeEventListener('play', clearErrorAndPlay);
      video.removeEventListener('waiting', handleWaiting);
      if (hls) {
        hls.destroy();
      }
    };
  }, [isOpen, activeUrl, isEmbed, activeServerIndex, reloadKey]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 md:p-6" dir="rtl">
      <div className="bg-[#111111] border border-[#262626] rounded-2xl max-w-4xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-4 md:px-5 py-3 border-b border-[#222222] flex items-center justify-between bg-[#141414] gap-2">
          <div className="flex items-center gap-2 overflow-hidden shrink min-w-0">
            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${isPlaying ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'}`} />
            <h3 className="text-xs md:text-sm font-bold text-white truncate max-w-md">
              {channelName}
            </h3>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Multi-Server Selection Dropdown */}
            {effectiveServers && effectiveServers.length > 1 && (

              <div className="relative" ref={serverMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowServerMenu((prev) => !prev)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-[#1C1C1C] hover:bg-[#282828] border border-white/10 text-white transition-all shadow-sm"
                  title="تغيير سيرفر البث"
                >
                  <Server className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="truncate max-w-[130px]">{activeServer?.name || 'اختر السيرفر'}</span>
                  {activeServer?.quality && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold">
                      {activeServer.quality}
                    </span>
                  )}
                  <ChevronDown className={`w-3 h-3 text-[#A1A1AA] transition-transform ${showServerMenu ? 'rotate-180' : ''}`} />
                </button>

                {showServerMenu && (
                  <div className="absolute left-0 mt-2 w-64 rounded-xl bg-[#161616] border border-[#2E2E2E] shadow-2xl z-50 p-1.5 space-y-1 backdrop-blur-xl">
                    <div className="px-2.5 py-1.5 text-[10px] font-bold text-[#888888] uppercase tracking-wider border-b border-white/5 flex items-center justify-between">
                      <span>سيرفرات البث المتاحة</span>
                      <span className="text-[9px] text-emerald-400 font-mono">({effectiveServers.length} سيرفرات)</span>
                    </div>

                    {effectiveServers.map((srv, idx) => {
                      const isSelected = idx === activeServerIndex;
                      return (
                        <button
                          key={srv.id || idx}
                          type="button"
                          onClick={() => {
                            setActiveServerIndex(idx);
                            setShowServerMenu(false);
                            setError(null);
                            setIsLoading(true);
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                            isSelected
                              ? 'bg-emerald-500/20 text-white font-bold border border-emerald-500/40'
                              : 'text-[#D4D4D8] hover:bg-[#242424] hover:text-white'
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${isSelected ? 'bg-emerald-400 animate-pulse' : 'bg-[#555555]'}`} />
                            <span className="truncate">{srv.name}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {srv.quality && (
                              <span className="text-[9px] px-1 py-0.5 rounded bg-white/5 text-[#A1A1AA] border border-white/10 font-mono">
                                {srv.quality}
                              </span>
                            )}
                            {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Unified TVARUA VIP Server Badge */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
              <img src="/tvarua_logo.png" alt="TVARUA" className="w-4 h-4 object-contain brightness-125" />
              <span>مشغل TVARUA VIP</span>
            </div>


            {/* Subtitle Selector Button (for native HLS) */}
            {!isEmbed && ((effectiveSubtitles && effectiveSubtitles.length > 0) || loadingSubtitles) && (
              <div className="relative" ref={subMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowSubMenu((prev) => !prev)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    activeTrack
                      ? 'bg-[#E50914]/20 border-[#E50914] text-white shadow-sm ring-1 ring-[#E50914]/40'
                      : 'bg-[#1C1C1C] border-white/10 text-[#A1A1AA] hover:text-white hover:bg-[#282828]'
                  }`}
                  title="خيارات ولغات الترجمة (Subtitles)"
                >
                  {loadingSubtitles ? (
                    <Loader2 className="w-3.5 h-3.5 text-[#E50914] animate-spin" />
                  ) : (
                    <Subtitles className="w-3.5 h-3.5 text-[#E50914]" />
                  )}
                  <span className="hidden sm:inline">
                    {loadingSubtitles
                      ? 'جاري جلب الترجمة...'
                      : activeTrack
                      ? `الترجمة: ${activeTrack.label}`
                      : 'الترجمة (CC)'}
                  </span>
                  <span className="sm:hidden font-mono text-[11px]">
                    {loadingSubtitles ? '...' : activeTrack ? activeTrack.land.toUpperCase() : 'CC'}
                  </span>
                  <ChevronDown className={`w-3 h-3 text-[#A1A1AA] transition-transform ${showSubMenu ? 'rotate-180' : ''}`} />
                </button>

                {/* Subtitle Dropdown Menu */}
                {showSubMenu && (
                  <div className="absolute left-0 mt-2 w-56 rounded-xl bg-[#161616] border border-[#2E2E2E] shadow-2xl z-50 p-1.5 space-y-1 backdrop-blur-xl">
                    <div className="px-2.5 py-1.5 text-[10px] font-bold text-[#888888] uppercase tracking-wider border-b border-white/5 flex items-center justify-between">
                      <span>اختر لغة الترجمة</span>
                      <span className="text-[9px] text-[#A1A1AA]">
                        {loadingSubtitles ? 'جاري الفحص...' : `(${effectiveSubtitles.length} لغات)`}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSub('off');
                        setShowSubMenu(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                        !activeTrack
                          ? 'bg-white/10 text-white font-bold'
                          : 'text-[#A1A1AA] hover:bg-[#242424] hover:text-white'
                      }`}
                    >
                      <span>إيقاف الترجمة (Off)</span>
                      {!activeTrack && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                    </button>

                    <div className="my-1 border-t border-white/5" />

                    {loadingSubtitles ? (
                      <div className="p-3 text-center text-xs text-[#A1A1AA] flex items-center justify-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#E50914]" />
                        <span>جاري جلب ملفات الترجمة...</span>
                      </div>
                    ) : effectiveSubtitles.length === 0 ? (
                      <div className="p-3 text-center text-xs text-[#71717A]">
                        لا تتوفر ترجمات إضافية لهذه الحلقة
                      </div>
                    ) : (
                      effectiveSubtitles.map((track) => {
                        const isSelected = activeTrack?.src === track.src;
                        const isAr = track.land?.toLowerCase() === 'ar' || track.label?.toLowerCase().includes('arab');
                        return (
                          <button
                            key={track.src}
                            type="button"
                            onClick={() => {
                              setSelectedSub(track.src);
                              setShowSubMenu(false);
                            }}
                            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                              isSelected
                                ? 'bg-[#E50914]/20 text-white font-bold border border-[#E50914]/50'
                                : 'text-[#D4D4D8] hover:bg-[#242424] hover:text-white'
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <span>{isAr ? '🇸🇦' : track.land === 'en' ? '🇬🇧' : '🌐'}</span>
                              <span>{track.label}</span>
                              {isAr && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-semibold">
                                  مستحسن
                                </span>
                              )}
                            </span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={toggleFullscreen}
              className="text-[#A1A1AA] hover:text-white transition-colors p-1.5 rounded-lg hover:bg-[#222222]"
              title={isFullscreen ? 'الخروج من ملء الشاشة (ESC)' : 'ملء الشاشة بالكامل (Fullscreen)'}
            >
              {isFullscreen ? <Minimize className="w-4 h-4 text-emerald-400" /> : <Maximize className="w-4 h-4" />}
            </button>

            <button
              onClick={onClose}
              className="text-[#71717A] hover:text-[#F5F5F5] transition-colors p-1.5 rounded-lg hover:bg-[#222222]"
              title="إغلاق"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Video Player Container */}
        <div
          ref={playerContainerRef}
          onDoubleClick={toggleFullscreen}
          className={`relative bg-black w-full flex items-center justify-center overflow-hidden transition-all ${
            isFullscreen ? 'fixed inset-0 z-[9999] h-screen w-screen max-w-none rounded-none' : 'aspect-video'
          }`}
        >
          {isEmbed ? (
            <iframe
              key={activeUrl}
              src={activeUrl}
              className="w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
              allowFullScreen
            />
          ) : (
            <video
              ref={videoRef}
              className="w-full h-full object-contain cursor-pointer"
              controls
              playsInline
              autoPlay
              crossOrigin="anonymous"
              onClick={() => {
                if (videoRef.current) {
                  if (videoRef.current.paused) {
                    handlePlayClick();
                  } else if (isMuted) {
                    videoRef.current.muted = false;
                    setIsMuted(false);
                  }
                }
              }}
            >
              {activeTrack && (
                <track
                  key={activeTrack.src}
                  kind="subtitles"
                  src={activeTrack.vtt_url || activeTrack.src}
                  srcLang={activeTrack.land || 'ar'}
                  label={activeTrack.label}
                  default
                />
              )}
            </video>
          )}

          {/* TVARUA VIP Watermark - Solidly covering Yacine TV QR code & text at bottom-left only */}
          {isPlaying && !isEmbed && (
            <div className="absolute bottom-2 left-2 sm:bottom-3 sm:left-3 z-30 pointer-events-none select-none">
              <div className="bg-[#08090d] border border-[#1b2030] rounded-xl px-2.5 py-1.5 shadow-[0_4px_24px_rgba(0,0,0,0.95)] flex items-center gap-2">
                <img
                  src="/tvarua_logo_clean_alpha.png"
                  alt="TVARUA"
                  className="h-6 sm:h-7 w-auto object-contain drop-shadow"
                />
                <div className="flex flex-col text-left">
                  <span className="text-[11px] sm:text-xs font-black tracking-wider text-white leading-tight">TVARUA</span>
                  <span className="text-[8px] font-bold text-emerald-400 flex items-center gap-1 leading-tight">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    VIP LIVE
                  </span>
                </div>
              </div>
            </div>
          )}


          {/* Muted Autoplay Banner (Click to Unmute) */}
          {isMuted && isPlaying && !isEmbed && (
            <button
              type="button"
              onClick={handleUnmute}
              className="absolute top-4 left-4 z-30 flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs shadow-2xl transition-all cursor-pointer border border-white/30 animate-pulse"
            >
              <VolumeX className="w-4 h-4 text-black" />
              <span>الصوت مكتوم تلقائياً — انقر لتشغيل الصوت 🔊</span>
            </button>
          )}

          {/* Central Play Button Overlay if waiting for user click or paused */}
          {!isPlaying && !isLoading && !error && !isEmbed && (
            <div
              onClick={handlePlayClick}
              className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center cursor-pointer z-20 group transition-all"
            >
              <div className="w-20 h-20 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white flex items-center justify-center shadow-2xl shadow-emerald-500/50 transform group-hover:scale-110 transition-transform">
                <Play className="w-10 h-10 ml-1 fill-white" />
              </div>
              <p className="text-sm font-bold text-white mt-4 bg-black/70 px-5 py-2 rounded-full border border-white/20 shadow-lg">
                انقر لبدء تشغيل البث المباشر 🔊
              </p>
            </div>
          )}

          {/* Loading Indicator (only for native HLS, embed has its own loader) */}
          {isLoading && !isPlaying && !error && !isEmbed && (
            <div className="absolute inset-0 bg-black/75 flex flex-col items-center justify-center p-6 text-center gap-3 pointer-events-none z-10">
              <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
              <p className="text-xs text-white/90 font-medium">جاري تجهيز البث فائق السرعة...</p>
              <p className="text-[11px] text-[#A1A1AA]">TVARUA High-Speed Persistent Stream Rebroadcast</p>
            </div>
          )}

          {/* Error Screen */}
          {error && !isPlaying && !isEmbed && (
            <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-6 text-center gap-3 z-20">
              <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                <AlertCircle className="w-6 h-6" />
              </div>
              <p className="text-sm text-white font-bold max-w-md">
                {error.includes('Offline') || error.includes('غير متوفرة') || error.includes('503') || error.includes('network')
                  ? 'هذه القناة مخصصة للأحداث الرياضية وتبث أثناء المباريات المباشرة فقط'
                  : error}
              </p>
              <p className="text-xs text-[#A1A1AA] max-w-sm">
                يمكنك التبديل إلى القنوات الرياضية الأخرى أو القنوات العامة المتاحة حالياً 24/7.
              </p>

              <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
                <button
                  onClick={handleRetry}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>إعادة المحاولة (Retry)</span>
                </button>
                <button
                  onClick={onClose}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#222] hover:bg-[#333] text-white text-xs font-semibold border border-[#333] transition-colors"
                >
                  <span>اختيار قناة أخرى</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Diagnostics & Controls Footer */}
        <div className="px-4 md:px-5 py-3 border-t border-[#222222] bg-[#0C0C0C] flex flex-col gap-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-[#A1A1AA]">
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0 flex items-center gap-1">
                <Server className="w-3 h-3" />
                <span>مشغل TVARUA VIP الموحد (Direct HD)</span>
              </span>
              {activeTrack && !isEmbed && (
                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#E50914]/15 text-[#FF5A5F] border border-[#E50914]/30 shrink-0 flex items-center gap-1">
                  <Subtitles className="w-3 h-3" />
                  <span>مترجم ({activeTrack.label})</span>
                </span>
              )}
              <span className="font-mono truncate text-neutral-300 select-all" dir="ltr" title={fullStreamUrl}>
                {fullStreamUrl}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={toggleFullscreen}
                className="px-2.5 py-1 rounded-lg bg-[#1C1C1C] hover:bg-[#282828] text-white flex items-center gap-1.5 transition-colors border border-white/10 text-xs font-medium cursor-pointer"
                title="تكبير المشغل إلى ملء الشاشة (Fullscreen)"
              >
                {isFullscreen ? <Minimize className="w-3.5 h-3.5 text-emerald-400" /> : <Maximize className="w-3.5 h-3.5 text-[#A1A1AA]" />}
                <span>{isFullscreen ? 'تصغير' : 'ملء الشاشة'}</span>
              </button>

              <button
                type="button"
                onClick={handleCopyUrl}
                className="px-2.5 py-1 rounded-lg bg-[#1C1C1C] hover:bg-[#282828] text-white flex items-center gap-1.5 transition-colors border border-white/10 text-xs font-medium cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-[#A1A1AA]" />}
                <span>{copied ? 'تم النسخ!' : 'نسخ رابط البث'}</span>
              </button>
              <span className={`font-mono font-semibold px-2 py-0.5 rounded text-[10px] ${
                isPlaying
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
              }`}>
                {isPlaying ? '● LIVE' : isLoading ? 'BUFFERING' : 'READY'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
