import 'fake-indexeddb/auto';
import { beforeEach } from 'vitest';
import { openDatabase } from '../../src/db';

beforeEach(async () => {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('notes', 'readwrite');
    tx.objectStore('notes').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
});
