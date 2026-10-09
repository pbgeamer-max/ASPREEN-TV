import * as crypto from 'crypto';
import { ActivityLog, ActivityLogEntityType, ActivityLogResult } from '@aspreen/shared';
import { getFirestore } from '../firebase/admin';
import { cleanUndefined } from '../firebase/utils';

const LOGS_COLLECTION = 'activityLogs';

/**
 * Strips sensitive keys and patterns from details before storing.
 */
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

    const docRef = await this.db.collection(LOGS_COLLECTION).doc(id);
    await docRef.set(cleanUndefined(log));
    return log;
  }

  async listLogs(limitCount: number = 50): Promise<ActivityLog[]> {
    const colRef = this.db.collection(LOGS_COLLECTION);
    const snap = await colRef.limit(limitCount).get();
    const logs = snap.docs.map((d: any) => d.data() as ActivityLog);
    return logs.sort((a: ActivityLog, b: ActivityLog) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export const logRepository = new LogRepository();
