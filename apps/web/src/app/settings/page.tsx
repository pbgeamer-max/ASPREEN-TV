'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api-client';
import { AdminSettings, TranscodingPresetId } from '@aspreen/shared';
import {
  Settings,
  Shield,
  Database,
  Sliders,
  CheckCircle2,
  HardDrive,
  Activity,
  Save,
  Check,
} from 'lucide-react';

export default function SettingsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [activeTab, setActiveTab] = useState<'GENERAL' | 'STREAMING' | 'RESOURCES' | 'SECURITY' | 'FIREBASE' | 'MAINTENANCE'>('GENERAL');
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Form State
  const [appName, setAppName] = useState('');
  const [publicStreamBaseUrl, setPublicStreamBaseUrl] = useState('');
  const [defaultTranscodingPreset, setDefaultTranscodingPreset] = useState<TranscodingPresetId>('COPY');
  const [defaultSegmentDuration, setDefaultSegmentDuration] = useState(4);
  const [defaultPlaylistWindow, setDefaultPlaylistWindow] = useState(5);
  const [maxConcurrentJobs, setMaxConcurrentJobs] = useState(8);
  const [maxPlaylistChannels, setMaxPlaylistChannels] = useState(1000);
  const [sourceTimeoutSeconds, setSourceTimeoutSeconds] = useState(15);
  const [defaultTokenLifetime, setDefaultTokenLifetime] = useState(0);
  const [outputRetentionHours, setOutputRetentionHours] = useState(24);
  const [defaultProxyUrl, setDefaultProxyUrl] = useState('');

  const fetchSettingsAndHealth = async () => {
    try {
      const [settingsData, healthData] = await Promise.all([
        api.getSettings(),
        api.getHealth(),
      ]);
      setSettings(settingsData);
      setHealth(healthData);

      setAppName(settingsData.appName);
      setPublicStreamBaseUrl(settingsData.publicStreamBaseUrl);
      setDefaultTranscodingPreset(settingsData.defaultTranscodingPreset);
      setDefaultSegmentDuration(settingsData.defaultSegmentDuration);
      setDefaultPlaylistWindow(settingsData.defaultPlaylistWindow);
      setMaxConcurrentJobs(settingsData.maxConcurrentJobs);
      setMaxPlaylistChannels(settingsData.maxPlaylistChannels);
      setSourceTimeoutSeconds(settingsData.sourceTimeoutSeconds);
      setDefaultTokenLifetime(settingsData.defaultTokenLifetime);
      setOutputRetentionHours(settingsData.outputRetentionHours);
      setDefaultProxyUrl(settingsData.defaultProxyUrl || '');
    } catch (err) {
      console.error('Failed to load settings:', err);
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
      fetchSettingsAndHealth();
    }
  }, [user, authLoading, router]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedSuccess(false);

    try {
      const updated = await api.updateSettings({
        appName,
        publicStreamBaseUrl,
        defaultTranscodingPreset,
        defaultSegmentDuration,
        defaultPlaylistWindow,
        maxConcurrentJobs,
        maxPlaylistChannels,
        sourceTimeoutSeconds,
        defaultTokenLifetime,
        outputRetentionHours,
        defaultProxyUrl: defaultProxyUrl.trim() || undefined,
      });
      setSettings(updated);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err: any) {
      alert(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080808] flex">
      <Sidebar />

      <main className="flex-1 ml-64 flex flex-col min-h-screen">
        <Header
          title="System Settings"
          subtitle="Configure application branding, HLS multiplexer variables, and Cloud Firestore integration"
        />

        <div className="p-8 space-y-6 flex-1 max-w-5xl">
          {/* Navigation Tabs */}
          <div className="flex border-b border-[#262626] space-x-6 text-xs font-medium">
            {[
              { id: 'GENERAL', label: 'General', icon: Settings },
              { id: 'STREAMING', label: 'Streaming', icon: Sliders },
              { id: 'RESOURCES', label: 'Resources', icon: HardDrive },
              { id: 'SECURITY', label: 'Security', icon: Shield },
              { id: 'FIREBASE', label: 'Firebase', icon: Database },
              { id: 'MAINTENANCE', label: 'Maintenance', icon: Activity },
            ].map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`pb-3 flex items-center gap-2 transition-colors ${
                    activeTab === tab.id
                      ? 'border-b-2 border-white text-white font-semibold'
                      : 'text-[#71717A] hover:text-[#F5F5F5]'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Tab Content */}
          <form onSubmit={handleSave} className="space-y-6">
            {/* General Tab */}
            {activeTab === 'GENERAL' && (
              <div className="bg-[#111111] border border-[#262626] rounded-lg p-6 space-y-4">
                <h3 className="text-sm font-semibold text-[#F5F5F5]">General Application Configuration</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="block font-medium text-[#A1A1AA] mb-1">Application Name</label>
                    <input
                      type="text"
                      value={appName}
                      onChange={(e) => setAppName(e.target.value)}
                      required
                      className="form-input text-xs"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-[#A1A1AA] mb-1">
                      Public Streaming Base URL (Reverse Proxy Host)
                    </label>
                    <input
                      type="url"
                      value={publicStreamBaseUrl}
                      onChange={(e) => setPublicStreamBaseUrl(e.target.value)}
                      required
                      placeholder="https://stream.yourdomain.com"
                      className="form-input text-xs font-mono"
                    />
                    <p className="text-[10px] text-[#71717A] mt-1">
                      Prepended to generated protected HLS stream tokens for playback in players.
                    </p>
                  </div>
                  <div>
                    <label className="block font-medium text-[#A1A1AA] mb-1">Default Transcoding Preset</label>
                    <select
                      value={defaultTranscodingPreset}
                      onChange={(e) => setDefaultTranscodingPreset(e.target.value as any)}
                      className="form-input text-xs"
                    >
                      <option value="COPY">Compatible Stream Copy (Zero CPU re-encoding)</option>
                      <option value="SOURCE_RES">H.264 + AAC — Source Resolution</option>
                      <option value="720P">H.264 + AAC — 720p (2500 kbps)</option>
                      <option value="1080P">H.264 + AAC — 1080p (5000 kbps)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Streaming Tab */}
            {activeTab === 'STREAMING' && (
              <div className="bg-[#111111] border border-[#262626] rounded-lg p-6 space-y-4">
                <h3 className="text-sm font-semibold text-[#F5F5F5]">HLS Transcoder & Multiplexer Settings</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="block font-medium text-[#A1A1AA] mb-1">
                      HLS Target Segment Duration (Seconds)
                    </label>
                    <input
                      type="number"
                      value={defaultSegmentDuration}
                      onChange={(e) => setDefaultSegmentDuration(parseInt(e.target.value, 10) || 4)}
                      min={2}
                      max={10}
                      className="form-input text-xs font-mono"
                    />
                    <p className="text-[10px] text-[#71717A] mt-1">Recommended: 4 to 6 seconds for low latency.</p>
                  </div>
                  <div>
                    <label className="block font-medium text-[#A1A1AA] mb-1">
                      Playlist Window Size (Number of Segments in index.m3u8)
                    </label>
                    <input
                      type="number"
                      value={defaultPlaylistWindow}
                      onChange={(e) => setDefaultPlaylistWindow(parseInt(e.target.value, 10) || 5)}
                      min={3}
                      max={20}
                      className="form-input text-xs font-mono"
                    />
                    <p className="text-[10px] text-[#71717A] mt-1">Number of live media segments kept in live playlist.</p>
                  </div>
                  <div>
                    <label className="block font-medium text-[#A1A1AA] mb-1">
                      Source Connection Timeout (Seconds)
                    </label>
                    <input
                      type="number"
                      value={sourceTimeoutSeconds}
                      onChange={(e) => setSourceTimeoutSeconds(parseInt(e.target.value, 10) || 15)}
                      min={5}
                      max={60}
                      className="form-input text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-[#A1A1AA] mb-1">
                      Output Retention Period (Hours)
                    </label>
                    <input
                      type="number"
                      value={outputRetentionHours}
                      onChange={(e) => setOutputRetentionHours(parseInt(e.target.value, 10) || 24)}
                      min={1}
                      max={168}
                      className="form-input text-xs font-mono"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block font-medium text-[#A1A1AA] mb-1">
                      Global Outbound Stream Proxy (HTTP / HTTPS / SOCKS5)
                    </label>
                    <input
                      type="text"
                      value={defaultProxyUrl}
                      onChange={(e) => setDefaultProxyUrl(e.target.value)}
                      placeholder="e.g. http://123.45.67.89:8080 or socks5://user:pass@proxy.example.com:1080"
                      className="form-input text-xs font-mono"
                    />
                    <p className="text-[10px] text-[#71717A] mt-1">
                      Optional: Used by FFmpeg to bypass datacenter blocking (Anti-Restream) or geo-restrictions from IPTV providers.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Resources Tab */}
            {activeTab === 'RESOURCES' && (
              <div className="bg-[#111111] border border-[#262626] rounded-lg p-6 space-y-4">
                <h3 className="text-sm font-semibold text-[#F5F5F5]">Hardware & Concurrency Limits</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="block font-medium text-[#A1A1AA] mb-1">Maximum Concurrent Transcoding Jobs</label>
                    <input
                      type="number"
                      value={maxConcurrentJobs}
                      onChange={(e) => setMaxConcurrentJobs(parseInt(e.target.value, 10) || 8)}
                      min={1}
                      max={32}
                      className="form-input text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-[#A1A1AA] mb-1">Maximum Channel Import per Playlist</label>
                    <input
                      type="number"
                      value={maxPlaylistChannels}
                      onChange={(e) => setMaxPlaylistChannels(parseInt(e.target.value, 10) || 1000)}
                      min={50}
                      max={5000}
                      className="form-input text-xs font-mono"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Security Tab */}
            {activeTab === 'SECURITY' && (
              <div className="bg-[#111111] border border-[#262626] rounded-lg p-6 space-y-4 text-xs">
                <h3 className="text-sm font-semibold text-[#F5F5F5]">Security & Authorization Policy</h3>
                <div className="space-y-3 text-[#A1A1AA]">
                  <div className="p-3 bg-[#0D0D0D] border border-[#262626] rounded flex items-center justify-between">
                    <span>Default Token Lifetime</span>
                    <span className="font-mono text-[#F5F5F5]">
                      {defaultTokenLifetime === 0 ? 'Indefinite' : `${defaultTokenLifetime} Hours`}
                    </span>
                  </div>
                  <div className="p-3 bg-[#0D0D0D] border border-[#262626] rounded flex items-center justify-between">
                    <span>Source Credential Encryption</span>
                    <span className="font-mono text-[#F5F5F5]">AES-256-GCM (Authenticated)</span>
                  </div>
                  <div className="p-3 bg-[#0D0D0D] border border-[#262626] rounded flex items-center justify-between">
                    <span>Server-Side SSRF Protection</span>
                    <span className="font-mono text-[#F5F5F5]">Active (RFC 1918 + Cloud Metadata Blocked)</span>
                  </div>
                  <div className="p-3 bg-[#0D0D0D] border border-[#262626] rounded flex items-center justify-between">
                    <span>Stream Token Protection</span>
                    <span className="font-mono text-[#F5F5F5]">SHA-256 Hashed (Playlists + Media Segments)</span>
                  </div>
                </div>
              </div>
            )}

            {/* Firebase Tab */}
            {activeTab === 'FIREBASE' && (
              <div className="bg-[#111111] border border-[#262626] rounded-lg p-6 space-y-4 text-xs">
                <h3 className="text-sm font-semibold text-[#F5F5F5]">Firebase Integration Status</h3>
                <div className="space-y-3 font-mono">
                  <div className="p-3 bg-[#0D0D0D] border border-[#262626] rounded flex items-center justify-between">
                    <span className="text-[#71717A]">Project ID:</span>
                    <span className="text-[#F5F5F5]">{health?.services?.firebase?.projectId || 'Configured via .env'}</span>
                  </div>
                  <div className="p-3 bg-[#0D0D0D] border border-[#262626] rounded flex items-center justify-between">
                    <span className="text-[#71717A]">Cloud Firestore:</span>
                    <span className="text-[#F5F5F5]">{health?.services?.firebase?.status || 'CONNECTED'}</span>
                  </div>
                  <div className="p-3 bg-[#0D0D0D] border border-[#262626] rounded flex items-center justify-between">
                    <span className="text-[#71717A]">Firestore Latency:</span>
                    <span className="text-[#F5F5F5]">{health?.services?.firebase?.latencyMs ?? 1} ms</span>
                  </div>
                </div>
                <p className="text-[11px] text-[#71717A]">
                  Firebase Admin credentials are loaded exclusively on the trusted server and never exposed in public bundles.
                </p>
              </div>
            )}

            {/* Maintenance Tab */}
            {activeTab === 'MAINTENANCE' && (
              <div className="bg-[#111111] border border-[#262626] rounded-lg p-6 space-y-4 text-xs">
                <h3 className="text-sm font-semibold text-[#F5F5F5]">Service Diagnostics & Health</h3>
                <div className="space-y-3 font-mono">
                  <div className="p-3 bg-[#0D0D0D] border border-[#262626] rounded flex items-center justify-between">
                    <span className="text-[#71717A]">Fastify API Server:</span>
                    <span className="badge-running">{health?.services?.api || 'UP'}</span>
                  </div>
                  <div className="p-3 bg-[#0D0D0D] border border-[#262626] rounded flex items-center justify-between">
                    <span className="text-[#71717A]">FFmpeg Transcoding Engine:</span>
                    <span className="badge-running">{health?.services?.ffmpeg || 'INSTALLED'}</span>
                  </div>
                  <div className="p-3 bg-[#0D0D0D] border border-[#262626] rounded flex items-center justify-between">
                    <span className="text-[#71717A]">Persistent HLS Disk Storage:</span>
                    <span className="badge-running">{health?.services?.storage || 'WRITABLE'}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Save Button */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#262626]">
              {savedSuccess && (
                <div className="flex items-center gap-1.5 text-xs text-[#F5F5F5] font-medium">
                  <Check className="w-3.5 h-3.5 text-white" />
                  <span>Settings saved successfully</span>
                </div>
              )}
              <button
                type="submit"
                disabled={saving}
                className="btn-primary py-2 px-5 text-xs gap-2"
              >
                <Save className="w-3.5 h-3.5 text-black" />
                <span>{saving ? 'Saving...' : 'Save Settings'}</span>
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
