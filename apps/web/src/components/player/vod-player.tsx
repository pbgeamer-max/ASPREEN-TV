'use client';

import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  RefreshCw,
  AlertCircle,
  Tv,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import { api } from '@/lib/api-client';

interface VodPlayerProps {
  title: string;
  streamUrl: string;
  posterUrl?: string;
  onClose?: () => void;
}

export function VodPlayer({ title, streamUrl, posterUrl, onClose }: VodPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Player mode: 'direct' (Aspreen TV native player) is ALWAYS DEFAULT
  const [playerMode, setPlayerMode] = useState<'direct' | 'embed'>('direct');
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Resolve stream to direct MP4/M3U8 file if needed
  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);
    setResolvedUrl(null);

    // If stream URL is already a direct video file (.mp4 / .m3u8) or direct relay endpoint
    if (
      streamUrl.toLowerCase().includes('.mp4') ||
      streamUrl.toLowerCase().includes('.m3u8') ||
      streamUrl.includes('/api/vod/stream/')
    ) {
      setResolvedUrl(streamUrl);
      setLoading(false);
      return;
    }

    // Attempt to resolve through API (e.g. 71stream -> Cloudflare R2 MP4)
    api
      .resolveStream(streamUrl)
      .then((res) => {
        if (!isMounted) return;
        if (res.directUrl && res.directUrl !== streamUrl) {
          setResolvedUrl(res.directUrl);
        } else {
          setResolvedUrl(streamUrl);
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setResolvedUrl(streamUrl);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [streamUrl]);

  // Setup HLS or direct HTML5 video playback
  useEffect(() => {
    if (playerMode !== 'direct') return;
    const video = videoRef.current;
    if (!video || !resolvedUrl) return;

    let hls: Hls | null = null;
    const isHls = resolvedUrl.toLowerCase().includes('.m3u8');
    const apiBase = process.env.NEXT_PUBLIC_API_URL || '/api';
    const effectiveStreamUrl =
      isHls && !resolvedUrl.includes('/proxy-stream')
        ? `${apiBase}/vod/proxy-stream?url=${encodeURIComponent(resolvedUrl)}`
        : resolvedUrl;

    if (isHls && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
      });

      hls.loadSource(effectiveStreamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              setError('تعذر تحميل أجزاء البث المباشر. يمكنك التبديل إلى السيرفر الاحتياطي.');
              hls?.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls?.recoverMediaError();
              break;
            default:
              setError('حدث خطأ أثناء تشغيل الفيديو المباشر.');
              hls?.destroy();
              break;
          }
        }
      });
    } else {
      // Standard MP4 or Safari native HLS
      video.src = effectiveStreamUrl;
      video.play().catch(() => {});
    }

    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, [resolvedUrl, playerMode]);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
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
                مشغل موقعي الخاص
              </span>
            </div>
            <p className="text-[10px] text-[#71717A] mt-0.5 font-mono">
              بث مباشر نقي ومحمي بدون إعلانات خارجية
            </p>
          </div>
        </div>

        {/* Player Mode Switcher */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 bg-[#161616] p-1 rounded-xl border border-[#2E2E2E]">
            <button
              onClick={() => setPlayerMode('direct')}
              className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                playerMode === 'direct'
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-950/40'
                  : 'text-[#A1A1AA] hover:text-white'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>مشغل موقعي (افتراضي)</span>
            </button>

            <button
              onClick={() => setPlayerMode('embed')}
              className={`px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                playerMode === 'embed'
                  ? 'bg-[#2A2A2A] text-white border border-white/10'
                  : 'text-[#71717A] hover:text-[#A1A1AA]'
              }`}
              title="استخدام سيرفر خارجي بديل في حال وجود مشكلة في الرابط المباشر"
            >
              <ExternalLink className="w-3 h-3" />
              <span>سيرفر بديل (احتياطي)</span>
            </button>
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
            <span className="text-xs">جاري تجهيز مشغل الموقع الخاص واستخراج رابط البث المباشر...</span>
          </div>
        )}

        {playerMode === 'direct' ? (
          <video
            ref={videoRef}
            controls
            autoPlay
            playsInline
            poster={posterUrl}
            className="w-full h-full object-contain"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onError={() => {
              setError('تعذر تشغيل الفيديو عبر المشغل المباشر. يمكنك التبديل إلى السيرفر الاحتياطي بنقرة واحدة.');
            }}
          />
        ) : (
          <iframe
            src={streamUrl}
            className="w-full h-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-forms allow-fullscreen"
          />
        )}

        {error && playerMode === 'direct' && (
          <div className="absolute inset-0 bg-black/95 z-20 flex flex-col items-center justify-center p-6 text-center gap-3">
            <AlertCircle className="w-8 h-8 text-amber-500" />
            <p className="text-xs text-[#F5F5F5] font-medium max-w-md">{error}</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPlayerMode('embed')}
                className="px-4 py-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-xs font-bold rounded-lg shadow-lg flex items-center gap-2 transition-all"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>التبديل إلى السيرفر الاحتياطي الآن</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer Status Bar */}
      <div className="flex items-center justify-between text-[11px] text-[#71717A] pt-1">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-emerald-400 font-medium">
            {playerMode === 'direct'
              ? '✓ شغال عبر مشغل الموقع الداخلي (Aspreen Native Player)'
              : '⚡ شغال عبر السيرفر الاحتياطي (Sandbox)'}
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
