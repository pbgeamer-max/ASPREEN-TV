'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Hls from 'hls.js';
import { X, AlertCircle, RefreshCw, Loader2, Copy, Check } from 'lucide-react';

interface HlsPlayerModalProps {
  streamUrl: string;
  backupUrl?: string | null;
  channelName: string;
  isOpen: boolean;
  onClose: () => void;
}

export function HlsPlayerModal({ streamUrl, backupUrl, channelName, isOpen, onClose }: HlsPlayerModalProps) {
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

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
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
            <button
              onClick={onClose}
              className="text-[#71717A] hover:text-[#F5F5F5] transition-colors p-1.5 rounded-lg hover:bg-[#222222]"
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
          />

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
