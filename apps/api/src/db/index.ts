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
export async function initDatabase(): Promise<boolean> {
  const p = getPool();
  if (!p) {
    console.log('[PostgreSQL] DATABASE_URL not set; using local in-memory fallback.');
    return false;
  }

  if (isInitialized) {
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
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_channels_source_id ON channels(source_id);
        CREATE INDEX IF NOT EXISTS idx_channels_active_output_id ON channels(active_output_id);
        CREATE INDEX IF NOT EXISTS idx_channels_enabled ON channels(enabled);

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
