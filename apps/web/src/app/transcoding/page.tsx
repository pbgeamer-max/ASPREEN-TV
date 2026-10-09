'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api-client';
import { TranscodingJob } from '@aspreen/shared';
import {
  Cpu,
  RefreshCw,
  Square,
  RotateCcw,
  FileText,
  X,
  AlertOctagon,
  CheckCircle,
} from 'lucide-react';

export default function TranscodingPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [jobs, setJobs] = useState<TranscodingJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Job log modal
  const [selectedJob, setSelectedJob] = useState<TranscodingJob | null>(null);

  const fetchJobs = async () => {
    try {
      const data = await api.getJobs(100);
      setJobs(data);
    } catch (err) {
      console.error('Failed to fetch transcoding jobs:', err);
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
      fetchJobs();
      // Auto-refresh every 12 seconds for live job monitoring
      const interval = setInterval(fetchJobs, 12000);
      return () => clearInterval(interval);
    }
  }, [user, authLoading, router]);

  const handleStop = async (jobId: string) => {
    try {
      await api.stopJob(jobId);
      fetchJobs();
    } catch (err: any) {
      alert(`Stop failed: ${err.message}`);
    }
  };

  const handleRetry = async (jobId: string) => {
    try {
      await api.retryJob(jobId);
      fetchJobs();
    } catch (err: any) {
      alert(`Retry failed: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-[#080808] flex">
      <Sidebar />

      <main className="flex-1 ml-64 flex flex-col min-h-screen">
        <Header
          title="Transcoding Sessions"
          subtitle="Supervisor console for FFmpeg worker processes, encoding presets, and live HLS directories"
          action={
            <button
              onClick={() => {
                setRefreshing(true);
                fetchJobs();
              }}
              disabled={refreshing}
              className="btn-secondary py-1.5 px-3 text-xs gap-2"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          }
        />

        <div className="p-8 space-y-6 flex-1">
          {/* Active summary banner */}
          <div className="flex items-center justify-between text-xs text-[#71717A] font-mono">
            <span>
              TOTAL JOBS: {jobs.length} • RUNNING: {jobs.filter((j) => j.status === 'RUNNING').length}
            </span>
            <span>STORAGE PATH: /var/www/aspreen/hls</span>
          </div>

          {/* Jobs Table */}
          <div className="bg-[#111111] border border-[#262626] rounded-lg overflow-hidden">
            {loading ? (
              <div className="p-12 text-center text-xs text-[#71717A]">Loading jobs...</div>
            ) : jobs.length === 0 ? (
              <div className="p-12 text-center text-[#71717A] space-y-2">
                <Cpu className="w-8 h-8 text-[#333333] mx-auto" />
                <p className="text-xs font-medium text-[#A1A1AA]">No transcoding jobs found</p>
                <p className="text-[11px] text-[#71717A]">
                  Go to Channels to launch stream transcoding.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#262626] text-[#71717A] font-mono bg-[#0D0D0D]">
                      <th className="py-3 px-4 font-normal">Job ID</th>
                      <th className="py-3 px-4 font-normal">Channel ID</th>
                      <th className="py-3 px-4 font-normal">Preset</th>
                      <th className="py-3 px-4 font-normal">Status</th>
                      <th className="py-3 px-4 font-normal">PID</th>
                      <th className="py-3 px-4 font-normal">Output Dir</th>
                      <th className="py-3 px-4 font-normal">Started At</th>
                      <th className="py-3 px-4 font-normal text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1A1A1A]">
                    {jobs.map((job) => (
                      <tr key={job.id} className="hover:bg-[#141414] transition-colors">
                        <td className="py-3 px-4 font-mono font-medium text-[#F5F5F5]">
                          {job.id.slice(0, 8)}...
                        </td>
                        <td className="py-3 px-4 font-mono text-[#A1A1AA] text-[11px]">
                          {job.channelId.slice(0, 8)}...
                        </td>
                        <td className="py-3 px-4">
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#171717] text-[#D4D4D8] border border-[#262626]">
                            {job.preset}
                          </span>
                        </td>
                        <td className="py-3 px-4">
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
                        <td className="py-3 px-4 font-mono text-[#71717A]">
                          {job.processId ?? '—'}
                        </td>
                        <td className="py-3 px-4 font-mono text-[10px] text-[#A1A1AA]">
                          {job.outputDirectoryId}
                        </td>
                        <td className="py-3 px-4 text-[#71717A] text-[11px]">
                          {job.startedAt ? new Date(job.startedAt).toLocaleTimeString() : '—'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            {job.status === 'RUNNING' && (
                              <button
                                onClick={() => handleStop(job.id)}
                                title="Stop Process"
                                className="p-1 rounded text-[#A1A1AA] hover:text-white hover:bg-[#1E1E1E] transition-colors"
                              >
                                <Square className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {(job.status === 'FAILED' || job.status === 'STOPPED') && (
                              <button
                                onClick={() => handleRetry(job.id)}
                                title="Retry Transcoding"
                                className="p-1 rounded text-[#A1A1AA] hover:text-white hover:bg-[#1E1E1E] transition-colors"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            )}

                            <button
                              onClick={() => setSelectedJob(job)}
                              title="Supervisor Details"
                              className="p-1 rounded text-[#A1A1AA] hover:text-white hover:bg-[#1E1E1E] transition-colors"
                            >
                              <FileText className="w-3.5 h-3.5" />
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

        {/* Job Details Modal */}
        {selectedJob && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-[#111111] border border-[#262626] rounded-lg max-w-lg w-full overflow-hidden shadow-2xl">
              <div className="px-5 py-4 border-b border-[#262626] flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#F5F5F5]">
                  Transcoding Session — {selectedJob.id.slice(0, 8)}
                </h3>
                <button
                  onClick={() => setSelectedJob(null)}
                  className="text-[#71717A] hover:text-[#F5F5F5] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-3 font-mono text-xs">
                <div className="p-3 bg-[#0A0A0A] border border-[#262626] rounded space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-[#71717A]">Status:</span>
                    <span className="text-[#F5F5F5]">{selectedJob.status}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#71717A]">Process ID:</span>
                    <span className="text-[#F5F5F5]">{selectedJob.processId ?? 'Terminated'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#71717A]">Video Codec:</span>
                    <span className="text-[#F5F5F5]">{selectedJob.validatedConfiguration.videoCodec}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#71717A]">Audio Codec:</span>
                    <span className="text-[#F5F5F5]">{selectedJob.validatedConfiguration.audioCodec}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#71717A]">Segment Duration:</span>
                    <span className="text-[#F5F5F5]">{selectedJob.validatedConfiguration.segmentDuration}s</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#71717A]">Playlist Window:</span>
                    <span className="text-[#F5F5F5]">{selectedJob.validatedConfiguration.playlistWindow} segments</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#71717A]">Output Directory ID:</span>
                    <span className="text-[#F5F5F5]">{selectedJob.outputDirectoryId}</span>
                  </div>
                  {selectedJob.lastErrorCode && (
                    <div className="flex justify-between">
                      <span className="text-[#71717A]">Exit Code:</span>
                      <span className="text-[#D4D4D8]">{selectedJob.lastErrorCode}</span>
                    </div>
                  )}
                  {selectedJob.sanitizedErrorMessage && (
                    <div className="pt-2 border-t border-[#222] text-[#A1A1AA]">
                      Error: {selectedJob.sanitizedErrorMessage}
                    </div>
                  )}
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    onClick={() => setSelectedJob(null)}
                    className="btn-secondary py-1.5 px-4 text-xs"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
