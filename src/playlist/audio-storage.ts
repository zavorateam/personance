/**
 * Persistent lossless audio storage using IndexedDB and native CompressionStream.
 * Stores full audio track binary data across sessions with zero quality loss.
 */

const DB_NAME = 'PersonanceAudioStore';
const DB_VERSION = 1;
const STORE_NAME = 'tracks';

interface StoredAudioRecord {
  id: string;
  name: string;
  type: string;
  originalSize: number;
  isCompressed: boolean;
  data: ArrayBuffer;
  updatedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Losslessly compresses an ArrayBuffer using native CompressionStream ('gzip').
 * If compression does not reduce size (e.g. already compressed MP3), returns raw buffer.
 */
async function compressLossless(buffer: ArrayBuffer): Promise<{ data: ArrayBuffer; isCompressed: boolean }> {
  if (typeof CompressionStream === 'undefined') {
    return { data: buffer, isCompressed: false };
  }
  try {
    const stream = new Response(buffer).body?.pipeThrough(new CompressionStream('gzip'));
    if (!stream) return { data: buffer, isCompressed: false };
    const compressedBuffer = await new Response(stream).arrayBuffer();
    // Only use compressed if it actually saved space
    if (compressedBuffer.byteLength < buffer.byteLength) {
      return { data: compressedBuffer, isCompressed: true };
    }
  } catch (err) {
    console.warn('Lossless compression skipped:', err);
  }
  return { data: buffer, isCompressed: false };
}

/**
 * Losslessly decompresses an ArrayBuffer using native DecompressionStream ('gzip').
 */
async function decompressLossless(buffer: ArrayBuffer, isCompressed: boolean): Promise<ArrayBuffer> {
  if (!isCompressed || typeof DecompressionStream === 'undefined') {
    return buffer;
  }
  try {
    const stream = new Response(buffer).body?.pipeThrough(new DecompressionStream('gzip'));
    if (!stream) return buffer;
    return await new Response(stream).arrayBuffer();
  } catch (err) {
    console.warn('Decompression failed, using raw buffer:', err);
    return buffer;
  }
}

/**
 * Saves a track's audio file into IndexedDB with lossless compression.
 */
export async function saveTrackAudio(id: string, file: File): Promise<void> {
  try {
    const db = await openDB();
    const rawBuffer = await file.arrayBuffer();
    const { data, isCompressed } = await compressLossless(rawBuffer);

    const record: StoredAudioRecord = {
      id,
      name: file.name,
      type: file.type || 'audio/mpeg',
      originalSize: file.size,
      isCompressed,
      data,
      updatedAt: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error(`Failed to save audio track [${id}] to IndexedDB:`, err);
  }
}

/**
 * Retrieves and reconstructs a File from IndexedDB.
 */
export async function getTrackAudio(id: string): Promise<File | null> {
  try {
    const db = await openDB();
    const record: StoredAudioRecord | null = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });

    if (!record) return null;

    const decompressed = await decompressLossless(record.data, record.isCompressed);
    return new File([decompressed], record.name, { type: record.type });
  } catch (err) {
    console.error(`Failed to load audio track [${id}] from IndexedDB:`, err);
    return null;
  }
}

/**
 * Deletes a track from IndexedDB.
 */
export async function deleteTrackAudio(id: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error(`Failed to delete audio track [${id}] from IndexedDB:`, err);
  }
}

/**
 * Cleans up orphaned audio tracks from IndexedDB that are no longer in any playlist.
 */
export async function pruneAudioStorage(validTrackIds: Set<string>): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAllKeys();
    req.onsuccess = () => {
      const keys = req.result as string[];
      for (const key of keys) {
        if (!validTrackIds.has(key)) {
          store.delete(key);
        }
      }
    };
  } catch {
    // Non-critical cleanup
  }
}
