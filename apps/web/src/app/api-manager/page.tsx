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
  FolderTree,
  ExternalLink,
  Code2,
  Terminal,
  Smartphone,
  Globe,
  AlertTriangle,
  ListOrdered,
} from 'lucide-react';

export default function ApiManagerPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedM3u, setCopiedM3u] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [customKey, setCustomKey] = useState('');
  const [testResult, setTestResult] = useState<any>(null);
  const [testing, setTesting] = useState(false);
  const [codeTab, setCodeTab] = useState<'android' | 'web' | 'curl'>('android');

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

  const fullApiUrl = channelsApiUrl;

  // Toggle API On/Off
  const handleToggleApi = async () => {
    if (!settings) return;
    const newState = !isEnabled;
    const actionName = newState ? 'تشغيل' : 'إيقاف';
    if (!confirm(`هل أنت متأكد من ${actionName} الـ API؟ ${!newState ? 'سيتوقف البث فوراً عن التطبيقات والمواقع المرتبطة.' : ''}`)) {
      return;
    }

    setSaving(true);
    try {
      const updated = await api.updateSettings({
        masterApiEnabled: newState,
      });
      setSettings(updated);
    } catch (err: any) {
      alert(`فشل التحديث: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Generate New Random Key
  const handleGenerateKey = async () => {
    if (!confirm('هل أنت متأكد من رغبتك في تغيير مفتاح الـ API؟ سيتم حظر أي تطبيق يستخدم المفتاح القديم حتى يتم تحديثه.')) {
      return;
    }

    const randomSecret = 'aspr_sec_' + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
    setSaving(true);
    try {
      const updated = await api.updateSettings({
        masterApiKey: randomSecret,
      });
      setSettings(updated);
      setCustomKey(randomSecret);
    } catch (err: any) {
      alert(`فشل التحديث: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Save Custom Key
  const handleSaveCustomKey = async () => {
    setSaving(true);
    try {
      const updated = await api.updateSettings({
        masterApiKey: customKey.trim(),
      });
      setSettings(updated);
      alert('تم حفظ مفتاح الـ API بنجاح!');
    } catch (err: any) {
      alert(`فشل الحفظ: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Remove Key (Public Access)
  const handleRemoveKey = async () => {
    if (!confirm('هل تريد إلغاء حماية المفتاح وجعل الـ API متاحاً بشكل عام (بدون api_key)؟')) {
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateSettings({
        masterApiKey: '',
      });
      setSettings(updated);
      setCustomKey('');
    } catch (err: any) {
      alert(`فشل الحفظ: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Test API Live
  const handleTestApi = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const start = performance.now();
      const res = await fetch(fullApiUrl);
      const data = await res.json();
      const duration = Math.round(performance.now() - start);
      setTestResult({
        status: res.status,
        durationMs: duration,
        data,
      });
    } catch (err: any) {
      setTestResult({
        status: 500,
        error: err.message,
      });
    } finally {
      setTesting(false);
    }
  };

  const copyToClipboard = (text: string, type: 'url' | 'key') => {
    navigator.clipboard.writeText(text);
    if (type === 'url') {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } else {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  return (
    <div className="flex h-screen bg-[#0A0A0A] text-[#F5F5F5] font-sans">
      <Sidebar />

      <div className="flex-1 flex flex-col pl-64 overflow-hidden">
        <Header
          title="Master API Manager"
          subtitle="إدارة الرابط الموحد لتطبيقات الأندرويد والمواقع والتحكم في مفاتيح التشغيل"
        />

        <main className="flex-1 overflow-y-auto p-8 space-y-8 max-w-7xl mx-auto w-full">
          {/* Header section */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#262626] pb-6">
            <div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                    إدارة الـ API الموحد (Master API Manager)
                  </h1>
                  <p className="text-xs text-[#71717A] mt-0.5">
                    الرابط المركزي الشامل لتطبيقات الأندرويد ومواقع الويب مع التحكم الكامل في التشغيل والإيقاف وتغيير المفاتيح
                  </p>
                </div>
              </div>
            </div>

            {/* Global Status & Power Button */}
            <div className="flex items-center gap-3">
              <div className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-2 border ${
                isEnabled
                  ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50'
                  : 'bg-red-950/40 text-red-400 border-red-800/50'
              }`}>
                <span className={`w-2 h-2 rounded-full ${isEnabled ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                <span>{isEnabled ? 'الـ API يعمل (ONLINE)' : 'الـ API متوقف (DISABLED)'}</span>
              </div>

              <button
                onClick={handleToggleApi}
                disabled={saving || loading}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all border ${
                  isEnabled
                    ? 'bg-red-950/30 hover:bg-red-900/40 text-red-300 border-red-800/40'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white border-transparent'
                }`}
              >
                <Power className="w-4 h-4" />
                <span>{isEnabled ? 'إيقاف الـ API مؤقتاً' : 'تفعيل الـ API الآن'}</span>
              </button>
            </div>
          </div>

          {/* Alert if Disabled */}
          {!isEnabled && (
            <div className="p-4 rounded-xl bg-red-950/30 border border-red-800/40 flex items-center gap-3 text-red-200">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
              <div className="text-xs">
                <b>تنبيه هام:</b> الـ API متوقف حالياً. أي طلبات قادمة من تطبيق الأندرويد أو المواقع الخارجية ستتلقى خطأ <code className="bg-red-900/50 px-1 py-0.5 rounded">403 Forbidden</code> حتى تقوم بإعادة تفعيله.
              </div>
            </div>
          )}

          {/* Quick Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-[#121212] border border-[#262626] flex items-center justify-between">
              <div>
                <p className="text-[11px] text-[#71717A] uppercase font-mono tracking-wider">إجمالي القنوات المتاحة</p>
                <p className="text-2xl font-bold text-white mt-1">325 <span className="text-xs font-normal text-[#A1A1AA]">قناة معاد بثها</span></p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                <Tv className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#121212] border border-[#262626] flex items-center justify-between">
              <div>
                <p className="text-[11px] text-[#71717A] uppercase font-mono tracking-wider">الأقسام والتصنيفات</p>
                <p className="text-2xl font-bold text-white mt-1">12 <span className="text-xs font-normal text-[#A1A1AA]">تصنيف مرتب</span></p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                <FolderTree className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#121212] border border-[#262626] flex items-center justify-between">
              <div>
                <p className="text-[11px] text-[#71717A] uppercase font-mono tracking-wider">مستوى الحماية</p>
                <p className="text-lg font-bold text-white mt-1">
                  {currentKey ? (
                    <span className="text-emerald-400 flex items-center gap-1.5 text-sm">
                      <KeyRound className="w-4 h-4" /> محمي بمفتاح سري
                    </span>
                  ) : (
                    <span className="text-amber-400 flex items-center gap-1.5 text-sm">
                      <Globe className="w-4 h-4" /> متاح عام (Public Access)
                    </span>
                  )}
                </p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <ShieldCheck className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Master API URL Cards */}
          <div className="p-6 rounded-2xl bg-[#121212] border border-[#262626] space-y-6">
            <div className="flex items-center justify-between border-b border-[#202020] pb-3">
              <div>
                <h3 className="text-sm font-semibold text-white">روابط الـ Master API الشاملة (للتطبيقات والمواقع الخارجية)</h3>
                <p className="text-xs text-[#71717A] mt-0.5">
                  جميع الروابط موحدة وتدعم مفتاح الأمان، وتوفر قوائم قنوات البث المباشر مع روابط البث المُعاد بثها بدون تقطيع أو انقطاع نهائياً.
                </p>
              </div>
              <button
                onClick={handleTestApi}
                disabled={testing}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#1E1E1E] hover:bg-[#282828] text-xs font-medium text-white border border-[#333] transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
                <span>اختبار القنوات فحص مباشر</span>
              </button>
            </div>

            {/* 1. Channels API (JSON) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#EDEDED] flex items-center gap-1.5">
                  <Tv className="w-3.5 h-3.5 text-emerald-400" />
                  <span>1. رابط قنوات البث المباشر (Live TV Channels API - JSON)</span>
                </span>
                <span className="text-[10px] text-[#71717A]">325+ قناة رياضية وعامة مجهزة للتطبيقات</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={channelsApiUrl}
                  className="flex-1 bg-[#0A0A0A] border border-[#262626] rounded-xl px-4 py-2.5 text-xs font-mono text-emerald-400 select-all focus:outline-none"
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

            {/* 2. M3U Playlist */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#EDEDED] flex items-center gap-1.5">
                  <ListOrdered className="w-3.5 h-3.5 text-blue-400" />
                  <span>2. رابط قائمة قنوات M3U لبرامج البث (IPTV M3U Playlist)</span>
                </span>
                <span className="text-[10px] text-[#71717A]">متوافق مع VLC, TiviMate, OTT Navigator</span>
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

            {/* 3. Direct Stream URL Pattern */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#EDEDED] flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-purple-400" />
                  <span>3. صيغة رابط البث المباشر الثابت للقناة (Persistent Stream URL)</span>
                </span>
                <span className="text-[10px] text-[#71717A]">معاد بثه محلياً وسحابياً بدون انقطاع</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={`${baseUrl}/live/{channel_id}.m3u8`}
                  className="flex-1 bg-[#0A0A0A] border border-[#262626] rounded-xl px-4 py-2.5 text-xs font-mono text-purple-300 select-all focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* API Key Management */}
          <div className="p-6 rounded-2xl bg-[#121212] border border-[#262626] space-y-5">
            <div className="border-b border-[#262626] pb-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-400" />
                التحكم في مفتاح الأمان (API Key Management)
              </h3>
              <p className="text-xs text-[#71717A] mt-1">
                يمكنك تغيير المفتاح في أي وقت لإلغاء صلاحية أي تطبيق أو مستخدم سابق، أو إلغاء المفتاح لفتح الرابط مباشرة دون قيود.
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
                    placeholder="اتركه فارغاً للسماح بالوصول العام بدون مفتاح، أو اكتب مفتاحك المخصص"
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

          {/* Integration Guides */}
          <div className="p-6 rounded-2xl bg-[#121212] border border-[#262626] space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Code2 className="w-4 h-4 text-blue-400" />
              أمثلة الربط السريع (Integration Guides)
            </h3>

            <div className="flex gap-2 border-b border-[#262626] pb-2">
              <button
                onClick={() => setCodeTab('android')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  codeTab === 'android' ? 'bg-[#222] text-white border border-[#3A3A3A]' : 'text-[#71717A] hover:text-white'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>تطبيق أندرويد (Kotlin)</span>
              </button>

              <button
                onClick={() => setCodeTab('web')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  codeTab === 'web' ? 'bg-[#222] text-white border border-[#3A3A3A]' : 'text-[#71717A] hover:text-white'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                <span>موقع إلكتروني (JavaScript / HLS)</span>
              </button>

              <button
                onClick={() => setCodeTab('curl')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  codeTab === 'curl' ? 'bg-[#222] text-white border border-[#3A3A3A]' : 'text-[#71717A] hover:text-white'
                }`}
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>cURL / Terminal</span>
              </button>
            </div>

            <div className="bg-[#0A0A0A] border border-[#262626] rounded-xl p-4 font-mono text-xs text-[#E4E4E7] overflow-x-auto">
              {codeTab === 'android' && (
                <pre>{`// Retrofit API Service
interface AspreenApi {
    @GET("api/app/channels")
    suspend fun getChannels(
        @Query("api_key") apiKey: String = "${currentKey || ''}"
    ): ChannelApiResponse
}`}</pre>
              )}

              {codeTab === 'web' && (
                <pre>{`// Fetch from any Web Browser or Frontend
fetch("${fullApiUrl}")
  .then(res => res.json())
  .then(data => {
    console.log("Total Channels:", data.total_channels);
    data.channels.forEach(ch => {
      console.log(ch.name, ch.stream_url, ch.logo);
    });
  });`}</pre>
              )}

              {codeTab === 'curl' && (
                <pre>{`curl -s "${fullApiUrl}" | jq .`}</pre>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
