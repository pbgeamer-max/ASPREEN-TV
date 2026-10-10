/**
 * Aspreen TV Domain Types & Firestore Entities
 */

export type SourceType = 'M3U' | 'M3U8' | 'TS' | 'LOCAL_M3U';

export type SourceConnectionStatus = 'ONLINE' | 'OFFLINE' | 'UNCHECKED' | 'ERROR';

export type ChannelInputStatus = 'ONLINE' | 'OFFLINE' | 'UNKNOWN';

export type TranscodingStatus = 'STOPPED' | 'STARTING' | 'RUNNING' | 'STOPPING' | 'FAILED';

export type JobStatus =
  | 'QUEUED'
  | 'VALIDATING'
  | 'STARTING'
  | 'RUNNING'
  | 'STOPPING'
  | 'STOPPED'
  | 'FAILED'
  | 'COMPLETED';

export type TranscodingPresetId = 'COPY' | 'SOURCE_RES' | '720P' | '1080P';

export type ActivityLogResult = 'SUCCESS' | 'FAILURE' | 'WARNING';

export type ActivityLogEntityType =
  | 'SOURCE'
  | 'CHANNEL'
  | 'JOB'
  | 'STREAM_TOKEN'
  | 'SETTINGS'
  | 'AUTH'
  | 'SYSTEM';

/**
 * Firestore: adminSettings/general
 */
export interface AdminSettings {
  appName: string;
  publicStreamBaseUrl: string;
  defaultTranscodingPreset: TranscodingPresetId;
  defaultSegmentDuration: number; // in seconds (e.g., 4 or 6)
  defaultPlaylistWindow: number; // number of segments in m3u8 (e.g., 5 or 6)
  maxConcurrentJobs: number;
  maxPlaylistChannels: number;
  sourceTimeoutSeconds: number;
  defaultTokenLifetime: number; // in hours, 0 = indefinite
  outputRetentionHours: number;
  defaultProxyUrl?: string;
  updatedAt: string; // ISO String
}

/**
 * Firestore: sources/{sourceId}
 */
export interface Source {
  id: string;
  name: string;
  type: SourceType;
  sanitizedHostname: string;
  encryptedUrl: string; // AES-256-GCM encrypted
  encryptedCredentials?: string; // AES-256-GCM encrypted
  enabled: boolean;
  connectionStatus: SourceConnectionStatus;
  channelCount: number;
  lastCheckedAt?: string;
  lastErrorCode?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Firestore: channels/{channelId}
 */
export interface Channel {
  id: string;
  sourceId: string;
  externalIdentifier?: string;
  name: string;
  normalizedName: string;
  groupTitle?: string;
  logoUrl?: string;
  inputType: 'HLS' | 'TS_STREAM' | 'CUSTOM';
  encryptedInputUrl: string; // AES-256-GCM encrypted
  enabled: boolean;
  inputStatus: ChannelInputStatus;
  transcodingStatus: TranscodingStatus;
  preset: TranscodingPresetId;
  proxyUrl?: string; // Optional HTTP/SOCKS5 proxy URL for bypassing geo/datacenter blocks
  activeJobId?: string;
  activeOutputId?: string; // Random public slug for HLS output path
  createdAt: string;
  updatedAt: string;
}

/**
 * Firestore: transcodingJobs/{jobId}
 */
export interface TranscodingJob {
  id: string;
  channelId: string;
  sourceId: string;
  status: JobStatus;
  preset: TranscodingPresetId;
  validatedConfiguration: {
    segmentDuration: number;
    playlistWindow: number;
    videoCodec: string;
    audioCodec: string;
    scale?: string;
    bitrate?: string;
  };
  workerId?: string;
  processId?: number;
  outputDirectoryId: string;
  queuedAt: string;
  startedAt?: string;
  stoppedAt?: string;
  lastHeartbeatAt?: string;
  lastErrorCode?: string;
  sanitizedErrorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Firestore: streamTokens/{tokenId}
 */
export interface StreamToken {
  id: string;
  channelId: string;
  name: string;
  tokenHash: string; // SHA-256 hash of token
  publicOutputId: string;
  createdAt: string;
  expiresAt?: string; // ISO string, optional
  revokedAt?: string; // ISO string if revoked
  lastUsedAt?: string;
}

/**
 * Firestore: activityLogs/{logId}
 */
export interface ActivityLog {
  id: string;
  eventType: string;
  entityType: ActivityLogEntityType;
  entityId?: string;
  result: ActivityLogResult;
  safeDetails: Record<string, unknown>;
  createdAt: string;
}

/**
 * Firestore: systemMetrics/{metricId}
 */
export interface SystemMetrics {
  timestamp: string;
  cpuUsage: number; // percentage 0-100
  memoryUsage: number; // percentage 0-100
  diskUsage: number; // percentage 0-100
  activeJobs: number;
  queuedJobs: number;
  outboundBandwidthMbps?: number;
}

/**
 * Stream Probe Information (via ffprobe)
 */
export interface StreamProbeInfo {
  formatName: string;
  duration?: number;
  bitrate?: number;
  video?: {
    codec: string;
    width: number;
    height: number;
    fps?: number;
    bitrate?: number;
  };
  audio?: {
    codec: string;
    channels: number;
    sampleRate: number;
    bitrate?: number;
  };
}

/**
 * Parsed M3U Item from Playlist Parser
 */
export interface ParsedM3UChannel {
  tvgId?: string;
  tvgName?: string;
  tvgLogo?: string;
  groupTitle?: string;
  displayName: string;
  url: string;
  rawAttributes?: Record<string, string>;
}

export interface PlaylistParseResult {
  isMasterPlaylist: boolean;
  isMediaPlaylist: boolean;
  isChannelCollection: boolean;
  channels: ParsedM3UChannel[];
  totalEntries: number;
  validEntries: number;
  invalidEntries: number;
}

/**
 * Dashboard Summary Metric DTO
 */
export interface DashboardSummary {
  totalSources: number;
  totalChannels: number;
  activeJobs: number;
  queuedJobs: number;
  failedJobs: number;
  activeOutputs: number;
  system: {
    cpuUsage: number | null;
    memoryUsage: number | null;
    diskUsage: number | null;
    networkThroughputMbps: number | null;
    isAvailable: boolean;
  };
  recentJobs: TranscodingJob[];
  recentActivity: ActivityLog[];
}

/**
 * Bulk Operation Types
 */
export interface BulkStartResult {
  totalTargeted: number;
  startedCount: number;
  alreadyRunningCount: number;
  skippedCount: number;
  errors: string[];
}

export interface BulkStopResult {
  stoppedCount: number;
}

export interface ExportedChannelItem {
  id: string;
  name: string;
  groupTitle?: string;
  logoUrl?: string;
  playbackUrl: string;
  tsPlaybackUrl: string;
}

export interface ExportLinksResult {
  totalChannels: number;
  channels: ExportedChannelItem[];
  txtContent: string;
  m3uContent: string;
}
