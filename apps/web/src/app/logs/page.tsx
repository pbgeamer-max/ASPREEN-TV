'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api-client';
import { ActivityLog, ActivityLogEntityType } from '@aspreen/shared';
import { FileText, RefreshCw, Filter } from 'lucide-react';

export default function LogsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEntity, setSelectedEntity] = useState<string>('ALL');

  const fetchLogs = async () => {
    try {
      const data = await api.getActivityLogs(100);
      setLogs(data);
    } catch (err) {
      console.error('Failed to load activity logs:', err);
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
      fetchLogs();
    }
  }, [user, authLoading, router]);

  const filteredLogs = logs.filter((log) => {
    if (selectedEntity === 'ALL') return true;
    return log.entityType === selectedEntity;
  });

  return (
    <div className="min-h-screen bg-[#080808] flex">
      <Sidebar />

      <main className="flex-1 ml-64 flex flex-col min-h-screen">
        <Header
          title="Activity & Audit Logs"
          subtitle="Redacted security records of administrative actions, streaming events, and credential updates"
          action={
            <button
              onClick={fetchLogs}
              className="btn-secondary py-1.5 px-3 text-xs gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
          }
        />

        <div className="p-8 space-y-6 flex-1">
          {/* Filter Bar */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-[#71717A]" />
              <select
                value={selectedEntity}
                onChange={(e) => setSelectedEntity(e.target.value)}
                className="form-input text-xs w-48"
              >
                <option value="ALL">All Entity Types</option>
                <option value="SOURCE">Sources</option>
                <option value="CHANNEL">Channels</option>
                <option value="JOB">Transcoding Jobs</option>
                <option value="STREAM_TOKEN">Stream Tokens</option>
                <option value="SETTINGS">Settings</option>
                <option value="AUTH">Authentication</option>
                <option value="SYSTEM">System</option>
              </select>
            </div>

            <span className="text-xs font-mono text-[#71717A]">
              LOG ENTRIES: {filteredLogs.length}
            </span>
          </div>

          {/* Logs Table */}
          <div className="bg-[#111111] border border-[#262626] rounded-lg overflow-hidden">
            {loading ? (
              <div className="p-12 text-center text-xs text-[#71717A]">Loading logs...</div>
            ) : filteredLogs.length === 0 ? (
              <div className="p-12 text-center text-[#71717A] space-y-2">
                <FileText className="w-8 h-8 text-[#333333] mx-auto" />
                <p className="text-xs font-medium text-[#A1A1AA]">No activity logs found</p>
                <p className="text-[11px] text-[#71717A]">Events will appear as actions occur.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#262626] text-[#71717A] font-mono bg-[#0D0D0D]">
                      <th className="py-3 px-4 font-normal">Timestamp</th>
                      <th className="py-3 px-4 font-normal">Event Type</th>
                      <th className="py-3 px-4 font-normal">Entity</th>
                      <th className="py-3 px-4 font-normal">Result</th>
                      <th className="py-3 px-4 font-normal">Safe Details (Sanitized)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1A1A1A]">
                    {filteredLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-[#141414] transition-colors">
                        <td className="py-3 px-4 text-[#71717A] font-mono text-[11px] whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 font-mono font-medium text-[#F5F5F5]">
                          {log.eventType}
                        </td>
                        <td className="py-3 px-4 text-[#A1A1AA]">
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#171717] border border-[#262626]">
                            {log.entityType} {log.entityId ? `• ${log.entityId.slice(0, 6)}` : ''}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={
                              log.result === 'SUCCESS'
                                ? 'badge-running'
                                : log.result === 'FAILURE'
                                ? 'badge-failed'
                                : 'badge-stopped'
                            }
                          >
                            {log.result}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-[#A1A1AA]">
                          {JSON.stringify(log.safeDetails)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
