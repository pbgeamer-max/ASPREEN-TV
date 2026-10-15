'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Hls from 'hls.js';
import { X, AlertCircle, RefreshCw, Loader2, Copy, Check, Subtitles, ChevronDown } from 'lucide-react';

export interface SubtitleTrack {
  src: string;
  vtt_url?: string;
  label: string;
  land: string;
  default?: boolean;
}

interface HlsPlayerModalProps {
  streamUrl: string;
  backupUrl?: string | null;
  channelName: string;
  isOpen: boolean;
  onClose: () => void;
  subtitles?: SubtitleTrack[];
}

export function HlsPlayerModal({ streamUrl, backupUrl, channelName, isOpen, onClose, subtitles = [] }: HlsPlayerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const subMenuRef = useRef<HTMLDivElement>(null);
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
    if (typeof window === 'undefined') return streamUrl;
    if (streamUrl.startsWith('http://') || streamUrl.startsWith('https://')) return streamUrl;
    return `${window.location.origin}${streamUrl.startsWith('/') ? streamUrl : `/${streamUrl}`}`;
  }, [streamUrl]);

  const handleCopyUrl = useCallback(() => {
    navigator.clipboard.writeText(fullStreamUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [fullStreamUrl]);

  const handleRetry = useCallback(() => {
    setError(null);
    setIsLoading(true);
    setIsPlaying(false);
    setReloadKey((prev) => prev + 1);
  }, []);

  // Update internal subtitles when props change
  useEffect(() => {
    if (subtitles && subtitles.length > 0) {
      setInternalSubtitles(subtitles);
    }
  }, [subtitles]);

  // Autonomously auto-fetch subtitles if streamUrl contains epId
  useEffect(() => {
    if (!isOpen || !streamUrl) return;
    try {
      const match = streamUrl.match(/epId=([0-9]+)/);
      if (match && match[1]) {
        const epId = match[1];
        setLoadingSubtitles(true);
        fetch(`/api/app/kisskh/subtitles?epId=${epId}&_t=${Date.now()}`, {
          cache: 'no-store',
          credentials: 'include',
        })
          .then((res) => res.json())
          .then((data) => {
            if (data && data.success && Array.isArray(data.tracks) && data.tracks.length > 0) {
              setInternalSubtitles(data.tracks);
            }
          })
          .catch(() => {})
          .finally(() => setLoadingSubtitles(false));
      }
    } catch {}
  }, [isOpen, streamUrl]);

  // Close subtitle dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (subMenuRef.current && !subMenuRef.current.contains(event.target as Node)) {
        setShowSubMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const effectiveSubtitles = useMemo(() => {
    return internalSubtitles.length > 0 ? internalSubtitles : subtitles;
  }, [internalSubtitles, subtitles]);

  const isKisskh = useMemo(() => {
    return streamUrl.includes('kisskh') || streamUrl.includes('epId=');
  }, [streamUrl]);

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
    if (!video) return;
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
  }, [activeTrack, isPlaying]);

  useEffect(() => {
    if (!isOpen || !streamUrl) return;

    setError(null);
    setIsLoading(true);
    setIsPlaying(false);

    let hls: Hls | null = null;
    const video = videoRef.current;
    if (!video) return;

    let initialLoadTimer: NodeJS.Timeout | null = null;
    let fallbackTried = false;

    const clearErrorAndPlay = () => {
      setError(null);
      setIsLoading(false);
      setIsPlaying(true);
    };

    const handleReady = () => {
      setError(null);
      setIsLoading(false);
    };

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
    video.addEventListener('waiting', () => {
      setIsLoading(true);
    });
    video.addEventListener('pause', () => {
      setIsPlaying(false);
    });
    video.addEventListener('error', () => {
      if (!fallbackTried && backupUrl && !backupUrl.includes('/e/')) {
        fallbackTried = true;
        console.log('[HlsPlayer] Main stream error, silent auto-switching to backup stream...');
        video.src = backupUrl;
        video.load();
        video.play().catch(() => {});
        return;
      }
      if (video.currentTime === 0) {
        const mediaError = video.error;
        console.error('[HlsPlayer] Video element error:', mediaError);
        setError(mediaError?.message || 'تعذر تشغيل الفيديو من المصدر الأساسي.');
        setIsLoading(false);
      }
    });

    const isDirectVideo =
      (streamUrl.toLowerCase().includes('.mp4') && !streamUrl.includes('.m3u8')) ||
      streamUrl.includes('format=mp4');

    if (!isDirectVideo && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        manifestLoadingTimeOut: 15000,
        manifestLoadingMaxRetry: 10,
        manifestLoadingRetryDelay: 1000,
        levelLoadingTimeOut: 15000,
        levelLoadingMaxRetry: 10,
        fragLoadingTimeOut: 20000,
        fragLoadingMaxRetry: 10,
      });

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_LOADED, () => {
        handleReady();
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        handleReady();
        video.play().catch((err) => {
          console.log('[HlsPlayer] Autoplay blocked, waiting for user click:', err);
          setIsLoading(false);
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
              if (networkErrorCount >= 3) {
                console.error('[HlsPlayer] Fatal network error limit reached:', data.details);
                setError('تعذر تحميل رابط البث من السيرفر. اضغط على زر إعادة المحاولة.');
                setIsLoading(false);
                hls?.destroy();
                break;
              }
              console.warn('[HlsPlayer] Network error during segment load, auto-recovering...', data.details);
              hls?.startLoad();
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
                video.src = streamUrl;
                video.load();
                video.play().catch(() => setIsLoading(false));
                return;
              }
              if (video.currentTime === 0) {
                setError(`Fatal streaming error: ${data.details}`);
              }
              hls?.destroy();
              break;
          }
        }
      });

      initialLoadTimer = setTimeout(() => {
        if (video.currentTime === 0 && !video.paused) {
          if (video.readyState < 2) {
            setError('تعذر استقبال مقاطع البث من السيرفر. اضغط على إعادة المحاولة.');
            setIsLoading(false);
          }
        }
      }, 15000);
    } else {
      // Direct native HTML5 video playback
      video.src = streamUrl;
      video.load();
      video.play().catch((err) => {
        console.log('[HlsPlayer] Autoplay blocked, user interaction required:', err);
        setIsLoading(false);
      });
    }

    return () => {
      if (initialLoadTimer) clearTimeout(initialLoadTimer);
      video.removeEventListener('loadeddata', handleReady);
      video.removeEventListener('canplay', handleReady);
      video.removeEventListener('canplaythrough', handleReady);
      video.removeEventListener('playing', clearErrorAndPlay);
      video.removeEventListener('play', clearErrorAndPlay);
      if (hls) {
        hls.destroy();
      }
    };
  }, [isOpen, streamUrl, reloadKey]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 md:p-6" dir="rtl">
      <div className="bg-[#111111] border border-[#262626] rounded-2xl max-w-4xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-4 md:px-5 py-3.5 border-b border-[#222222] flex items-center justify-between bg-[#141414]">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${isPlaying ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'}`} />
            <h3 className="text-xs md:text-sm font-bold text-white truncate max-w-lg">
              {channelName}
            </h3>
          </div>

          <div className="flex items-center gap-2">
            {/* Subtitle Selector Button */}
            {(isKisskh || (effectiveSubtitles && effectiveSubtitles.length > 0)) && (
              <div className="relative" ref={subMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowSubMenu((prev) => !prev)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
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
              onClick={onClose}
              className="text-[#71717A] hover:text-[#F5F5F5] transition-colors p-1.5 rounded-lg hover:bg-[#222222]"
              title="إغلاق"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Video Player Container */}
        <div className="relative bg-black aspect-video w-full flex items-center justify-center overflow-hidden">
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            controls
            playsInline
            autoPlay
            crossOrigin="anonymous"
          >
            {activeTrack && (
              <track
                key={activeTrack.src}
                kind="subtitles"
                src={activeTrack.vtt_url || `/api/app/kisskh/sub-vtt?url=${encodeURIComponent(activeTrack.src)}`}
                srcLang={activeTrack.land || 'ar'}
                label={activeTrack.label}
                default
              />
            )}
          </video>

          {/* Loading Indicator */}
          {isLoading && !isPlaying && !error && (
            <div className="absolute inset-0 bg-black/75 flex flex-col items-center justify-center p-6 text-center gap-3 pointer-events-none z-10">
              <Loader2 className="w-8 h-8 text-[#E50914] animate-spin" />
              <p className="text-xs text-white/90 font-medium">جاري تجهيز البث فائق السرعة...</p>
              <p className="text-[11px] text-[#A1A1AA]">Aspreen High-Speed Stream Rebroadcast</p>
            </div>
          )}

          {/* Error Screen */}
          {error && !isPlaying && (
            <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-6 text-center gap-3 z-20">
              <AlertCircle className="w-8 h-8 text-rose-500" />
              <p className="text-xs md:text-sm text-[#F5F5F5] font-medium">{error}</p>

              <button
                onClick={handleRetry}
                className="mt-2 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#E50914] hover:bg-[#B81D24] text-white text-xs font-semibold shadow-md transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>إعادة المحاولة (Retry)</span>
              </button>
            </div>
          )}
        </div>

        {/* Diagnostics & Controls Footer */}
        <div className="px-4 md:px-5 py-3 border-t border-[#222222] bg-[#0C0C0C] flex flex-col gap-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-[#A1A1AA]">
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
                بث معاد 24/7 VIP
              </span>
              {activeTrack && (
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
                onClick={handleCopyUrl}
                className="px-2.5 py-1 rounded-lg bg-[#1C1C1C] hover:bg-[#282828] text-white flex items-center gap-1.5 transition-colors border border-white/10 text-xs font-medium"
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
