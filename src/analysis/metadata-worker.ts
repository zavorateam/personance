import { extractAcousticMetrics } from './acoustics';
import { buildTrackMetadataReport } from './classifiers';
import type { SongAnalysis } from '../types/song-analysis';
import type { PreservedFileTags, VltkTechInfo } from '../types/track-metadata';

export interface MetadataWorkerRequest {
  channels: Float32Array[];
  sampleRate: number;
  length: number;
  analysis: SongAnalysis;
  tech: VltkTechInfo;
  preserved: PreservedFileTags;
}

self.onmessage = (e: MessageEvent<MetadataWorkerRequest>) => {
  try {
    const { channels, sampleRate, length, analysis, tech, preserved } = e.data;
    const bufferLike = {
      sampleRate,
      numberOfChannels: channels.length,
      length,
      duration: length / Math.max(1, sampleRate),
      getChannelData: (c: number) => channels[Math.min(c, channels.length - 1)],
    } as unknown as AudioBuffer;

    const acoustics = extractAcousticMetrics(bufferLike);
    const metadata = buildTrackMetadataReport({
      analysis,
      acoustics,
      tech,
      preserved,
    });
    (self as unknown as Worker).postMessage({ ok: true, metadata });
  } catch (err) {
    (self as unknown as Worker).postMessage({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
