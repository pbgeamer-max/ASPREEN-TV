import { Pool, PoolConfig } from 'pg';

let pool: Pool | null = null;
let isInitialized = false;

export function getDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL;
}

export function isPostgresConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== '');
}

export function getPool(): Pool | null {
  if (!isPostgresConfigured()) {
    return null;
  }

  if (!pool) {
    const dbUrl = process.env.DATABASE_URL!;
    const poolConfig: PoolConfig = {
      connectionString: dbUrl,
      max: 25,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };

    // If connecting to non-localhost, enable SSL rejectUnauthorized: false if required
    if (!dbUrl.includes('localhost') && !dbUrl.includes('127.0.0.1') && !dbUrl.includes('.railway.internal')) {
      poolConfig.ssl = { rejectUnauthorized: false };
    }

    pool = new Pool(poolConfig);

    pool.on('error', (err) => {
      console.error('[PostgreSQL] Unexpected pool error on idle client:', err);
    });
  }

  return pool;
}

/**
 * Automatically creates all tables and indexes if they do not exist.
 */
export async function initDatabase(force = false): Promise<boolean> {
  const p = getPool();
  if (!p) {
    console.log('[PostgreSQL] DATABASE_URL not set; using local in-memory fallback.');
    return false;
  }

  if (isInitialized && !force) {
    return true;
  }

  try {
    const client = await p.connect();
    try {
      console.log('[PostgreSQL] Connected successfully. Initializing database schema...');

      await client.query(`
        -- 1. Sources Table
        CREATE TABLE IF NOT EXISTS sources (
          id VARCHAR(64) PRIMARY KEY,
          name TEXT NOT NULL,
          type VARCHAR(32) NOT NULL,
          sanitized_hostname TEXT NOT NULL,
          encrypted_url TEXT NOT NULL,
          encrypted_credentials TEXT,
          enabled BOOLEAN DEFAULT TRUE,
          connection_status VARCHAR(32) DEFAULT 'UNCHECKED',
          channel_count INTEGER DEFAULT 0,
          last_checked_at TIMESTAMPTZ,
          last_error_code TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        -- 2. Channels Table
        CREATE TABLE IF NOT EXISTS channels (
          id VARCHAR(64) PRIMARY KEY,
          source_id VARCHAR(64) NOT NULL,
          external_identifier TEXT,
          name TEXT NOT NULL,
          normalized_name TEXT NOT NULL,
          group_title TEXT,
          logo_url TEXT,
          input_type VARCHAR(32) NOT NULL,
          encrypted_input_url TEXT NOT NULL,
          enabled BOOLEAN DEFAULT TRUE,
          input_status VARCHAR(32) DEFAULT 'UNKNOWN',
          transcoding_status VARCHAR(32) DEFAULT 'STOPPED',
          preset VARCHAR(32) DEFAULT 'COPY',
          proxy_url TEXT,
          active_job_id TEXT,
          active_output_id TEXT,
          order_index INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        ALTER TABLE channels ADD COLUMN IF NOT EXISTS order_index INTEGER DEFAULT 0;
        CREATE INDEX IF NOT EXISTS idx_channels_source_id ON channels(source_id);
        CREATE INDEX IF NOT EXISTS idx_channels_active_output_id ON channels(active_output_id);
        CREATE INDEX IF NOT EXISTS idx_channels_enabled ON channels(enabled);
        CREATE INDEX IF NOT EXISTS idx_channels_order ON channels(order_index ASC, id ASC);

        -- Deterministic ordering migration for channels
        UPDATE channels SET order_index = sub.rn
        FROM (
          SELECT id, (ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) - 1)::integer as rn
          FROM channels
        ) sub
        WHERE channels.id = sub.id AND (channels.order_index IS NULL OR channels.order_index = 0);

        -- 3. Stream Tokens Table
        CREATE TABLE IF NOT EXISTS stream_tokens (
          id VARCHAR(64) PRIMARY KEY,
          channel_id VARCHAR(64) NOT NULL,
          name TEXT NOT NULL,
          token_hash VARCHAR(128) NOT NULL UNIQUE,
          public_output_id TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ,
          revoked_at TIMESTAMPTZ,
          last_used_at TIMESTAMPTZ
        );

        CREATE INDEX IF NOT EXISTS idx_tokens_token_hash ON stream_tokens(token_hash);
        CREATE INDEX IF NOT EXISTS idx_tokens_channel_id ON stream_tokens(channel_id);

        -- 4. Settings Table
        CREATE TABLE IF NOT EXISTS admin_settings (
          key VARCHAR(64) PRIMARY KEY,
          data JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        -- 5. Transcoding Jobs Table
        CREATE TABLE IF NOT EXISTS transcoding_jobs (
          id VARCHAR(64) PRIMARY KEY,
          channel_id VARCHAR(64) NOT NULL,
          source_id VARCHAR(64) NOT NULL,
          status VARCHAR(32) NOT NULL,
          preset VARCHAR(32) NOT NULL,
          validated_configuration JSONB NOT NULL,
          worker_id TEXT,
          process_id INTEGER,
          output_directory_id TEXT NOT NULL,
          queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          started_at TIMESTAMPTZ,
          stopped_at TIMESTAMPTZ,
          last_heartbeat_at TIMESTAMPTZ,
          last_error_code TEXT,
          sanitized_error_message TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_jobs_channel_id ON transcoding_jobs(channel_id);
        CREATE INDEX IF NOT EXISTS idx_jobs_output_dir_id ON transcoding_jobs(output_directory_id);

        -- 6. Activity Logs Table
        CREATE TABLE IF NOT EXISTS activity_logs (
          id VARCHAR(64) PRIMARY KEY,
          event_type TEXT NOT NULL,
          entity_type VARCHAR(32) NOT NULL,
          entity_id TEXT,
          result VARCHAR(32) NOT NULL,
          safe_details JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_logs_created_at ON activity_logs(created_at DESC);

        -- 7. System Metrics Table
        CREATE TABLE IF NOT EXISTS system_metrics (
          id VARCHAR(64) PRIMARY KEY,
          timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          cpu_usage REAL NOT NULL,
          memory_usage REAL NOT NULL,
          disk_usage REAL NOT NULL,
          active_jobs INTEGER NOT NULL,
          queued_jobs INTEGER NOT NULL,
          outbound_bandwidth_mbps REAL
        );

        CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON system_metrics(timestamp DESC);

        -- 8. Movies (VOD) Table (No Duplicates)
        CREATE TABLE IF NOT EXISTS movies (
          id VARCHAR(64) PRIMARY KEY,
          title TEXT NOT NULL,
          normalized_title TEXT NOT NULL UNIQUE,
          category TEXT NOT NULL DEFAULT 'أفلام عامة',
          poster_url TEXT,
          backdrop_url TEXT,
          description TEXT,
          release_year INTEGER,
          rating REAL,
          stream_url TEXT NOT NULL,
          container_extension VARCHAR(16) DEFAULT 'mp4',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_movies_category ON movies(category);
        CREATE INDEX IF NOT EXISTS idx_movies_year ON movies(release_year DESC);

        -- 9. Series (TV Shows) Table (No Duplicates)
        CREATE TABLE IF NOT EXISTS series (
          id VARCHAR(64) PRIMARY KEY,
          title TEXT NOT NULL,
          normalized_title TEXT NOT NULL UNIQUE,
          category TEXT NOT NULL DEFAULT 'مسلسلات عامة',
          poster_url TEXT,
          backdrop_url TEXT,
          description TEXT,
          release_year INTEGER,
          rating REAL,
          total_seasons INTEGER DEFAULT 1,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_series_category ON series(category);

        -- 10. Episodes Table (Strictly NO Duplicate Episodes)
        CREATE TABLE IF NOT EXISTS episodes (
          id VARCHAR(64) PRIMARY KEY,
          series_id VARCHAR(64) NOT NULL REFERENCES series(id) ON DELETE CASCADE,
          season_num INTEGER NOT NULL DEFAULT 1,
          episode_num INTEGER NOT NULL DEFAULT 1,
          title TEXT NOT NULL,
          poster_url TEXT,
          description TEXT,
          stream_url TEXT NOT NULL,
          container_extension VARCHAR(16) DEFAULT 'mp4',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT unique_series_season_episode UNIQUE (series_id, season_num, episode_num)
        );

        CREATE INDEX IF NOT EXISTS idx_episodes_series_id ON episodes(series_id, season_num ASC, episode_num ASC);

        -- Multi-Server support for direct stream relay
        ALTER TABLE movies ADD COLUMN IF NOT EXISTS servers JSONB DEFAULT '[]'::jsonb;
        ALTER TABLE episodes ADD COLUMN IF NOT EXISTS servers JSONB DEFAULT '[]'::jsonb;
      `);

      isInitialized = true;
      console.log('[PostgreSQL] Database schema verified and ready for high-performance operations.');
      return true;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('[PostgreSQL] Failed to initialize database schema:', err.message);
    return false;
  }
}
