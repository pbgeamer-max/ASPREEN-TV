'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api-client';
import { Source } from '@aspreen/shared';
import {
  Plus,
  Radio,
  Search,
  RefreshCw,
  Trash2,
  CheckCircle2,
  X,
  FileCode,
  Globe,
  Upload,
  AlertCircle,
} from 'lucide-react';

export default function SourcesPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Add Source Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'M3U8' | 'M3U' | 'LOCAL'>('M3U8');
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Form State
  const [sourceName, setSourceName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [credentials, setCredentials] = useState('');
  const [maxChannels, setMaxChannels] = useState(500);
  const [localFileContent, setLocalFileContent] = useState('');
  const [fileName, setFileName] = useState('');

  // Action states
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [validatingId, setValidatingId] = useState<string | null>(null);

  const fetchSources = async () => {
    try {
      const data = await api.getSources();
      setSources(data);
    } catch (err) {
      console.error('Failed to fetch sources:', err);
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
      fetchSources();
    }
  }, [user, authLoading, router]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.m3u') && !file.name.endsWith('.m3u8')) {
      setModalError('File must have .m3u or .m3u8 extension.');
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      setModalError('File size exceeds 50MB limit.');
      return;
    }

    setFileName(file.name);
    if (!sourceName) {
      setSourceName(file.name.replace(/\.[^/.]+$/, ''));
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setLocalFileContent(text);
      setModalError(null);
    };
    reader.readAsText(file);
  };

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    setSubmitting(true);

    try {
      let payload: any = {
        name: sourceName,
        maxChannels,
      };

      if (activeTab === 'M3U8') {
        payload.type = 'M3U8';
        payload.url = sourceUrl;
        if (credentials) payload.credentials = credentials;
      } else if (activeTab === 'M3U') {
        payload.type = 'M3U';
        payload.url = sourceUrl;
      } else {
        payload.type = 'LOCAL_M3U';
        payload.content = localFileContent;
      }

      await api.createSource(payload);
      setIsModalOpen(false);
      resetForm();
      fetchSources();
    } catch (err: any) {
      setModalError(err.message || 'Failed to add streaming source');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setSourceName('');
    setSourceUrl('');
    setCredentials('');
    setLocalFileContent('');
    setFileName('');
    setModalError(null);
  };

  const handleValidate = async (id: string) => {
    setValidatingId(id);
    try {
      const res = await api.validateSource(id);
      if (res.isValid) {
        alert(`Source validation passed! Resolved Host: ${res.hostname || 'OK'}`);
      } else {
        alert(`Validation error: ${res.error}`);
      }
    } catch (err: any) {
      alert(`Validation request failed: ${err.message}`);
    } finally {
      setValidatingId(null);
    }
  };

  const handleRefresh = async (id: string) => {
    setRefreshingId(id);
    try {
      const stats = await api.refreshSource(id);
      alert(`Playlist refreshed successfully! Added: ${stats.added}, Updated: ${stats.updated}, Total: ${stats.total}`);
      fetchSources();
    } catch (err: any) {
      alert(`Refresh failed: ${err.message}`);
    } finally {
      setRefreshingId(null);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete source "${name}" and all imported channels? This action cannot be undone.`)) {
      return;
    }
    try {
      await api.deleteSource(id);
      fetchSources();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const filteredSources = sources.filter(
    (s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.sanitizedHostname.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#080808] flex">
      <Sidebar />

      <main className="flex-1 ml-64 flex flex-col min-h-screen">
        <Header
          title="Streaming Sources"
          subtitle="Manage direct M3U8 live inputs and remote M3U playlist subscriptions"
          action={
            <button
              onClick={() => {
                resetForm();
                setIsModalOpen(true);
              }}
              className="btn-primary py-1.5 px-3 text-xs gap-2"
            >
              <Plus className="w-3.5 h-3.5 text-black" />
              <span>Add Source</span>
            </button>
          }
        />

        <div className="p-8 space-y-6 flex-1">
          {/* Search bar & count */}
          <div className="flex items-center justify-between gap-4">
            <div className="relative max-w-sm w-full">
              <Search className="w-4 h-4 text-[#71717A] absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search sources by name or host..."
                className="form-input pl-9 text-xs"
              />
            </div>
            <span className="text-xs font-mono text-[#71717A]">
              TOTAL SOURCES: {filteredSources.length}
            </span>
          </div>

          {/* Sources Table */}
          <div className="bg-[#111111] border border-[#262626] rounded-lg overflow-hidden">
            {loading ? (
              <div className="p-12 text-center text-xs text-[#71717A]">Loading sources...</div>
            ) : filteredSources.length === 0 ? (
              <div className="p-12 text-center text-[#71717A] space-y-2">
                <Radio className="w-8 h-8 text-[#333333] mx-auto" />
                <p className="text-xs font-medium text-[#A1A1AA]">No streaming sources found</p>
                <p className="text-[11px] text-[#71717A]">
                  Add a direct M3U8 live stream or import an M3U playlist file to get started.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#262626] text-[#71717A] font-mono bg-[#0D0D0D]">
                      <th className="py-3 px-4 font-normal">Source Name</th>
                      <th className="py-3 px-4 font-normal">Type</th>
                      <th className="py-3 px-4 font-normal">Target Host</th>
                      <th className="py-3 px-4 font-normal">Channels</th>
                      <th className="py-3 px-4 font-normal">Connection</th>
                      <th className="py-3 px-4 font-normal">Last Checked</th>
                      <th className="py-3 px-4 font-normal text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1A1A1A]">
                    {filteredSources.map((source) => (
                      <tr key={source.id} className="hover:bg-[#141414] transition-colors">
                        <td className="py-3 px-4 font-medium text-[#F5F5F5]">{source.name}</td>
                        <td className="py-3 px-4">
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#1A1A1A] text-[#A1A1AA] border border-[#262626]">
                            {source.type}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono text-[#A1A1AA] text-[11px]">
                          {source.sanitizedHostname}
                        </td>
                        <td className="py-3 px-4 text-[#F5F5F5] font-mono">{source.channelCount}</td>
                        <td className="py-3 px-4">
                          <span className={source.connectionStatus === 'ONLINE' ? 'badge-running' : 'badge-stopped'}>
                            {source.connectionStatus}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-[#71717A] text-[11px]">
                          {source.lastCheckedAt ? new Date(source.lastCheckedAt).toLocaleDateString() : 'Never'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              onClick={() => handleValidate(source.id)}
                              disabled={validatingId === source.id}
                              title="Validate SSRF & Connectivity"
                              className="p-1 rounded text-[#A1A1AA] hover:text-white hover:bg-[#1E1E1E] transition-colors"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </button>

                            {source.type === 'M3U' && (
                              <button
                                onClick={() => handleRefresh(source.id)}
                                disabled={refreshingId === source.id}
                                title="Refresh Playlist"
                                className="p-1 rounded text-[#A1A1AA] hover:text-white hover:bg-[#1E1E1E] transition-colors"
                              >
                                <RefreshCw className={`w-3.5 h-3.5 ${refreshingId === source.id ? 'animate-spin' : ''}`} />
                              </button>
                            )}

                            <button
                              onClick={() => handleDelete(source.id, source.name)}
                              title="Delete Source"
                              className="p-1 rounded text-[#A1A1AA] hover:text-white hover:bg-[#1E1E1E] transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Add Source Modal */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-[#111111] border border-[#262626] rounded-lg max-w-lg w-full overflow-hidden shadow-2xl">
              <div className="px-5 py-4 border-b border-[#262626] flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#F5F5F5]">Add Streaming Source</h3>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="text-[#71717A] hover:text-[#F5F5F5] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Tabs */}
              <div className="grid grid-cols-3 border-b border-[#262626] bg-[#0A0A0A] text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setActiveTab('M3U8')}
                  className={`py-2.5 flex items-center justify-center gap-1.5 transition-colors ${
                    activeTab === 'M3U8'
                      ? 'border-b-2 border-white text-white bg-[#111111]'
                      : 'text-[#71717A] hover:text-[#F5F5F5]'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>Direct M3U8</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('M3U')}
                  className={`py-2.5 flex items-center justify-center gap-1.5 transition-colors ${
                    activeTab === 'M3U8'
                      ? 'text-[#71717A] hover:text-[#F5F5F5]'
                      : activeTab === 'M3U'
                      ? 'border-b-2 border-white text-white bg-[#111111]'
                      : 'text-[#71717A] hover:text-[#F5F5F5]'
                  }`}
                >
                  <FileCode className="w-3.5 h-3.5" />
                  <span>Remote M3U</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('LOCAL')}
                  className={`py-2.5 flex items-center justify-center gap-1.5 transition-colors ${
                    activeTab === 'LOCAL'
                      ? 'border-b-2 border-white text-white bg-[#111111]'
                      : 'text-[#71717A] hover:text-[#F5F5F5]'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload File</span>
                </button>
              </div>

              <form onSubmit={handleAddSource} className="p-5 space-y-4">
                {modalError && (
                  <div className="p-3 bg-[#171717] border border-neutral-700 rounded text-xs text-[#E4E4E7] flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-[#A1A1AA] shrink-0 mt-0.5" />
                    <span>{modalError}</span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-[#A1A1AA] mb-1">Source Name</label>
                  <input
                    type="text"
                    value={sourceName}
                    onChange={(e) => setSourceName(e.target.value)}
                    required
                    placeholder="e.g. Master Sports Relay 1"
                    className="form-input text-xs"
                  />
                </div>

                {activeTab !== 'LOCAL' ? (
                  <div>
                    <label className="block text-xs font-medium text-[#A1A1AA] mb-1">
                      {activeTab === 'M3U8' ? 'Direct Stream URL (.m3u8)' : 'Remote Playlist URL (.m3u / .m3u8)'}
                    </label>
                    <input
                      type="url"
                      value={sourceUrl}
                      onChange={(e) => setSourceUrl(e.target.value)}
                      required
                      placeholder="https://authorized-provider.com/live/index.m3u8"
                      className="form-input text-xs font-mono"
                    />
                    <p className="text-[10px] text-[#71717A] mt-1">
                      Protected by server-side SSRF validation (internal and private IP ranges blocked).
                    </p>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-medium text-[#A1A1AA] mb-1">Upload M3U / M3U8 File</label>
                    <div className="border border-dashed border-[#262626] rounded p-4 text-center bg-[#0D0D0D]">
                      <input
                        type="file"
                        accept=".m3u,.m3u8"
                        onChange={handleFileUpload}
                        className="hidden"
                        id="m3u-file-upload"
                      />
                      <label htmlFor="m3u-file-upload" className="cursor-pointer flex flex-col items-center">
                        <Upload className="w-6 h-6 text-[#71717A] mb-2" />
                        <span className="text-xs text-[#F5F5F5] font-medium">
                          {fileName ? fileName : 'Choose .m3u or .m3u8 playlist file'}
                        </span>
                        <span className="text-[10px] text-[#71717A] mt-0.5">Maximum file size: 50MB</span>
                      </label>
                    </div>
                  </div>
                )}

                {activeTab === 'M3U8' && (
                  <div>
                    <label className="block text-xs font-medium text-[#A1A1AA] mb-1">
                      Authorized Credentials / Bearer (Optional)
                    </label>
                    <input
                      type="password"
                      value={credentials}
                      onChange={(e) => setCredentials(e.target.value)}
                      placeholder="Encrypted server-side using AES-256-GCM"
                      className="form-input text-xs font-mono"
                    />
                  </div>
                )}

                {activeTab !== 'M3U8' && (
                  <div>
                    <label className="block text-xs font-medium text-[#A1A1AA] mb-1">
                      Max Channel Import Limit
                    </label>
                    <input
                      type="number"
                      value={maxChannels}
                      onChange={(e) => setMaxChannels(parseInt(e.target.value, 10) || 500)}
                      min={1}
                      max={2000}
                      className="form-input text-xs font-mono"
                    />
                  </div>
                )}

                <div className="pt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="btn-secondary py-2 px-3 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn-primary py-2 px-4 text-xs"
                  >
                    {submitting ? 'Importing...' : 'Add Source'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
