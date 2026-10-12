'use client';

import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  Play,
  Pause,
  Maximize,
  Minimize,
  RefreshCw,
  Tv,
  CheckCircle2,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';

interface VodPlayerProps {
  title: string;
  streamUrl: string;
  backupStreamUrl?: string;
  posterUrl?: string;
  onClose?: () => void;
}

export function VodPlayer({ title, streamUrl, posterUrl, onClose }: VodPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let isMounted = true;
    let hls: Hls | null = null;
    setLoading(true);
    setError(null);

    const video = videoRef.current;
    if (!video) return;

    // Stream URL is the server re-broadcast endpoint (e.g. /api/vod/stream/movie/:id/stream.mp4)
    const isM3u8 = streamUrl.toLowerCase().includes('.m3u8');

    const handlePlaySuccess = () => {
      if (isMounted) {
        setLoading(false);
        setError(null);
      }
    };

    if (isM3u8 && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        startFragPrefetch: true,
      });

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().then(handlePlaySuccess).catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls?.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls?.recoverMediaError();
              break;
            default:
              hls?.destroy();
              if (isMounted) {
                setError('جاري إعادة محاولة الاتصال بالبث المعاد...');
              }
              break;
          }
        }
      });
    } else {
      // Standard HTML5 video playback with Range request support from re-broadcast server
      video.src = streamUrl;

      video.onloadeddata = () => {
        handlePlaySuccess();
      };

      video.oncanplay = () => {
        handlePlaySuccess();
        video.play().catch(() => {});
      };

      video.onerror = () => {
        if (!isMounted) return;
        // If Chrome gets an MPEG-TS remuxed stream on .mp4, auto-attach HLS
        if (Hls.isSupported() && !hls) {
          const m3u8Url = streamUrl.replace(/\.mp4$/i, '.m3u8');
          hls = new Hls({ enableWorker: true, lowLatencyMode: false });
          hls.loadSource(m3u8Url);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play().then(handlePlaySuccess).catch(() => {});
          });
          return;
        }

        // Auto-retry up to 3 times for streaming latency
        if (retryCount < 3) {
          setRetryCount((prev) => prev + 1);
          setTimeout(() => {
            if (video && isMounted) {
              video.load();
              video.play().catch(() => {});
            }
          }, 1500);
        } else {
          setError('جاري تجهيز البث المعاد من المصدر، يرجى الانتظار ثوانٍ أو إعادة المحاولة.');
          setLoading(false);
        }
      };
    }

    return () => {
      isMounted = false;
      if (hls) {
        hls.destroy();
      }
    };
  }, [streamUrl, retryCount]);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const handleManualRetry = () => {
    setError(null);
    setLoading(true);
    setRetryCount(0);
    const video = videoRef.current;
    if (video) {
      video.src = streamUrl;
      video.load();
      video.play().catch(() => {});
    }
  };

  return (
    <div
      ref={containerRef}
      className="p-5 bg-[#0C0C0C] border border-[#262626] rounded-2xl space-y-3.5 shadow-2xl"
    >
      {/* Player Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#1E1E1E]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-600/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
            <Tv className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white line-clamp-1">{title}</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-500/20 flex items-center gap-1 shrink-0">
                <CheckCircle2 className="w-2.5 h-2.5" />
                مشغل موقعي الخاص (بث معاد 100%)
              </span>
            </div>
            <p className="text-[10px] text-[#71717A] mt-0.5 font-mono">
              بث مباشر نقي معاد بالكامل عبر خادم أسبيرين TV بدون روابط خارجية أو إعلانات
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-950/40 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs font-bold">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>بث معاد من خادمك</span>
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className="text-xs text-[#A1A1AA] hover:text-white px-2.5 py-1 rounded-lg hover:bg-[#1E1E1E] transition-colors"
            >
              إغلاق
            </button>
          )}
        </div>
      </div>

      {/* Main Video Stage */}
      <div className="relative aspect-video max-h-[460px] bg-black rounded-xl overflow-hidden border border-[#222222] mx-auto shadow-inner">
        {loading && (
          <div className="absolute inset-0 bg-black/90 z-20 flex flex-col items-center justify-center gap-2 text-[#A1A1AA]">
            <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
            <span className="text-xs">جاري إعادة بث الفيديو عبر خادم موقعك وبدء التشغيل الفوري...</span>
          </div>
        )}

        <video
          ref={videoRef}
          controls
          autoPlay
          playsInline
          poster={posterUrl}
          className="w-full h-full object-contain"
          onPlaying={() => setLoading(false)}
          onWaiting={() => setLoading(true)}
        />

        {error && (
          <div className="absolute inset-0 bg-black/95 z-20 flex flex-col items-center justify-center p-6 text-center gap-3">
            <AlertCircle className="w-8 h-8 text-amber-500" />
            <p className="text-xs text-[#F5F5F5] font-medium max-w-md">{error}</p>
            <button
              onClick={handleManualRetry}
              className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-lg shadow-lg flex items-center gap-2 transition-all cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>إعادة الاتصال بالبث المعاد</span>
            </button>
          </div>
        )}
      </div>

      {/* Footer Status Bar */}
      <div className="flex items-center justify-between text-[11px] text-[#71717A] pt-1">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-emerald-400 font-medium">
            ✓ شغال عبر مشغل الموقع الداخلي (بث معاد بنسبة 100%)
          </span>
        </div>

        <button
          onClick={toggleFullscreen}
          className="hover:text-white flex items-center gap-1 transition-colors text-xs"
        >
          {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
          <span>ملء الشاشة</span>
        </button>
      </div>
    </div>
  );
}
