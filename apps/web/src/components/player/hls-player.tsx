'use client';

import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Play, Pause, X, AlertCircle } from 'lucide-react';

interface HlsPlayerModalProps {
  streamUrl: string;
  channelName: string;
  isOpen: boolean;
  onClose: () => void;
}

export function HlsPlayerModal({ streamUrl, channelName, isOpen, onClose }: HlsPlayerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !streamUrl) return;

    setError(null);
    let hls: Hls | null = null;
    const video = videoRef.current;

    if (!video) return;

    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              setError('Network error: Unable to connect or stream segments not yet generated.');
              hls?.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              setError('Media playback error: Stream format issue.');
              hls?.recoverMediaError();
              break;
            default:
              setError(`Fatal streaming error: ${data.details}`);
              hls?.destroy();
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        video.play().catch(() => {});
      });
    } else {
      setError('HLS playback is not supported by your current browser.');
    }

    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, [isOpen, streamUrl]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-[#111111] border border-[#262626] rounded-lg max-w-3xl w-full overflow-hidden shadow-2xl">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-[#262626] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
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
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />

          {error && (
            <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-6 text-center gap-2">
              <AlertCircle className="w-8 h-8 text-[#A1A1AA]" />
              <p className="text-sm text-[#F5F5F5] font-medium">{error}</p>
              <p className="text-xs text-[#71717A] max-w-md">
                Ensure transcoding is currently running for this channel and segments have been generated.
              </p>
            </div>
          )}
        </div>

        {/* Diagnostics & Info */}
        <div className="px-5 py-3 border-t border-[#262626] bg-[#0A0A0A] flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[11px] text-[#A1A1AA]">
            <span className="font-mono truncate max-w-xl">URL: {streamUrl}</span>
            <span className="text-[#71717A] shrink-0 font-mono">STATUS: {isPlaying ? 'PLAYING' : 'READY'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
