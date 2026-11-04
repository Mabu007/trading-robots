import { isCompressedBacktest, type CompressedBacktest } from './backtest-storage';

type PendingRun = { key: string; savedAt: number; data: CompressedBacktest };
const DB_NAME = 'trading-vibes-pending-backtests';
const STORE_NAME = 'runs';

/** Durable, per-user on-device fallback for completed runs not yet acknowledged by R2. */
async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  if (typeof indexedDB === 'undefined') throw new Error('Browser offline storage is unavailable.');
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
    request.onerror = () => reject(request.error ?? new Error('Unable to open offline backtest storage.'));
    request.onsuccess = () => resolve(request.result);
  });
  return new Promise<T>((resolve, reject) => {
    let value: T;
    try {
      const tx = db.transaction(STORE_NAME, mode);
      const request = operation(tx.objectStore(STORE_NAME));
      request.onsuccess = () => { value = request.result; };
      tx.oncomplete = () => { db.close(); resolve(value); };
      tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Offline backtest storage transaction was aborted.')); };
      tx.onerror = () => { /* onabort reports the final transaction failure */ };
    } catch (error) {
      db.close();
      reject(error);
    }
  });
}

export async function savePendingBacktest(key: string, data: CompressedBacktest): Promise<void> {
  if (!key || !isCompressedBacktest(data)) throw new Error('Invalid completed backtest backup.');
  await transaction('readwrite', store => store.put({ key, savedAt: Date.now(), data } satisfies PendingRun));
}

export async function loadPendingBacktest(key: string): Promise<PendingRun | null> {
  if (!key) return null;
  const value = await transaction<PendingRun | undefined>('readonly', store => store.get(key));
  if (!value || !isCompressedBacktest(value.data) || !Number.isFinite(value.savedAt)) return null;
  return value;
}

export async function clearPendingBacktest(key: string): Promise<void> {
  if (!key) return;
  await transaction('readwrite', store => store.delete(key));
}

/** A locally completed result must not replace a newer confirmed cloud run. */
export function pendingRunIsNewer(pending: Pick<PendingRun, 'savedAt'> | null, cloud: { savedAt?: unknown } | null): boolean {
  if (!pending) return false;
  if (!cloud) return true;
  const cloudTime = typeof cloud.savedAt === 'string' ? Date.parse(cloud.savedAt) : NaN;
  return !Number.isFinite(cloudTime) || pending.savedAt > cloudTime;
}
