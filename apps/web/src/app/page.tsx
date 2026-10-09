'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api-client';
import { DashboardSummary } from '@aspreen/shared';
import {
  Radio,
  Tv,
  Cpu,
  KeyRound,
  AlertOctagon,
  ArrowRight,
  HardDrive,
  Activity,
  Layers,
  RefreshCw,
} from 'lucide-react';

export default function OverviewPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSummary = async () => {
    try {
      const data = await api.getDashboardSummary();
      setSummary(data);
    } catch (err) {
      console.error('Failed to load dashboard summary:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }
    if (user) {
      fetchSummary();
    }
  }, [user, authLoading, router]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const formatPercent = (val: number | null | undefined) => (val !== null && val !== undefined ? `${val}%` : 'Unavailable');

  return (
    <div className="min-h-screen bg-[#080808] flex">
      <Sidebar />

      <main className="flex-1 ml-64 flex flex-col min-h-screen">
        <Header
          title="Streaming Dashboard"
          subtitle="Real-time channel overview, transcoding processes, and infrastructure metrics"
          action={
            <button
              onClick={() => {
                setRefreshing(true);
                fetchSummary();
              }}
              disabled={refreshing}
              className="btn-secondary py-1.5 px-3 text-xs gap-2"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          }
        />

        <div className="p-8 space-y-8 flex-1">
          {/* Key Metric Counters */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="bg-[#111111] border border-[#262626] rounded-lg p-4">
              <div className="flex items-center justify-between text-[#71717A] mb-2">
                <span className="text-xs uppercase font-mono tracking-wider">Sources</span>
                <Radio className="w-4 h-4 text-[#A1A1AA]" />
              </div>
              <div className="text-2xl font-bold text-[#F5F5F5]">{summary?.totalSources ?? 0}</div>
              <span className="text-[10px] text-[#71717A] mt-1 block">Active Playlists</span>
            </div>

            <div className="bg-[#111111] border border-[#262626] rounded-lg p-4">
              <div className="flex items-center justify-between text-[#71717A] mb-2">
                <span className="text-xs uppercase font-mono tracking-wider">Channels</span>
                <Tv className="w-4 h-4 text-[#A1A1AA]" />
              </div>
              <div className="text-2xl font-bold text-[#F5F5F5]">{summary?.totalChannels ?? 0}</div>
              <span className="text-[10px] text-[#71717A] mt-1 block">Imported Streams</span>
            </div>

            <div className="bg-[#111111] border border-[#262626] rounded-lg p-4">
              <div className="flex items-center justify-between text-[#71717A] mb-2">
                <span className="text-xs uppercase font-mono tracking-wider">Active Jobs</span>
                <Cpu className="w-4 h-4 text-[#A1A1AA]" />
              </div>
              <div className="text-2xl font-bold text-[#F5F5F5]">{summary?.activeJobs ?? 0}</div>
              <span className="text-[10px] text-[#71717A] mt-1 block">Live FFmpeg Workers</span>
            </div>

            <div className="bg-[#111111] border border-[#262626] rounded-lg p-4">
              <div className="flex items-center justify-between text-[#71717A] mb-2">
                <span className="text-xs uppercase font-mono tracking-wider">Queued</span>
                <Layers className="w-4 h-4 text-[#A1A1AA]" />
              </div>
              <div className="text-2xl font-bold text-[#F5F5F5]">{summary?.queuedJobs ?? 0}</div>
              <span className="text-[10px] text-[#71717A] mt-1 block">Awaiting Worker</span>
            </div>

            <div className="bg-[#111111] border border-[#262626] rounded-lg p-4">
              <div className="flex items-center justify-between text-[#71717A] mb-2">
                <span className="text-xs uppercase font-mono tracking-wider">Failed Jobs</span>
                <AlertOctagon className="w-4 h-4 text-[#A1A1AA]" />
              </div>
              <div className="text-2xl font-bold text-[#F5F5F5]">{summary?.failedJobs ?? 0}</div>
              <span className="text-[10px] text-[#71717A] mt-1 block">Input Interrupted</span>
            </div>

            <div className="bg-[#111111] border border-[#262626] rounded-lg p-4">
              <div className="flex items-center justify-between text-[#71717A] mb-2">
                <span className="text-xs uppercase font-mono tracking-wider">Outputs</span>
                <KeyRound className="w-4 h-4 text-[#A1A1AA]" />
              </div>
              <div className="text-2xl font-bold text-[#F5F5F5]">{summary?.activeOutputs ?? 0}</div>
              <span className="text-[10px] text-[#71717A] mt-1 block">Protected Tokens</span>
            </div>
          </div>

          {/* Infrastructure Health / Resource Monitor */}
          <div className="bg-[#111111] border border-[#262626] rounded-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-[#A1A1AA]" />
                <h2 className="text-sm font-semibold text-[#F5F5F5]">VPS Resource Telemetry</h2>
              </div>
              <span className="text-[11px] font-mono text-[#71717A]">REAL-TIME SAMPLING</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-[#A1A1AA]">CPU Utilization</span>
                  <span className="font-mono text-[#F5F5F5]">{formatPercent(summary?.system.cpuUsage)}</span>
                </div>
                <div className="h-1.5 w-full bg-[#1A1A1A] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white transition-all duration-500"
                    style={{ width: `${summary?.system.cpuUsage ?? 0}%` }}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-[#A1A1AA]">Memory Allocated</span>
                  <span className="font-mono text-[#F5F5F5]">{formatPercent(summary?.system.memoryUsage)}</span>
                </div>
                <div className="h-1.5 w-full bg-[#1A1A1A] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-neutral-300 transition-all duration-500"
                    style={{ width: `${summary?.system.memoryUsage ?? 0}%` }}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-[#A1A1AA]">Disk Storage (HLS Segments)</span>
                  <span className="font-mono text-[#F5F5F5]">{formatPercent(summary?.system.diskUsage)}</span>
                </div>
                <div className="h-1.5 w-full bg-[#1A1A1A] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-neutral-400 transition-all duration-500"
                    style={{ width: `${summary?.system.diskUsage ?? 0}%` }}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-[#A1A1AA]">Outbound Bandwidth</span>
                  <span className="font-mono text-[#F5F5F5]">
                    {summary?.system.networkThroughputMbps !== null
                      ? `${summary?.system.networkThroughputMbps} Mbps`
                      : 'Unavailable'}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-[#1A1A1A] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-neutral-200 transition-all duration-500"
                    style={{ width: `${Math.min(100, (summary?.system.networkThroughputMbps ?? 0) * 2)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Dual Columns: Active Jobs & Recent Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Active / Recent Jobs Table */}
            <div className="bg-[#111111] border border-[#262626] rounded-lg p-6 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-[#A1A1AA]" />
                  <h3 className="text-sm font-semibold text-[#F5F5F5]">Transcoding Sessions</h3>
                </div>
                <Link
                  href="/transcoding"
                  className="text-xs text-[#A1A1AA] hover:text-white flex items-center gap-1 transition-colors"
                >
                  <span>View all</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              {(!summary?.recentJobs || summary.recentJobs.length === 0) ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[#71717A] border border-dashed border-[#262626] rounded">
                  <Cpu className="w-8 h-8 text-[#333333] mb-2" />
                  <p className="text-xs font-medium text-[#A1A1AA]">No active transcoding sessions</p>
                  <p className="text-[11px] text-[#71717A] mt-1">
                    Select a channel to start transcoding using compatible presets.
                  </p>
                  <Link href="/channels" className="btn-secondary mt-3 py-1.5 px-3 text-xs">
                    Browse Channels
                  </Link>
                </div>
              ) : (
                <div className="overflow-x-auto flex-1">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#262626] text-[#71717A] font-mono">
                        <th className="py-2.5 font-normal">Job ID</th>
                        <th className="py-2.5 font-normal">Preset</th>
                        <th className="py-2.5 font-normal">Status</th>
                        <th className="py-2.5 font-normal text-right">PID</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1A1A1A]">
                      {summary.recentJobs.slice(0, 5).map((job) => (
                        <tr key={job.id} className="hover:bg-[#141414] transition-colors">
                          <td className="py-2.5 font-mono text-[#F5F5F5]">{job.id.slice(0, 8)}...</td>
                          <td className="py-2.5 text-[#A1A1AA]">{job.preset}</td>
                          <td className="py-2.5">
                            <span
                              className={
                                job.status === 'RUNNING'
                                  ? 'badge-running'
                                  : job.status === 'FAILED'
                                  ? 'badge-failed'
                                  : 'badge-stopped'
                              }
                            >
                              {job.status}
                            </span>
                          </td>
                          <td className="py-2.5 text-right font-mono text-[#71717A]">
                            {job.processId ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Recent Activity Log */}
            <div className="bg-[#111111] border border-[#262626] rounded-lg p-6 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-[#A1A1AA]" />
                  <h3 className="text-sm font-semibold text-[#F5F5F5]">Audit & Activity Stream</h3>
                </div>
                <Link
                  href="/logs"
                  className="text-xs text-[#A1A1AA] hover:text-white flex items-center gap-1 transition-colors"
                >
                  <span>Full log</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              {(!summary?.recentActivity || summary.recentActivity.length === 0) ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[#71717A] border border-dashed border-[#262626] rounded">
                  <Activity className="w-8 h-8 text-[#333333] mb-2" />
                  <p className="text-xs font-medium text-[#A1A1AA]">No activity logged yet</p>
                  <p className="text-[11px] text-[#71717A] mt-1">
                    System operations and security events will record here.
                  </p>
                </div>
              ) : (
                <div className="space-y-3 flex-1 overflow-y-auto max-h-72">
                  {summary.recentActivity.map((log) => (
                    <div
                      key={log.id}
                      className="p-3 bg-[#101010] border border-[#262626] rounded flex items-start justify-between gap-3 text-xs"
                    >
                      <div className="flex flex-col">
                        <span className="font-mono text-[#F5F5F5] font-medium">{log.eventType}</span>
                        <span className="text-[11px] text-[#71717A] mt-0.5">
                          {log.entityType} {log.entityId ? `• ${log.entityId.slice(0, 8)}...` : ''}
                        </span>
                      </div>
                      <div className="flex flex-col items-end shrink-0">
                        <span className="text-[10px] font-mono text-[#71717A]">
                          {new Date(log.createdAt).toLocaleTimeString()}
                        </span>
                        <span className="text-[10px] font-mono text-[#A1A1AA] uppercase mt-0.5">
                          {log.result}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
