import { z } from 'zod';

export const TranscodingPresetEnum = z.enum(['COPY', 'SOURCE_RES', '720P', '1080P']);
export const SourceTypeEnum = z.enum(['M3U', 'M3U8', 'LOCAL_M3U']);

export const SourceCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  type: SourceTypeEnum,
  url: z.string().url('Must be a valid URL').optional(),
  content: z.string().optional(), // For raw M3U upload
  credentials: z.string().max(500).optional(),
  customHeaders: z.record(z.string()).optional(),
  maxChannels: z.number().int().min(1).max(2000).default(500),
}).refine((data) => {
  if (data.type === 'LOCAL_M3U') {
    return !!data.content && data.content.trim().length > 0;
  }
  return !!data.url && data.url.trim().length > 0;
}, {
  message: 'URL is required for M3U/M3U8 sources, or content for Local M3U',
  path: ['url'],
});

export const SourceUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
});

export const ChannelUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  groupTitle: z.string().max(100).optional(),
  logoUrl: z.string().url().or(z.literal('')).optional(),
  enabled: z.boolean().optional(),
  preset: TranscodingPresetEnum.optional(),
});

export const StartTranscodingSchema = z.object({
  preset: TranscodingPresetEnum.optional(),
  segmentDuration: z.number().int().min(2).max(10).optional(),
  playlistWindow: z.number().int().min(3).max(20).optional(),
});

export const StreamTokenCreateSchema = z.object({
  name: z.string().min(1, 'Token name is required').max(100),
  lifetimeHours: z.number().int().min(0).max(8760).default(0), // 0 = indefinite
});

export const AdminSettingsUpdateSchema = z.object({
  appName: z.string().min(1).max(50).optional(),
  publicStreamBaseUrl: z.string().url('Must be a valid base URL').optional(),
  defaultTranscodingPreset: TranscodingPresetEnum.optional(),
  defaultSegmentDuration: z.number().int().min(2).max(10).optional(),
  defaultPlaylistWindow: z.number().int().min(3).max(20).optional(),
  maxConcurrentJobs: z.number().int().min(1).max(32).optional(),
  maxPlaylistChannels: z.number().int().min(10).max(5000).optional(),
  sourceTimeoutSeconds: z.number().int().min(3).max(60).optional(),
  defaultTokenLifetime: z.number().int().min(0).max(8760).optional(),
  outputRetentionHours: z.number().int().min(1).max(168).optional(),
});

export const LoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export type SourceCreateInput = z.infer<typeof SourceCreateSchema>;
export type SourceUpdateInput = z.infer<typeof SourceUpdateSchema>;
export type ChannelUpdateInput = z.infer<typeof ChannelUpdateSchema>;
export type StartTranscodingInput = z.infer<typeof StartTranscodingSchema>;
export type StreamTokenCreateInput = z.infer<typeof StreamTokenCreateSchema>;
export type AdminSettingsUpdateInput = z.infer<typeof AdminSettingsUpdateSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
