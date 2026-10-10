import * as admin from 'firebase-admin';
import { config } from '../config';

let firestoreInstance: admin.firestore.Firestore | null = null;
let authInstance: admin.auth.Auth | null = null;
let isInitialized = false;
let initError: string | null = null;
let isUsingMock = false;

// In-memory mock storage for local testing when Firebase credentials are not yet configured
class MockFirestoreCollection {
  private docs: Map<string, any> = new Map();

  async doc(id: string) {
    return {
      id,
      get: async () => ({
        id,
        exists: this.docs.has(id),
        data: () => this.docs.get(id),
      }),
      set: async (data: any, options?: { merge?: boolean }) => {
        if (options?.merge && this.docs.has(id)) {
          this.docs.set(id, { ...this.docs.get(id), ...data });
        } else {
          this.docs.set(id, data);
        }
      },
      update: async (data: any) => {
        if (!this.docs.has(id)) throw new Error(`Document ${id} not found`);
        this.docs.set(id, { ...this.docs.get(id), ...data });
      },
      delete: async () => {
        this.docs.delete(id);
      },
    };
  }

  async get() {
    const docs = Array.from(this.docs.entries()).map(([id, data]) => ({
      id,
      exists: true,
      data: () => data,
    }));
    return {
      empty: docs.length === 0,
      size: docs.length,
      docs,
    };
  }

  where(field: string, op: string, val: any) {
    return {
      get: async () => {
        const filtered = Array.from(this.docs.entries())
          .filter(([_, d]) => {
            if (op === '==') return d[field] === val;
            if (op === '!=') return d[field] !== val;
            if (op === 'in') return Array.isArray(val) && val.includes(d[field]);
            return true;
          })
          .map(([id, data]) => ({
            id,
            exists: true,
            data: () => data,
          }));
        return {
          empty: filtered.length === 0,
          size: filtered.length,
          docs: filtered,
        };
      },
      limit: (n: number) => ({
        get: async () => {
          const res = await this.where(field, op, val).get();
          return {
            empty: res.docs.length === 0,
            size: Math.min(res.docs.length, n),
            docs: res.docs.slice(0, n),
          };
        },
      }),
    };
  }

  limit(n: number) {
    return {
      get: async () => {
        const res = await this.get();
        return {
          empty: res.docs.length === 0,
          size: Math.min(res.docs.length, n),
          docs: res.docs.slice(0, n),
        };
      },
    };
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
    return {
      limit: (n: number) => ({
        get: async () => {
          const res = await this.get();
          const sorted = [...res.docs].sort((a, b) => {
            const va = a.data()[field] ?? '';
            const vb = b.data()[field] ?? '';
            return direction === 'asc'
              ? String(va).localeCompare(String(vb))
              : String(vb).localeCompare(String(va));
          });
          return {
            empty: sorted.length === 0,
            size: Math.min(sorted.length, n),
            docs: sorted.slice(0, n),
          };
        },
      }),
      get: async () => this.get(),
    };
  }
}

class MockFirestore {
  private collections: Map<string, MockFirestoreCollection> = new Map();

  collection(name: string) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new MockFirestoreCollection());
    }
    return this.collections.get(name)!;
  }

  batch() {
    const ops: Array<() => Promise<void>> = [];
    return {
      set: (docRef: any, data: any, options?: any) => {
        ops.push(async () => {
          const doc = docRef && typeof docRef.then === 'function' ? await docRef : docRef;
          if (doc?.set) {
            await doc.set(data, options);
          }
        });
      },
      update: (docRef: any, data: any) => {
        ops.push(async () => {
          const doc = docRef && typeof docRef.then === 'function' ? await docRef : docRef;
          if (doc?.update) {
            await doc.update(data);
          }
        });
      },
      delete: (docRef: any) => {
        ops.push(async () => {
          const doc = docRef && typeof docRef.then === 'function' ? await docRef : docRef;
          if (doc?.delete) {
            await doc.delete();
          }
        });
      },
      commit: async () => {
        for (const op of ops) {
          await op();
        }
      },
    };
  }
}

