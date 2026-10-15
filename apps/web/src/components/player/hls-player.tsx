'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Hls from 'hls.js';
import { X, AlertCircle, RefreshCw, Loader2, Copy, Check } from 'lucide-react';

interface HlsPlayerModalProps {
  streamUrl: string;
  channelName: string;
  isOpen: boolean;
  onClose: () => void;
}

export function HlsPlayerModal({ streamUrl, channelName, isOpen, onClose }: HlsPlayerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);

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


  useEffect(() => {
    if (!isOpen || !streamUrl) return;

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

    video.addEventListener('playing', clearErrorAndPlay);
    video.addEventListener('play', clearErrorAndPlay);
    video.addEventListener('timeupdate', () => {
      if (video.currentTime > 0) {
        clearErrorAndPlay();
      }
    });
    video.addEventListener('pause', () => {
      setIsPlaying(false);
    });

    const isMp4 = streamUrl.toLowerCase().includes('.mp4');

    if (!isMp4 && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        manifestLoadingTimeOut: 15000,
        manifestLoadingMaxRetry: 15,
        manifestLoadingRetryDelay: 1000,
        levelLoadingTimeOut: 15000,
        levelLoadingMaxRetry: 10,
        fragLoadingTimeOut: 20000,
        fragLoadingMaxRetry: 10,
      });

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_LOADED, () => {
        setError(null);
        setIsLoading(false);
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setError(null);
        setIsLoading(false);
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.FRAG_LOADED, () => {
        setError(null);
        setIsLoading(false);
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              // For on-demand live streams, initial playlist takes a few seconds to generate on disk.
              // Keep recovering automatically with startLoad().
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
                video.play().catch(() => {});
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

      // Timeout: If after 18 seconds stream hasn't produced any frames, show error
      initialLoadTimer = setTimeout(() => {
        if (video.currentTime === 0 && !video.paused) {
          // Check if video is playing or still unbuffered
          if (video.readyState < 2) {
            setError('Network error: Unable to connect or stream segments not yet generated.');
            setIsLoading(false);
          }
        }
      }, 18000);

    } else {
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        video.play().catch(() => {});
      });
    }

    return () => {
      if (initialLoadTimer) clearTimeout(initialLoadTimer);
      video.removeEventListener('playing', clearErrorAndPlay);
      video.removeEventListener('play', clearErrorAndPlay);
      if (hls) {
        hls.destroy();
      }
    };
  }, [isOpen, streamUrl, reloadKey]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-[#111111] border border-[#262626] rounded-lg max-w-3xl w-full overflow-hidden shadow-2xl">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-[#262626] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full ${isPlaying ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'}`} />
            <h3 className="text-sm font-semibold text-[#F5F5F5]">{channelName} — Stream Preview</h3>
          </div>
          <button
            onClick={onClose}
            className="text-[#71717A] hover:text-[#F5F5F5] transition-colors p-1 rounded hover:bg-[#1A1A1A]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Video Player Container */}
        <div className="relative bg-black aspect-video flex items-center justify-center">
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            controls
            playsInline
            autoPlay
          />

          {/* Loading Indicator during startup buffering */}
          {isLoading && !isPlaying && !error && (
            <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center p-6 text-center gap-3 pointer-events-none">
              <Loader2 className="w-8 h-8 text-white/80 animate-spin" />
              <p className="text-xs text-white/80 font-mono">جاري استقبال وتحضير البث المباشر...</p>
              <p className="text-[11px] text-white/40">Initial segments generating in FFmpeg</p>
            </div>
          )}

          {/* Error Screen (only shown if not actively playing) */}
          {error && !isPlaying && (
            <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-6 text-center gap-3 z-10">
              <AlertCircle className="w-8 h-8 text-rose-400" />
              <p className="text-sm text-[#F5F5F5] font-medium">{error}</p>
              <p className="text-xs text-[#A1A1AA] max-w-md">
                ملاحظة: القنوات التي لا تبث مباريات حالياً تتوقف من المصدر الرسمي تلقائياً وتعود للعمل فور انطلاق الفعاليات.
              </p>
              <button
                onClick={handleRetry}
                className="mt-2 flex items-center gap-2 px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                إعادة المحاولة (Retry)
              </button>
            </div>
          )}
        </div>

        {/* Diagnostics & Info */}
        <div className="px-5 py-3 border-t border-[#262626] bg-[#0A0A0A] flex flex-col gap-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-[#A1A1AA]">
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
                بث معاد من موقعك 24/7
              </span>
              <span className="font-mono truncate text-neutral-300 select-all" title={fullStreamUrl}>
                {fullStreamUrl}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleCopyUrl}
                className="px-2.5 py-1 rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] text-white flex items-center gap-1.5 transition-colors border border-white/10 text-xs font-medium"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'تم النسخ!' : 'نسخ رابط البث المعاد'}</span>
              </button>
              <span className={`font-mono font-semibold ${isPlaying ? 'text-emerald-400' : 'text-amber-400'}`}>
                {isPlaying ? '● LIVE' : isLoading ? 'BUFFERING' : 'READY'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

