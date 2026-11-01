import 'fake-indexeddb/auto';
import { beforeEach } from 'vitest';
import { openDatabase } from '../../src/db';

// jsdom has no Web Locks. Grant one exclusive lock at a time, in request order.
if (!navigator.locks) {
  const queues = new Map<string, Promise<unknown>>();
  Object.defineProperty(navigator, 'locks', { value: {
    request(name: string, callback: () => Promise<unknown>) {
      const result = (queues.get(name) ?? Promise.resolve()).then(() => callback());
      queues.set(name, result.catch(() => undefined));
      return result;
    },
  } });
}

beforeEach(async () => {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('notes', 'readwrite');
    tx.objectStore('notes').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
});
