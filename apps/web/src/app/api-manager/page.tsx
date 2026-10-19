'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api-client';
import { AdminSettings } from '@aspreen/shared';
import {
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  Copy,
  Check,
  RefreshCw,
  Power,
  Tv,
  ExternalLink,
  Code2,
  Terminal,
  Smartphone,
  Globe,
  Radio,
  Server,
  Layers,
  Sparkles,
  Play,
  Lock,
} from 'lucide-react';

export default function ApiManagerPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedM3u, setCopiedM3u] = useState(false);
  const [copiedMasked, setCopiedMasked] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [customKey, setCustomKey] = useState('');
  const [testResult, setTestResult] = useState<any>(null);
  const [testing, setTesting] = useState(false);
  const [codeTab, setCodeTab] = useState<'fetch' | 'android' | 'flutter' | 'm3u'>('fetch');

  const fetchSettings = async () => {
    try {
      const data = await api.getSettings();
      setSettings(data);
      setCustomKey(data.masterApiKey || '');
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
      fetchSettings();
    }
  }, [user, authLoading, router]);

  const baseUrl = settings?.publicStreamBaseUrl || 'https://aspreen-tv-production.up.railway.app';
  const isEnabled = settings?.masterApiEnabled !== false;
  const currentKey = (settings?.masterApiKey || '').trim();

  const channelsApiUrl = currentKey
    ? `${baseUrl}/api/app/channels?api_key=${encodeURIComponent(currentKey)}`
    : `${baseUrl}/api/app/channels`;

  const playlistM3uUrl = `${baseUrl}/api/app/playlist.m3u`;
  const sampleMaskedStream = `${baseUrl}/live/s/YmVpbi12aXAtYmVpbi1zcG9ydHMtMXwx.922128df.m3u8`;

  // Toggle API On/Off
  const handleToggleApi = async () => {
    try {
      setSaving(true);
      const newStatus = !isEnabled;
      await api.updateSettings({ masterApiEnabled: newStatus });
      setSettings((prev) => (prev ? { ...prev, masterApiEnabled: newStatus } : null));
    } catch (err) {
      console.error('Failed to toggle API:', err);
    } finally {
      setSaving(false);
    }
  };

  // Generate new random API Key
  const handleGenerateKey = async () => {
    try {
      setSaving(true);
      const randomKey = 'aspreen_live_' + Math.random().toString(36).substring(2, 12) + Math.random().toString(36).substring(2, 12);
      await api.updateSettings({ masterApiKey: randomKey });
      setSettings((prev) => (prev ? { ...prev, masterApiKey: randomKey } : null));
      setCustomKey(randomKey);
    } catch (err) {
      console.error('Failed to generate key:', err);
    } finally {
      setSaving(false);
    }
  };

  // Save custom key
  const handleSaveCustomKey = async () => {
    try {
      setSaving(true);
      const trimmed = customKey.trim();
      await api.updateSettings({ masterApiKey: trimmed });
      setSettings((prev) => (prev ? { ...prev, masterApiKey: trimmed } : null));
    } catch (err) {
      console.error('Failed to save key:', err);
    } finally {
      setSaving(false);
    }
  };

  // Remove key (make public)
  const handleRemoveKey = async () => {
    try {
      setSaving(true);
      await api.updateSettings({ masterApiKey: '' });
      setSettings((prev) => (prev ? { ...prev, masterApiKey: '' } : null));
      setCustomKey('');
    } catch (err) {
      console.error('Failed to remove key:', err);
    } finally {
      setSaving(false);
    }
  };

  // Live Test of API
  const handleTestApi = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      const t0 = performance.now();
      const res = await fetch(channelsApiUrl);
      const durationMs = Math.round(performance.now() - t0);
      const json = await res.json();
      setTestResult({
        status: res.status,
        durationMs,
        data: json,
      });
    } catch (err: any) {
      setTestResult({
        status: 500,
        durationMs: 0,
        error: err.message || 'Connection failed',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#0A0A0A] text-[#EDEDED] font-sans antialiased selection:bg-white selection:text-black">
      <Sidebar />

      <div className="flex-1 flex flex-col pl-64 overflow-hidden">
        <Header title="إدارة واجهة القنوات والبث المباشر (Master Live TV API)" subtitle="توزيع وتأمين قنوات البث المباشر بدقة عالية وحماية الروابط" />

        <main className="flex-1 overflow-y-auto p-8 space-y-6">
          {/* Top Banner: VOD Migration Notice */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-purple-950/40 via-[#181226] to-[#0D0D0D] border border-purple-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-lg">
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-lg bg-purple-500/20 text-purple-400">
                <Sparkles className="w-5 h-5" />
              </span>
              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  مشروع قنوات التلفاز المستقل بالكامل (100% Live TV Channels)
                </h4>
                <p className="text-xs text-[#A1A1AA] mt-0.5">
                  هذا المشروع (ASPREEN TV) مخصص حصرياً لقنوات التلفاز والبث المباشر. تم نقل مكتبة الأفلام والمسلسلات بالكامل إلى منصة <b>TVORA</b> المستقلة (<a href="https://tvora.site" target="_blank" rel="noreferrer" className="text-purple-400 hover:underline">tvora.site</a>).
                </p>
              </div>
            </div>
            <a
              href="https://tvora.site"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shrink-0 transition-colors"
            >
              <span>فتح منصة TVORA</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          {/* Page Title & Status Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#262626] pb-6">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
                <Tv className="w-7 h-7 text-emerald-400" />
                إدارة واجهة القنوات والبث المباشر (Master Live TV API)
              </h1>
              <p className="text-sm text-[#71717A] mt-1">
                توزيع وتأمين قنوات البث المباشر بدقة عالية وبسيرفرات متعددة مع حماية الروابط وتشفير الـ Segments.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleToggleApi}
                disabled={saving || loading}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                  isEnabled
                    ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/60 hover:bg-emerald-900/40'
                    : 'bg-red-950/40 text-red-300 border border-red-800/60 hover:bg-red-900/40'
                }`}
              >
                <Power className="w-4 h-4" />
                <span>{isEnabled ? 'الـ API نشط ومتاح (Active)' : 'الـ API معطل (Disabled)'}</span>
              </button>

              <button
                onClick={handleTestApi}
                disabled={testing || !isEnabled}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white hover:bg-[#E4E4E7] text-black font-semibold text-xs transition-colors disabled:opacity-50"
              >
                {testing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                <span>فحص استجابة الـ API الآن</span>
              </button>
            </div>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-[#121212] border border-[#262626] flex items-center justify-between">
              <div>
                <p className="text-[11px] text-[#71717A] uppercase font-mono tracking-wider">قنوات البث المباشر</p>
                <p className="text-2xl font-bold text-white mt-1">160+ <span className="text-xs font-normal text-[#A1A1AA]">قناة حية</span></p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <Tv className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#121212] border border-[#262626] flex items-center justify-between">
              <div>
                <p className="text-[11px] text-[#71717A] uppercase font-mono tracking-wider">السيرفرات البديلة (Failover)</p>
                <p className="text-2xl font-bold text-white mt-1">4 سيرفرات <span className="text-xs font-normal text-[#A1A1AA]">لكل قناة</span></p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                <Server className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#121212] border border-[#262626] flex items-center justify-between">
              <div>
                <p className="text-[11px] text-[#71717A] uppercase font-mono tracking-wider">تشفير الروابط (HMAC Tokens)</p>
                <p className="text-2xl font-bold text-emerald-400 mt-1">مفعل 100%</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <Lock className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#121212] border border-[#262626] flex items-center justify-between">
              <div>
                <p className="text-[11px] text-[#71717A] uppercase font-mono tracking-wider">حماية المنصات المعتمدة</p>
                <p className="text-xs font-bold text-white mt-2">
                  <span className="text-emerald-400 flex items-center gap-1 text-xs">
                    <Globe className="w-3.5 h-3.5" /> tvora.site & التطبيق
                  </span>
                </p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                <ShieldCheck className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* 1. Live TV Channels Endpoints */}
          <div className="p-6 rounded-2xl bg-[#121212] border border-[#262626] space-y-6">
            <div className="border-b border-[#202020] pb-3">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Tv className="w-4 h-4 text-emerald-400" />
                روابط واجهة قنوات البث المباشر (Live TV Endpoints)
              </h3>
              <p className="text-xs text-[#71717A] mt-0.5">
                جلب جميع القنوات مع البوسترات وروابط البث والسيرفرات البديلة والتصنيفات (رياضة، أخبار، ترفيه، أطفال).
              </p>
            </div>

            {/* Channels JSON API */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#EDEDED] flex items-center gap-1.5">
                  <Tv className="w-3.5 h-3.5 text-emerald-400" />
                  <span>1. رابط استدعاء القنوات بصيغة JSON (Channels API)</span>
                </span>
                <span className="text-[10px] text-[#71717A]">استجابة سريعة مع السيرفرات المتعددة</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={channelsApiUrl}
                  className="flex-1 bg-[#0A0A0A] border border-[#262626] rounded-xl px-4 py-2.5 text-xs font-mono text-emerald-300 select-all focus:outline-none"
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(channelsApiUrl);
                    setCopiedUrl(true);
                    setTimeout(() => setCopiedUrl(false), 2000);
                  }}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white hover:bg-[#E4E4E7] text-black font-semibold text-xs transition-colors shrink-0"
                >
                  {copiedUrl ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedUrl ? 'تم النسخ!' : 'نسخ الرابط'}</span>
                </button>
              </div>
            </div>

            {/* M3U Playlist URL */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#EDEDED] flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5 text-blue-400" />
                  <span>2. رابط ملف القنوات العام (M3U / IPTV Playlist)</span>
                </span>
                <span className="text-[10px] text-[#71717A]">متوافق مع مشغلات IPTV و VLC و Kodi و Smart TV</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={playlistM3uUrl}
                  className="flex-1 bg-[#0A0A0A] border border-[#262626] rounded-xl px-4 py-2.5 text-xs font-mono text-blue-300 select-all focus:outline-none"
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(playlistM3uUrl);
                    setCopiedM3u(true);
                    setTimeout(() => setCopiedM3u(false), 2000);
                  }}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#222222] hover:bg-[#2C2C2C] text-white border border-[#3A3A3A] font-semibold text-xs transition-colors shrink-0"
                >
                  {copiedM3u ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedM3u ? 'تم النسخ!' : 'نسخ الرابط'}</span>
                </button>
              </div>
            </div>

            {/* Masked Stream Security */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#EDEDED] flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-purple-400" />
                  <span>3. نموذج رابط البث المشفر والمخفي بالكامل (Masked Stream Link)</span>
                </span>
                <span className="text-[10px] text-purple-400 font-mono">حماية ضد السرقة وإخفاء اسم القناة ورقم السيرفر</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={sampleMaskedStream}
                  className="flex-1 bg-[#0A0A0A] border border-purple-500/30 rounded-xl px-4 py-2.5 text-xs font-mono text-purple-300 select-all focus:outline-none"
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(sampleMaskedStream);
                    setCopiedMasked(true);
                    setTimeout(() => setCopiedMasked(false), 2000);
                  }}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs transition-colors shrink-0"
                >
                  {copiedMasked ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedMasked ? 'تم النسخ!' : 'نسخ الرابط المشفر'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* API Security & Whitelist Configuration */}
          <div className="p-6 rounded-2xl bg-[#121212] border border-[#262626] space-y-5">
            <div className="border-b border-[#262626] pb-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-400" />
                التحكم في مفتاح الأمان والتصاريح (Security & Permissions)
              </h3>
              <p className="text-xs text-[#71717A] mt-1">
                الروابط محمية بسيرفر الحماية السحابي، مع تصريح دائم لموقع <b>tvora.site</b> وتطبيق الأندرويد <b>Tvora-Android-App</b>.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-[#A1A1AA] block mb-1.5">مفتاح الحماية النشط (Active API Key)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={customKey}
                    onChange={(e) => setCustomKey(e.target.value)}
                    placeholder="اتركه فارغاً للسماح بالوصول العام، أو اكتب مفتاحك المخصص"
                    className="flex-1 bg-[#0A0A0A] border border-[#262626] rounded-xl px-4 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    onClick={handleSaveCustomKey}
                    disabled={saving}
                    className="px-4 py-2 rounded-xl bg-[#222] hover:bg-[#333] text-xs font-medium text-white border border-[#3A3A3A] transition-colors"
                  >
                    حفظ المفتاح المخصص
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  onClick={handleGenerateKey}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-950/30 hover:bg-amber-900/40 text-amber-300 border border-amber-800/40 text-xs font-semibold transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>توليد مفتاح عشوائي جديد (Regenerate Key)</span>
                </button>

                {currentKey && (
                  <button
                    onClick={handleRemoveKey}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1C1C1C] hover:bg-[#282828] text-xs font-medium text-[#A1A1AA] hover:text-white border border-[#2D2D2D] transition-colors"
                  >
                    <span>إلغاء حماية المفتاح (Open Public Access)</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Test Live Result Panel */}
          {testResult && (
            <div className="p-6 rounded-2xl bg-[#121212] border border-[#262626] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
                    testResult.status === 200 ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-red-950 text-red-400 border border-red-800'
                  }`}>
                    HTTP {testResult.status}
                  </span>
                  <span className="text-xs text-[#71717A]">
                    استجابة في: <b>{testResult.durationMs}ms</b>
                  </span>
                </div>
                <button
                  onClick={() => setTestResult(null)}
                  className="text-xs text-[#71717A] hover:text-white"
                >
                  إغلاق المعاينة
                </button>
              </div>

              <pre className="bg-[#0A0A0A] border border-[#262626] rounded-xl p-4 text-[11px] font-mono text-emerald-300 overflow-x-auto max-h-64">
                {JSON.stringify(testResult.data || testResult, null, 2)}
              </pre>
            </div>
          )}

          {/* Integration Guides for Live TV */}
          <div className="p-6 rounded-2xl bg-[#121212] border border-[#262626] space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Code2 className="w-4 h-4 text-blue-400" />
              أمثلة ربط قنوات البث المباشر (Live TV Integration Examples)
            </h3>

            <div className="flex flex-wrap gap-2 border-b border-[#262626] pb-2">
              <button
                onClick={() => setCodeTab('fetch')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  codeTab === 'fetch' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'text-[#71717A] hover:text-white'
                }`}
              >
                <Globe className="w-3.5 h-3.5 text-emerald-400" />
                <span>JavaScript / Next.js / Web</span>
              </button>

              <button
                onClick={() => setCodeTab('android')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  codeTab === 'android' ? 'bg-[#222] text-white border border-[#3A3A3A]' : 'text-[#71717A] hover:text-white'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5 text-blue-400" />
                <span>Android (Kotlin / ExoPlayer)</span>
              </button>

              <button
                onClick={() => setCodeTab('flutter')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  codeTab === 'flutter' ? 'bg-[#222] text-white border border-[#3A3A3A]' : 'text-[#71717A] hover:text-white'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5 text-purple-400" />
                <span>Flutter (video_player)</span>
              </button>

              <button
                onClick={() => setCodeTab('m3u')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  codeTab === 'm3u' ? 'bg-[#222] text-white border border-[#3A3A3A]' : 'text-[#71717A] hover:text-white'
                }`}
              >
                <Radio className="w-3.5 h-3.5 text-amber-400" />
                <span>VLC / IPTV Apps</span>
              </button>
            </div>

            <div className="bg-[#0A0A0A] border border-[#262626] rounded-xl p-4 font-mono text-xs text-[#E4E4E7] overflow-x-auto">
              {codeTab === 'fetch' && (
                <pre>{`// 1. جلب قائمة قنوات البث المباشر
fetch("${channelsApiUrl}")
  .then(res => res.json())
  .then(data => {
    console.log("إجمالي القنوات المباشرة:", data.total_channels);
    data.channels.forEach(channel => {
      console.log(channel.name, channel.stream_url, channel.logo);
      // تشغيل القناة في المشغل Hls.js
    });
  });`}</pre>
              )}

              {codeTab === 'android' && (
                <pre>{`// تشغيل البث في تطبيق أندرويد باستخدام ExoPlayer
val defaultHttpDataSourceFactory = DefaultHttpDataSource.Factory()
    .setUserAgent("Tvora-Android-App") // الهوية المسموح لها بالتشغيل دون حظر
    .setAllowCrossProtocolRedirects(true)

val mediaSource = HlsMediaSource.Factory(defaultHttpDataSourceFactory)
    .createMediaSource(MediaItem.fromUri("${sampleMaskedStream}"))

exoPlayer.setMediaSource(mediaSource)
exoPlayer.prepare()
exoPlayer.play()`}</pre>
              )}

              {codeTab === 'flutter' && (
                <pre>{`// تشغيل البث في Flutter
final controller = VideoPlayerController.networkUrl(
  Uri.parse('${sampleMaskedStream}'),
  httpHeaders: {
    'User-Agent': 'Tvora-Android-App',
  },
);
await controller.initialize();
controller.play();`}</pre>
              )}

              {codeTab === 'm3u' && (
                <pre>{`# رابط تشغيل ملف القنوات الشامل في أي مشغل IPTV أو VLC:
${playlistM3uUrl}

# يدعم تلقائياً التحديث الفوري للقنوات واللوجوهات والتصنيفات الرياضية والترفيهية`}</pre>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
