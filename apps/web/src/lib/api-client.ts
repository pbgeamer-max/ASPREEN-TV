import {
  Source,
  Channel,
  TranscodingJob,
  StreamToken,
  ActivityLog,
  AdminSettings,
  DashboardSummary,
  StreamProbeInfo,
  BulkStartResult,
  BulkStopResult,
  ExportLinksResult,
} from '@aspreen/shared';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
    if (typeof window !== 'undefined') {
      if (token) {
        localStorage.setItem('aspreen_auth_token', token);
      } else {
        localStorage.removeItem('aspreen_auth_token');
      }
    }
  }

  getToken(): string | null {
    if (this.token) return this.token;
    if (typeof window !== 'undefined') {
      return localStorage.getItem('aspreen_auth_token');
    }
    return null;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${API_BASE}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };

    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.message || errorData.error || errorMessage;
      } catch {}
      throw new Error(errorMessage);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  // Auth
  async loginWithPassword(password: string, email?: string) {
    const res = await this.request<{ success: boolean; token: string; user: { uid: string; email: string } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password, email }),
    });
    if (res.token) {
      this.setToken(res.token);
    }
    return res;
  }

  async createSession(idToken: string) {
    this.setToken(idToken);
    return this.request<{ success: boolean; uid: string; email: string }>('/auth/session', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    });
  }

  async logout() {
    this.setToken(null);
    return this.request<{ success: boolean }>('/auth/logout', { method: 'POST' });
  }

  async getSession() {
    return this.request<{ authenticated: boolean; user: any }>('/auth/session');
  }

  // Dashboard
  async getDashboardSummary(): Promise<DashboardSummary> {
    return this.request<DashboardSummary>('/dashboard/summary');
  }

  async getRecentActivity(): Promise<ActivityLog[]> {
    return this.request<ActivityLog[]>('/dashboard/activity');
  }

  // Sources
  async getSources(): Promise<Source[]> {
    return this.request<Source[]>('/sources');
  }

  async getSource(id: string): Promise<Source> {
    return this.request<Source>(`/sources/${id}`);
  }

  async createSource(data: any): Promise<{ source: Source; importedChannels: number }> {
    return this.request<{ source: Source; importedChannels: number }>('/sources', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSource(id: string, data: Partial<Source>): Promise<Source> {
    return this.request<Source>(`/sources/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteSource(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/sources/${id}`, { method: 'DELETE' });
  }

  async validateSource(id: string): Promise<{ isValid: boolean; hostname?: string; error?: string }> {
    return this.request(`/sources/${id}/validate`, { method: 'POST' });
  }

  async refreshSource(id: string): Promise<{ added: number; updated: number; total: number }> {
    return this.request(`/sources/${id}/refresh`, { method: 'POST' });
  }

  // Channels
  async getChannels(params?: { sourceId?: string; q?: string; group?: string; limit?: number }): Promise<Channel[]> {
    const searchParams = new URLSearchParams();
    if (params?.sourceId) searchParams.set('sourceId', params.sourceId);
    if (params?.q) searchParams.set('q', params.q);
    if (params?.group) searchParams.set('group', params.group);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    const qs = searchParams.toString();
    return this.request<Channel[]>(`/channels${qs ? `?${qs}` : ''}`);
  }

  async getChannel(id: string): Promise<Channel> {
    return this.request<Channel>(`/channels/${id}`);
  }

  async updateChannel(id: string, data: Partial<Channel>): Promise<Channel> {
    return this.request<Channel>(`/channels/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteChannel(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/channels/${id}`, { method: 'DELETE' });
  }

  async inspectChannel(id: string): Promise<{ success: boolean; probe: StreamProbeInfo }> {
    return this.request(`/channels/${id}/inspect`, { method: 'POST' });
  }

  async startChannel(id: string, options?: any): Promise<{ success: boolean; job: TranscodingJob }> {
    return this.request(`/channels/${id}/start`, {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  }

  async stopChannel(id: string): Promise<{ success: boolean }> {
    return this.request(`/channels/${id}/stop`, { method: 'POST' });
  }

  async restartChannel(id: string): Promise<{ success: boolean; job: TranscodingJob }> {
    return this.request(`/channels/${id}/restart`, { method: 'POST' });
  }

  async bulkStartChannels(options?: {
    sourceId?: string;
    preset?: string;
    maxToStart?: number;
  }): Promise<BulkStartResult> {
    return this.request<BulkStartResult>('/channels/bulk/start', {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  }

  async bulkStopChannels(sourceId?: string): Promise<BulkStopResult> {
    return this.request<BulkStopResult>('/channels/bulk/stop', {
      method: 'POST',
      body: JSON.stringify({ sourceId }),
    });
  }

  // Transcoding Jobs
  async getJobs(limit = 50): Promise<TranscodingJob[]> {
    return this.request<TranscodingJob[]>(`/jobs?limit=${limit}`);
  }

  async stopJob(id: string): Promise<{ success: boolean }> {
    return this.request(`/jobs/${id}/stop`, { method: 'POST' });
  }

  async retryJob(id: string): Promise<{ success: boolean; job: TranscodingJob }> {
    return this.request(`/jobs/${id}/retry`, { method: 'POST' });
  }

  // Stream Tokens
  async getStreamTokens(channelId?: string): Promise<StreamToken[]> {
    const qs = channelId ? `?channelId=${channelId}` : '';
    return this.request<StreamToken[]>(`/stream-tokens${qs}`);
  }

  async createStreamToken(
    channelId: string,
    data: { name: string; lifetimeHours?: number }
  ): Promise<{ token: StreamToken; rawToken: string; playbackUrl: string; tsPlaybackUrl: string }> {
    return this.request(`/stream-tokens/channels/${channelId}/tokens`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async revokeStreamToken(id: string): Promise<{ success: boolean }> {
    return this.request(`/stream-tokens/${id}`, { method: 'DELETE' });
  }

  async rotateStreamToken(
    id: string
  ): Promise<{ token: StreamToken; rawToken: string; playbackUrl: string; tsPlaybackUrl: string }> {
    return this.request(`/stream-tokens/${id}/rotate`, { method: 'POST' });
  }

  async exportChannelLinks(options?: {
    sourceId?: string;
    tokenLifetimeHours?: number;
  }): Promise<ExportLinksResult> {
    return this.request<ExportLinksResult>('/stream-tokens/export-links', {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  }

  // Settings & System
  async getSettings(): Promise<AdminSettings> {
    return this.request<AdminSettings>('/settings');
  }

  async updateSettings(data: Partial<AdminSettings>): Promise<AdminSettings> {
    return this.request<AdminSettings>('/settings', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async getActivityLogs(limit = 50): Promise<ActivityLog[]> {
    return this.request<ActivityLog[]>(`/activity-logs?limit=${limit}`);
  }

  async getHealth(): Promise<any> {
    return this.request('/health');
  }

  // VOD Movies & Series
  async getMovies(params: { category?: string; q?: string; limit?: number; offset?: number } = {}) {
    const q = new URLSearchParams();
    if (params.category) q.set('category', params.category);
    if (params.q) q.set('q', params.q);
    if (params.limit) q.set('limit', String(params.limit));
    if (params.offset) q.set('offset', String(params.offset));
    return this.request<{ total: number; categories: string[]; items: any[] }>(`/vod/movies?${q.toString()}`);
  }

  async getSeries(params: { category?: string; q?: string; limit?: number; offset?: number } = {}) {
    const q = new URLSearchParams();
    if (params.category) q.set('category', params.category);
    if (params.q) q.set('q', params.q);
    if (params.limit) q.set('limit', String(params.limit));
    if (params.offset) q.set('offset', String(params.offset));
    return this.request<{ total: number; categories: string[]; items: any[] }>(`/vod/series?${q.toString()}`);
  }

  async getSeriesDetails(id: string) {
    return this.request<any>(`/vod/series/${id}`);
  }

  async syncVod() {
    return this.request<{ success: boolean; report: any }>('/vod/sync', { method: 'POST' });
  }

  async syncTopCinema(params?: { maxMoviePages?: number; maxSeries?: number; recentLimit?: number; deep?: boolean }) {
    return this.request<{ success: boolean; message?: string; report?: any }>('/vod/topcinema-sync', {
      method: 'POST',
      body: JSON.stringify(params || {}),
    });
  }

  async syncFiveTv(params?: { maxMoviePages?: number; maxSeriesPages?: number; recentLimit?: number; deep?: boolean }) {
    return this.request<{ success: boolean; message?: string; report?: any }>('/vod/fivetv-sync', {
      method: 'POST',
      body: JSON.stringify(params || {}),
    });
  }

  async fullSyncVod(params?: { deep?: boolean }) {
    return this.request<{ success: boolean; message?: string; report?: any }>('/vod/full-sync', {
      method: 'POST',
      body: JSON.stringify(params || {}),
    });
  }

  async deepSyncVod() {
    return this.request<{ success: boolean; message: string }>('/vod/deep-sync', {
      method: 'POST',
      body: JSON.stringify({ unlimited: true }),
    });
  }

  async wipeVod() {
    return this.request<{ success: boolean; result: any; message: string }>('/vod/wipe', {
      method: 'POST',
    });
  }

  async resetMovies() {
    return this.request<{ success: boolean; message: string; deletedCount: number }>('/vod/reset-movies', {
      method: 'POST',
    });
  }

  async purgeDeadVod() {
    return this.request<{ success: boolean; message: string; report: any }>('/vod/purge-dead', {
      method: 'POST',
    });
  }

  async resolveStream(url: string) {
    return this.request<{ directUrl: string; title?: string }>(`/vod/resolve-stream?url=${encodeURIComponent(url)}`);
  }
}

export const api = new ApiClient();
