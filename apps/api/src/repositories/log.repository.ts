import * as crypto from 'crypto';
import { ActivityLog, ActivityLogEntityType, ActivityLogResult } from '@aspreen/shared';
import { getFirestore } from '../firebase/admin';
import { cleanUndefined } from '../firebase/utils';
import { getPool } from '../db';

const LOGS_COLLECTION = 'activityLogs';

function sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['token', 'password', 'key', 'secret', 'credential', 'authorization', 'cookie', 'url'];
  const sanitized: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(details)) {
    const lowerKey = k.toLowerCase();
    if (sensitiveKeys.some((s) => lowerKey.includes(s))) {
      if (typeof v === 'string' && (lowerKey.includes('url') || lowerKey.includes('host'))) {
        try {
          const parsed = new URL(v);
          sanitized[k] = `${parsed.protocol}//${parsed.hostname}${parsed.pathname ? '/...' : ''}`;
        } catch {
          sanitized[k] = '[REDACTED]';
        }
      } else {
        sanitized[k] = '[REDACTED]';
      }
    } else if (typeof v === 'object' && v !== null) {
      sanitized[k] = sanitizeDetails(v as Record<string, unknown>);
    } else {
      sanitized[k] = v;
    }
  }

  return sanitized;
}

function mapLogRow(row: any): ActivityLog {
  const details = typeof row.safe_details === 'string'
    ? JSON.parse(row.safe_details)
    : (row.safe_details || {});

  return {
    id: row.id,
    eventType: row.event_type,
    entityType: row.entity_type as ActivityLogEntityType,
    entityId: row.entity_id ?? undefined,
    result: row.result as ActivityLogResult,
    safeDetails: details,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || new Date().toISOString()),
  };
}

export class LogRepository {
  private db = getFirestore();

  async addLog(entry: {
    eventType: string;
    entityType: ActivityLogEntityType;
    entityId?: string;
    result: ActivityLogResult;
    safeDetails?: Record<string, unknown>;
  }): Promise<ActivityLog> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const log: ActivityLog = {
      id,
      eventType: entry.eventType,
      entityType: entry.entityType,
      entityId: entry.entityId,
      result: entry.result,
      safeDetails: sanitizeDetails(entry.safeDetails || {}),
      createdAt: now,
    };

    const pool = getPool();
    if (pool) {
      await pool.query(
        `INSERT INTO activity_logs (
          id, event_type, entity_type, entity_id, result, safe_details, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          log.id,
          log.eventType,
          log.entityType,
          log.entityId || null,
          log.result,
          JSON.stringify(log.safeDetails),
          log.createdAt,
        ]
      );
      return log;
    }

    const docRef = await this.db.collection(LOGS_COLLECTION).doc(id);
    await docRef.set(cleanUndefined(log));
    return log;
  }

  async listLogs(limitCount: number = 100): Promise<ActivityLog[]> {
    const pool = getPool();
    if (pool) {
      const res = await pool.query('SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT $1', [limitCount]);
      return res.rows.map(mapLogRow);
    }

    const colRef = this.db.collection(LOGS_COLLECTION);
    const snap = await colRef.limit(limitCount).get();
    const logs = snap.docs.map((d: any) => d.data() as ActivityLog);
    return logs.sort((a: ActivityLog, b: ActivityLog) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export const logRepository = new LogRepository();