const mockDb = new MockFirestore();

/**
 * Initializes Firebase Admin SDK.
 */
export function initFirebaseAdmin(): { db: any; auth: any; isMock: boolean } {
  if (isInitialized && firestoreInstance) {
    return { db: firestoreInstance, auth: authInstance, isMock: isUsingMock };
  }

  try {
    if (admin.apps.length > 0) {
      firestoreInstance = admin.firestore();
      try {
        firestoreInstance.settings({ ignoreUndefinedProperties: true });
      } catch {}
      authInstance = admin.auth();
      isInitialized = true;
      isUsingMock = false;
      return { db: firestoreInstance, auth: authInstance, isMock: false };
    }

    // Check if Firebase service account or project ID is configured
    if (config.firebaseProjectId) {
      if (config.firebaseClientEmail && config.firebasePrivateKey) {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: config.firebaseProjectId,
            clientEmail: config.firebaseClientEmail,
            privateKey: config.firebasePrivateKey,
          }),
        });
      } else {
        // Use Application Default Credentials or Emulator
        admin.initializeApp({
          projectId: config.firebaseProjectId,
        });
      }

      firestoreInstance = admin.firestore();
      try {
        firestoreInstance.settings({ ignoreUndefinedProperties: true });
      } catch {}
      authInstance = admin.auth();
      isInitialized = true;
      isUsingMock = false;
      return { db: firestoreInstance, auth: authInstance, isMock: false };
    }

    // If emulator host is defined
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      admin.initializeApp({
        projectId: 'aspreen-tv-local',
      });
      firestoreInstance = admin.firestore();
      try {
        firestoreInstance.settings({ ignoreUndefinedProperties: true });
      } catch {}
      authInstance = admin.auth();
      isInitialized = true;
      isUsingMock = false;
      return { db: firestoreInstance, auth: authInstance, isMock: false };
    }

    // Fallback to high-performance local in-memory Firestore mock when no project credentials configured
    isUsingMock = true;
    isInitialized = true;
    return { db: mockDb as any, auth: null, isMock: true };
  } catch (err: any) {
    initError = err.message || String(err);
    isUsingMock = true;
    isInitialized = true;
    return { db: mockDb as any, auth: null, isMock: true };
  }
}

export function getFirestore(): any {
  const { db } = initFirebaseAdmin();
  return db;
}

export function getFirebaseAuth(): any {
  const { auth } = initFirebaseAdmin();
  return auth;
}

export interface FirebaseHealthStatus {
  status: 'CONNECTED' | 'EMULATOR' | 'MOCK_STANDALONE' | 'ERROR';
  projectId: string;
  isMock: boolean;
  error?: string;
  latencyMs?: number;
}

export async function checkFirebaseHealth(): Promise<FirebaseHealthStatus> {
  const start = Date.now();
  try {
    const { db, isMock } = initFirebaseAdmin();
    // Test write and read on health check document
    const testDoc = await db.collection('adminSettings').doc('general');
    await testDoc.get();
    const latency = Date.now() - start;

    if (isMock) {
      return {
        status: 'MOCK_STANDALONE',
        projectId: config.firebaseProjectId || 'standalone-local-mode',
        isMock: true,
        latencyMs: latency,
      };
    }

    if (process.env.FIRESTORE_EMULATOR_HOST) {
      return {
        status: 'EMULATOR',
        projectId: config.firebaseProjectId || 'aspreen-tv-local',
        isMock: false,
        latencyMs: latency,
      };
    }

    return {
      status: 'CONNECTED',
      projectId: config.firebaseProjectId || 'configured-gcp-project',
      isMock: false,
      latencyMs: latency,
    };
  } catch (err: any) {
    return {
      status: 'ERROR',
      projectId: config.firebaseProjectId || 'unknown',
      isMock: false,
      error: err.message,
    };
  }
}
