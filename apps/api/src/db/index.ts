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

function findShahidChannelsJsonPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'data/shahid_channels.json'),
    path.resolve(process.cwd(), 'apps/api/data/shahid_channels.json'),
    path.resolve(process.cwd(), '../../data/shahid_channels.json'),
    path.resolve(__dirname, '../../../../data/shahid_channels.json'),
    path.resolve(__dirname, '../../../data/shahid_channels.json'),
    path.resolve(__dirname, '../../data/shahid_channels.json'),
    path.resolve('/app/data/shahid_channels.json'),
    path.resolve('/app/apps/api/data/shahid_channels.json'),
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

      // Always synchronize channels.json and shahid_channels.json into database on boot to ensure current active verified channels
      try {
        const jsonPath = findChannelsJsonPath();
        const shahidPath = findShahidChannelsJsonPath();

        let list: any[] = [];
        if (jsonPath && fs.existsSync(jsonPath)) {
          const raw = fs.readFileSync(jsonPath, 'utf-8');
          list = JSON.parse(raw);
        }

        // Also merge Shahid channels from disk
        if (shahidPath && fs.existsSync(shahidPath)) {
          try {
            const rawShahid = fs.readFileSync(shahidPath, 'utf-8');
            const shahidList = JSON.parse(rawShahid);
            if (Array.isArray(shahidList)) {
              const existingIds = new Set(list.map((c: any) => String(c.id || c.vid)));
              let addedShahid = 0;
              for (const sh of shahidList) {
                const sid = String(sh.id || sh.vid);
                if (!existingIds.has(sid)) {
                  list.push(sh);
                  existingIds.add(sid);
                  addedShahid++;
                }
              }
            }
          } catch (e: any) {
            console.error('[PostgreSQL] Failed to parse shahid_channels.json:', e.message);
          }
        }

        if (list.length > 0) {
          console.log(`[PostgreSQL] Syncing total ${list.length} channels (including Shahid) into database...`);

          // 1. Clear obsolete old channels from table & purge any tlfaz or rotana residues
          await client.query("DELETE FROM channels WHERE id LIKE 'tlfaz-%' OR source_id = 'tlfaz-arabic' OR id LIKE 'rotana-%' OR id = 'alresalah'");
          await client.query("DELETE FROM sources WHERE id = 'tlfaz-arabic'");
          await client.query('DELETE FROM channels');
          await client.query('DELETE FROM sources');

          // 2. Insert sources
          const vipCount = list.filter((c: any) => c.source === 'private-vip' || String(c.id || c.vid).startsWith('bein-vip-')).length;
          const shahidCount = list.filter((c: any) => c.source === 'shahid-livestream' || String(c.id || c.vid).startsWith('shahid-')).length;
          const rabiaaCount = list.filter((c: any) => c.source === 'alrabiaa.tv' || String(c.id || c.vid).includes('alrabiaa')).length;
          const karbalaCount = list.filter((c: any) => c.source === 'karbala-tv.iq' || String(c.id || c.vid).includes('karbala') || String(c.id || c.vid) === 'safeer-tv').length;
          const iqCount = list.filter((c: any) => c.source === 'iptv-org-iq' || String(c.id || c.vid).startsWith('iq-')).length;

          await client.query(`
            INSERT INTO sources (
              id, name, type, sanitized_hostname, encrypted_url, enabled, connection_status, channel_count, created_at, updated_at
            ) VALUES 
              ('private-vip', 'beIN SPORTS VIP (ملفاتك الخاصة)', 'M3U', 'line.hey-ott.net', $1::text, true, 'ONLINE', $2::integer, NOW(), NOW()),
              ('shahid-livestream', 'قنوات شاهد المباشرة (shahid.mbc.net)', 'M3U', 'shahid.mbc.net', $3::text, true, 'ONLINE', $4::integer, NOW(), NOW()),
              ('alrabiaa.tv', 'قناة الرابعة الفضائية (alrabiaa.tv)', 'M3U', 'alrabiaa.tv', $5::text, true, 'ONLINE', $6::integer, NOW(), NOW()),
              ('karbala-tv.iq', 'مجموعة قنوات كربلاء الفضائية (karbala-tv.iq)', 'M3U', 'karbala-tv.iq', $7::text, true, 'ONLINE', $8::integer, NOW(), NOW()),
              ('iptv-org-iq', 'باقة القنوات العراقية (Iraqi National TV)', 'M3U', 'iptv-org.github.io', $9::text, true, 'ONLINE', $10::integer, NOW(), NOW())
            ON CONFLICT (id) DO UPDATE SET channel_count = EXCLUDED.channel_count, connection_status = 'ONLINE'
          `, [
            encrypt('http://line.hey-ott.net/'), vipCount,
            encrypt('https://shahid.mbc.net/ar/livestream'), shahidCount,
            encrypt('https://alrabiaa.tv/live'), rabiaaCount,
            encrypt('https://karbala-tv.iq/'), karbalaCount,
            encrypt('https://iptv-org.github.io/iptv/countries/iq.m3u'), iqCount
          ]);

          // 3. Insert channels with servers JSON
          for (let i = 0; i < list.length; i++) {
            const item = list[i];
            const cid = String(item.id || item.vid);
            if (cid.startsWith('tlfaz-') || item.source === 'tlfaz.com' || cid.startsWith('rotana-') || cid === 'alresalah') continue;
            const isIq = item.source === 'iptv-org-iq' || cid.startsWith('iq-');
            const isKarbala = item.source === 'karbala-tv.iq' || cid.includes('karbala') || cid === 'safeer-tv';
            const isShahid = item.source === 'shahid-livestream' || cid.startsWith('shahid-');
            const isRabiaa = item.source === 'alrabiaa.tv' || cid.includes('alrabiaa');
            const sourceId = isIq ? 'iptv-org-iq' : (isKarbala ? 'karbala-tv.iq' : (isRabiaa ? 'alrabiaa.tv' : (isShahid ? 'shahid-livestream' : 'private-vip')));
            const stream = item.playUrl || item.streamUrl || item.directM3u8 || '';
            const encStream = encrypt(stream);
            const name = item.name || 'قناة غير معنونة';
            const normName = name.toLowerCase().trim();
            const grp = item.groupTitle || 'عام';
            const logo = item.logoUrl || null;
            const order = item.orderIndex || (i + 1);
            const serversJson = item.servers ? JSON.stringify(item.servers) : null;
            const isOff = item.status === 'event_only' || item.inputStatus === 'OFFLINE' || item.manual_stopped === true;

            await client.query(`
              INSERT INTO channels (
                id, source_id, external_identifier, name, normalized_name, group_title, logo_url,
                input_type, encrypted_input_url, enabled, input_status, transcoding_status,
                preset, proxy_url, order_index, servers, created_at, updated_at
              ) VALUES (
                $1::varchar, $2::varchar, $3::text, $4::text, $5::text, $6::text, $7::text,
                'HLS', $8::text, true, $9::varchar, $10::varchar,
                'COPY', $11::text, $12::integer, $13::jsonb, NOW(), NOW()
              )
            `, [
              cid, sourceId, cid, name, normName, grp, logo, encStream,
              isOff ? 'OFFLINE' : 'ONLINE',
              isOff ? 'STOPPED' : 'RUNNING',
              `/live/${cid}.m3u8`, order, serversJson
            ]);
          }

          console.log(`[PostgreSQL] Successfully synchronized all ${list.length} channels (including Shahid) into database!`);
        } else {
          console.warn('[PostgreSQL] Could not find channels.json or shahid_channels.json for auto-sync.');
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
