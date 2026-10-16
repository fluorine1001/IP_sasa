import type { FlightSession } from '../screens/flight/session';
import type { Stage } from '../world/types';

export const manualFlightDatabase = 'orbit-workshop-manual-v1';
const store = 'flights';
export type ManualArchive = {
  key: string;
  stage: Stage;
  plan?: FlightSession['plan'];
  trials: FlightSession['trials'];
  updatedAt: number;
};

/** A different environment/goal never reuses a recording against the new world.
 * Author verification plans do not change the physical experiment. */
export function manualStageIdentity(stage: Stage) {
  return JSON.stringify({ ...stage, referencePlans: [] });
}
export async function manualArchiveKey(stage: Stage) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(manualStageIdentity(stage)),
  );
  return (
    stage.id +
    ':' +
    [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('')
  );
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open(manualFlightDatabase, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(store, { keyPath: 'key' });
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(Error('다른 제작소 창의 기록 저장 연결을 닫아 주세요.'));
    };
  });
}
export async function readManualArchive(key: string): Promise<ManualArchive | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(store, 'readonly'),
        request = transaction.objectStore(store).get(key);
      transaction.oncomplete = () => resolve(request.result as ManualArchive | undefined);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
export async function writeManualArchive(archive: ManualArchive): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(store, 'readwrite');
      transaction.objectStore(store).put(archive);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
