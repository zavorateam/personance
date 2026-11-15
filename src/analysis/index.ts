import { openDB, type IDBPDatabase } from 'idb';
import type { AnalysisProgress, SongAnalysis } from '../types/song-analysis';
import { SONG_ANALYSIS_VERSION } from '../types/song-analysis';
import type { PreservedFileTags, TrackMetadataReport, VltkTechInfo } from '../types/track-metadata';
import type { AnalyzeRequest } from './worker';
import type { MetadataWorkerRequest } from './metadata-worker';

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB('personance', 1, {
    upgrade(d) {
      d.createObjectStore('analysis');
    },
  });
  return dbPromise;
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getCachedAnalysis(hash: string): Promise<SongAnalysis | null> {
  const hit = (await (await db()).get('analysis', hash)) as SongAnalysis | undefined;
  return hit && hit.version === SONG_ANALYSIS_VERSION ? hit : null;
}

export async function cacheAnalysis(a: SongAnalysis): Promise<void> {
  await (await db()).put('analysis', a, a.contentHash);
}

/** Resample to 22050 Hz mono (Beat This! native rate) with proper filtering. */
async function toMono22k(buffer: AudioBuffer): Promise<Float32Array> {
  const length = Math.ceil(buffer.duration * 22050);
  const off = new OfflineAudioContext(1, length, 22050);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return rendered.getChannelData(0);
}

/**
 * Analyze off-thread. Resolves with the classical result as soon as it's
 * ready (playback can start); `onRefined` fires later when the neural
 * pass lands (or with the same analysis if it was skipped).
 */
export async function analyzeInWorker(
  buffer: AudioBuffer,
  contentHash: string,
  onProgress: (p: AnalysisProgress) => void,
  onRefined: (a: SongAnalysis) => void,
): Promise<SongAnalysis> {
  const mono = await toMono22k(buffer);

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<AnalysisProgress | { stage: 'error'; message: string }>) => {
      const msg = e.data;
      if (msg.stage === 'error') {
        worker.terminate();
        reject(new Error(msg.message));
      } else if (msg.stage === 'done') {
        resolve(msg.analysis);
      } else if (msg.stage === 'refined') {
        worker.terminate();
        onRefined(msg.analysis);
      } else {
        onProgress(msg);
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    const req: AnalyzeRequest = { mono, sampleRate: 22050, contentHash };
    worker.postMessage(req, [mono.buffer]);
  });
}

function guessContainerFromFile(fileName: string): PreservedFileTags['container'] {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'mp3') return 'mp3';
  if (ext === 'flac') return 'flac';
  if (ext === 'wav') return 'wav';
  if (ext === 'ogg' || ext === 'opus') return 'ogg';
  if (ext === 'm4a' || ext === 'mp4' || ext === 'aac') return 'mp4';
  return 'unknown';
}

/**
 * Computes full VLTK_* acoustic & classification metadata off-thread
 * from the decoded AudioBuffer without blocking playback.
 */
export function computeTrackMetadataInWorker(
  buffer: AudioBuffer,
  analysis: SongAnalysis,
  fileName: string,
  fileSize: number,
  hasEmbeddedCover: boolean,
): Promise<TrackMetadataReport> {
  const nCh = Math.min(buffer.numberOfChannels, 2);
  const channels: Float32Array[] = [];
  const transfer: ArrayBuffer[] = [];
  for (let c = 0; c < nCh; c++) {
    const copy = new Float32Array(buffer.getChannelData(c));
    channels.push(copy);
    transfer.push(copy.buffer);
  }

  const container = guessContainerFromFile(fileName);
  const durationSec = Math.max(0.01, buffer.duration || analysis.durationSec);
  const tech: VltkTechInfo = {
    container,
    codec: container === 'unknown' ? 'pcm/audio' : container,
    codecProfile: 'standard',
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    bitrate: fileSize > 0 ? (fileSize * 8) / durationSec : 0,
    bitDepth: container === 'wav' || container === 'flac' ? 16 : null,
    durationSec,
    fileSize,
  };
  const preserved: PreservedFileTags = {
    container,
    hasEmbeddedCover,
    musicbrainz: {},
    acoustid: {},
    customTags: {},
  };

  // Clone analysis without transferring huge Float32Arrays (structured clone keeps curves intact)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./metadata-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (
      e: MessageEvent<{ ok: true; metadata: TrackMetadataReport } | { ok: false; message: string }>,
    ) => {
      worker.terminate();
      if (e.data.ok) {
        resolve(e.data.metadata);
      } else {
        reject(new Error(e.data.message));
      }
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message));
    };
    const req: MetadataWorkerRequest = {
      channels,
      sampleRate: buffer.sampleRate,
      length: buffer.length,
      analysis,
      tech,
      preserved,
    };
    worker.postMessage(req, transfer);
  });
}
