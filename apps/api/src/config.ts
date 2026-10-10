import * as path from 'path';

export interface AppConfig {
  nodeEnv: string;
  port: number;
  host: string;
  webBaseUrl: string;
  apiBaseUrl: string;
  publicStreamBaseUrl: string;
  sessionSecret: string;
  encryptionKey: string; // 32-byte hex or string for AES-256-GCM
  streamTokenSecret: string;
  streamStoragePath: string;
  firebaseProjectId?: string;
  firebaseClientEmail?: string;
  firebasePrivateKey?: string;
  adminAuthorizedUids: string[];
  maxConcurrentJobs: number;
  maxPlaylistChannels: number;
  sourceTimeoutSeconds: number;
  sourceConnectTimeout: number;
}

const defaultStoragePath = path.resolve(process.cwd(), '../../data/hls');

export const config: AppConfig = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),
  host: process.env.HOST || '0.0.0.0',
  webBaseUrl: process.env.WEB_BASE_URL || 'http://localhost:3000',
  apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:3001',
  publicStreamBaseUrl: process.env.PUBLIC_STREAM_BASE_URL || 'http://localhost:8080',
  sessionSecret: process.env.SESSION_SECRET || 'aspreen_tv_default_session_secret_change_in_prod_32ch',
  encryptionKey: process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  streamTokenSecret: process.env.STREAM_TOKEN_SECRET || 'aspreen_stream_token_secret_salt_value',
  streamStoragePath: process.env.STREAM_STORAGE_PATH || defaultStoragePath,
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
  firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  firebasePrivateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  adminAuthorizedUids: (process.env.ADMIN_AUTHORIZED_UIDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  maxConcurrentJobs: parseInt(process.env.MAX_CONCURRENT_JOBS || '2500', 10),
  maxPlaylistChannels: parseInt(process.env.MAX_PLAYLIST_CHANNELS || '10000', 10),
  sourceTimeoutSeconds: parseInt(process.env.SOURCE_TIMEOUT_SECONDS || '15', 10),
  sourceConnectTimeout: parseInt(process.env.SOURCE_CONNECT_TIMEOUT || '10', 10),
};
