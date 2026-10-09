'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { HlsPlayerModal } from '@/components/player/hls-player';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api-client';
import { StreamToken, AdminSettings } from '@aspreen/shared';
import {
  KeyRound,
  Trash2,
  RotateCcw,
  Eye,
  Check,
  Copy,
  X,
  AlertOctagon,
  ShieldAlert,
} from 'lucide-react';

export default function StreamTokensPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [tokens, setTokens] = useState<StreamToken[]>([]);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [loading, setLoading] = useState(true);

  // Rotation modal result
  const [rotatedResult, setRotatedResult] = useState<{ rawToken: string; playbackUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Player preview
  const [playerModalOpen, setPlayerModalOpen] = useState(false);
  const [playerUrl, setPlayerUrl] = useState('');
  const [playerName, setPlayerName] = useState('');

  const fetchTokens = async () => {
    try {
      const [tokenData, settingsData] = await Promise.all([
        api.getStreamTokens(),
        api.getSettings(),
      ]);
      setTokens(tokenData);
      setSettings(settingsData);
    } catch (err) {
      console.error('Failed to load stream tokens:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }
    if (user) {
      fetchTokens();
    }
  }, [user, authLoading, router]);

  const handleRevoke = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to revoke token "${name}"? Playback will be terminated immediately.`)) {
      return;
    }
    try {
      await api.revokeStreamToken(id);
      fetchTokens();
    } catch (err: any) {
      alert(`Revocation failed: ${err.message}`);
    }
  };

  const handleRotate = async (id: string) => {
    try {
      const res = await api.rotateStreamToken(id);
      setRotatedResult({
        rawToken: res.rawToken,
        playbackUrl: res.playbackUrl,
      });
      fetchTokens();
    } catch (err: any) {
      alert(`Rotation failed: ${err.message}`);
    }
  };

  const isExpired = (token: StreamToken) => {
    if (!token.expiresAt) return false;
    return new Date(token.expiresAt).getTime() < Date.now();
  };

  return (
    <div className="min-h-screen bg-[#080808] flex">
      <Sidebar />

      <main className="flex-1 ml-64 flex flex-col min-h-screen">
        <Header
          title="Stream Tokens & Authorized Links"
          subtitle="Cryptographically hashed bearer tokens protecting HLS playlists and media segments"
        />

        <div className="p-8 space-y-6 flex-1">
          {/* Info Banner */}
          <div className="bg-[#111111] border border-[#262626] rounded-lg p-4 flex items-start gap-3 text-xs">
            <ShieldAlert className="w-4 h-4 text-[#A1A1AA] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-[#F5F5F5] font-medium">Zero-Trust Protected Delivery</p>
              <p className="text-[#71717A]">
                Nginx verifies tokens via Fastify subrequests on every playlist index.m3u8 and MPEG-TS media segment.
                Raw tokens are never stored in plaintext in the database or server logs.
              </p>
            </div>
          </div>

          {/* Tokens Table */}
          <div className="bg-[#111111] border border-[#262626] rounded-lg overflow-hidden">
            {loading ? (
              <div className="p-12 text-center text-xs text-[#71717A]">Loading tokens...</div>
            ) : tokens.length === 0 ? (
              <div className="p-12 text-center text-[#71717A] space-y-2">
                <KeyRound className="w-8 h-8 text-[#333333] mx-auto" />
                <p className="text-xs font-medium text-[#A1A1AA]">No stream tokens issued</p>
                <p className="text-[11px] text-[#71717A]">
                  Go to Channels and select "Issue Token" to create an authorized playback URL.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#262626] text-[#71717A] font-mono bg-[#0D0D0D]">
                      <th className="py-3 px-4 font-normal">Token Label</th>
                      <th className="py-3 px-4 font-normal">Channel ID</th>
                      <th className="py-3 px-4 font-normal">Output ID</th>
                      <th className="py-3 px-4 font-normal">Status</th>
                      <th className="py-3 px-4 font-normal">Expires</th>
                      <th className="py-3 px-4 font-normal">Last Used</th>
                      <th className="py-3 px-4 font-normal text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1A1A1A]">
                    {tokens.map((t) => {
                      const expired = isExpired(t);
                      const revoked = !!t.revokedAt;
                      const active = !revoked && !expired;

                      return (
                        <tr key={t.id} className="hover:bg-[#141414] transition-colors">
                          <td className="py-3 px-4 font-medium text-[#F5F5F5]">{t.name}</td>
                          <td className="py-3 px-4 font-mono text-[11px] text-[#A1A1AA]">
                            {t.channelId.slice(0, 8)}...
                          </td>
                          <td className="py-3 px-4 font-mono text-[11px] text-[#71717A]">
                            {t.publicOutputId}
                          </td>
                          <td className="py-3 px-4">
                            {active ? (
                              <span className="badge-running">ACTIVE</span>
                            ) : revoked ? (
                              <span className="badge-failed">REVOKED</span>
                            ) : (
                              <span className="badge-stopped">EXPIRED</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-[#71717A] text-[11px]">
                            {t.expiresAt ? new Date(t.expiresAt).toLocaleDateString() : 'Indefinite'}
                          </td>
                          <td className="py-3 px-4 text-[#71717A] text-[11px]">
                            {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleTimeString() : 'Never'}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              {active && (
                                <>
                                  <button
                                    onClick={() => handleRotate(t.id)}
                                    title="Rotate (Replace with New Token)"
                                    className="p-1 rounded text-[#A1A1AA] hover:text-white hover:bg-[#1E1E1E] transition-colors"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleRevoke(t.id, t.name)}
                                    title="Revoke Token Immediately"
                                    className="p-1 rounded text-[#A1A1AA] hover:text-white hover:bg-[#1E1E1E] transition-colors"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Rotated Token Reveal Modal */}
        {rotatedResult && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-[#111111] border border-[#262626] rounded-lg max-w-lg w-full overflow-hidden shadow-2xl">
              <div className="px-5 py-4 border-b border-[#262626] flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#F5F5F5]">New Rotated Playback URL</h3>
                <button
                  onClick={() => setRotatedResult(null)}
                  className="text-[#71717A] hover:text-[#F5F5F5] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="p-3 bg-[#0A0A0A] border border-[#262626] rounded text-xs space-y-2">
                  <div className="text-[10px] text-[#71717A] uppercase font-mono">Rotated Playback Link</div>
                  <div className="font-mono text-xs text-[#F5F5F5] break-all select-all p-2 bg-[#141414] rounded border border-[#222]">
                    {rotatedResult.playbackUrl}
                  </div>
                </div>

                <p className="text-[11px] text-[#A1A1AA]">
                  The old token was revoked. Copy this replacement link into your client application now.
                </p>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(rotatedResult.playbackUrl);
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
                    onClick={() => setRotatedResult(null)}
                    className="btn-secondary py-1.5 px-3 text-xs"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Player Modal */}
        <HlsPlayerModal
          streamUrl={playerUrl}
          channelName={playerName}
          isOpen={playerModalOpen}
          onClose={() => setPlayerModalOpen(false)}
        />
      </main>
    </div>
  );
}
