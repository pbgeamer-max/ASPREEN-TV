import { Pool, PoolConfig } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { encrypt } from '../security/encryption';

function findChannelsJsonPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'channels.json'),
    path.resolve(process.cwd(), 'apps/api/channels.json'),
    path.resolve(process.cwd(), '../../channels.json'),
    path.resolve(__dirname, '../../../../channels.json'),
    path.resolve(__dirname, '../../../channels.json'),
    path.resolve('/app/channels.json'),
    path.resolve('/app/apps/api/channels.json'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}


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
        ALTER TABLE channels ADD COLUMN IF NOT EXISTS servers JSONB;
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

        -- Drop legacy VOD tables if present
        DROP TABLE IF EXISTS episodes CASCADE;
        DROP TABLE IF EXISTS series CASCADE;
        DROP TABLE IF EXISTS movies CASCADE;
      `);

      // Always synchronize channels.json into database on boot to ensure current active verified channels
      try {
        const jsonPath = findChannelsJsonPath();
        if (jsonPath && fs.existsSync(jsonPath)) {
          const raw = fs.readFileSync(jsonPath, 'utf-8');
          const list = JSON.parse(raw);
          console.log(`[PostgreSQL] Syncing ${list.length} channels from ${jsonPath}...`);

          // 1. Clear obsolete old channels from table
          await client.query('DELETE FROM channels');
          await client.query('DELETE FROM sources');

          // 2. Insert sources
          const vipCount = list.filter((c: any) => c.source === 'private-vip').length;
          const tlfazCount = list.filter((c: any) => c.source !== 'private-vip').length;

          await client.query(`
            INSERT INTO sources (
              id, name, type, sanitized_hostname, encrypted_url, enabled, connection_status, channel_count, created_at, updated_at
            ) VALUES 
              ('private-vip', 'beIN SPORTS VIP (ملفاتك الخاصة)', 'M3U', 'line.hey-ott.net', $1::text, true, 'ONLINE', $2::integer, NOW(), NOW()),
              ('tlfaz-arabic', 'قنوات تلفاز العرب (tlfaz.com)', 'M3U', 'tlfaz.com', $3::text, true, 'ONLINE', $4::integer, NOW(), NOW())
            ON CONFLICT (id) DO UPDATE SET channel_count = EXCLUDED.channel_count, connection_status = 'ONLINE'
          `, [encrypt('http://line.hey-ott.net/'), vipCount, encrypt('https://tlfaz.com/'), tlfazCount]);

          // 3. Insert channels with servers JSON
          for (let i = 0; i < list.length; i++) {
            const item = list[i];
            const cid = String(item.id || item.vid);
            const sourceId = item.source === 'private-vip' ? 'private-vip' : 'tlfaz-arabic';
            const stream = item.streamUrl || item.directM3u8 || '';
            const encStream = encrypt(stream);
            const name = item.name || 'قناة غير معنونة';
            const normName = name.toLowerCase().trim();
            const grp = item.groupTitle || 'عام';
            const logo = item.logoUrl || null;
            const order = item.orderIndex || (i + 1);
            const serversJson = item.servers ? JSON.stringify(item.servers) : null;

            await client.query(`
              INSERT INTO channels (
                id, source_id, external_identifier, name, normalized_name, group_title, logo_url,
                input_type, encrypted_input_url, enabled, input_status, transcoding_status,
                preset, proxy_url, order_index, servers, created_at, updated_at
              ) VALUES (
                $1::varchar, $2::varchar, $3::text, $4::text, $5::text, $6::text, $7::text,
                'HLS', $8::text, true, 'ONLINE', 'RUNNING',
                'COPY', $9::text, $10::integer, $11::jsonb, NOW(), NOW()
              )
            `, [cid, sourceId, cid, name, normName, grp, logo, encStream, `/live/${cid}.m3u8`, order, serversJson]);
          }

          console.log(`[PostgreSQL] Successfully synchronized ${list.length} channels into database!`);
        } else {
          console.warn('[PostgreSQL] Could not find channels.json for auto-sync.');
        }
      } catch (seedErr: any) {
        console.error('[PostgreSQL] Auto-sync failed:', seedErr.message);
      }

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
