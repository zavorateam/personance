import { generateVinylCover } from './cover-generator';
import { extractCoverArt } from '../analysis/cover-extractor';
import { saveTrackAudio, getTrackAudio, deleteTrackAudio, pruneAudioStorage } from './audio-storage';

export interface PlaylistTrack {
  id: string;
  title: string;
  artist?: string;
  durationSec?: number;
  sourceType: 'demo' | 'file';
  coverArtUrl?: string | null;
  file?: File;
  addedAt: number;
}

export interface Playlist {
  id: string;
  name: string;
  createdAt: number;
  tracks: PlaylistTrack[];
}

export type RepeatMode = 'none' | 'all' | 'one';

const STORAGE_KEY = 'personance_playlists_v2';
const LEGACY_STORAGE_KEY = 'resonance_playlists_v2';
const ACTIVE_PLAYLIST_KEY = 'personance_active_playlist_id';
const LEGACY_ACTIVE_PLAYLIST_KEY = 'resonance_active_playlist_id';

export class PlaylistManager {
  private playlists: Playlist[] = [];
  private activePlaylistId: string = '';
  private currentTrackId: string | null = null;
  private fileCache: Map<string, File> = new Map();

  repeatMode: RepeatMode = 'all';
  isShuffle: boolean = false;

  onTrackChanged: ((track: PlaylistTrack | null) => void) | null = null;
  onPlaylistsChanged: (() => void) | null = null;

  constructor() {
    this.loadFromStorage();
    if (this.playlists.length === 0) {
      this.initDefaultPlaylist();
    }
    const savedActiveId =
      localStorage.getItem(ACTIVE_PLAYLIST_KEY) || localStorage.getItem(LEGACY_ACTIVE_PLAYLIST_KEY);
    if (savedActiveId && this.playlists.some((p) => p.id === savedActiveId)) {
      this.activePlaylistId = savedActiveId;
    } else {
      this.activePlaylistId = this.playlists[0]?.id ?? '';
    }

    // Restore lossless persistent audio files from IndexedDB on startup
    void this.initAudioStorage();
  }

  /**
   * Restores cached audio files from IndexedDB into memory for instant playback.
   */
  async initAudioStorage(): Promise<void> {
    const validTrackIds = new Set<string>();
    for (const pl of this.playlists) {
      for (const tr of pl.tracks) {
        if (tr.sourceType === 'file') {
          validTrackIds.add(tr.id);
          if (!this.fileCache.has(tr.id)) {
            const restored = await getTrackAudio(tr.id);
            if (restored) {
              this.fileCache.set(tr.id, restored);
              tr.file = restored;
            }
          }
        }
      }
    }
    void pruneAudioStorage(validTrackIds);
    this.onPlaylistsChanged?.();
  }

  private initDefaultPlaylist(): void {
    const demoCover = generateVinylCover('Adventures — A Himitsu', 'A Himitsu');
    const defaultList: Playlist = {
      id: 'default-playlist',
      name: '⭐ Избранное',
      createdAt: Date.now(),
      tracks: [
        {
          id: 'demo-track-adventures',
          title: 'Adventures — A Himitsu',
          artist: 'A Himitsu',
          durationSec: 224,
          sourceType: 'demo',
          coverArtUrl: demoCover,
          addedAt: Date.now(),
        },
      ],
    };
    this.playlists = [defaultList];
    this.activePlaylistId = defaultList.id;
    this.saveToStorage();
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Playlist[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.playlists = parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to load playlists from localStorage:', e);
    }
  }

  private saveToStorage(): void {
    try {
      // Exclude in-memory File objects before stringifying
      const serializable = this.playlists.map((pl) => ({
        ...pl,
        tracks: pl.tracks.map((t) => {
          const { file: _, ...rest } = t;
          return rest;
        }),
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
      localStorage.setItem(ACTIVE_PLAYLIST_KEY, this.activePlaylistId);
    } catch (e) {
      console.warn('Failed to save playlists to localStorage:', e);
    }
  }

  getPlaylists(): Playlist[] {
    return this.playlists;
  }

  getActivePlaylist(): Playlist {
    let pl = this.playlists.find((p) => p.id === this.activePlaylistId);
    if (!pl) {
      pl = this.playlists[0];
      if (pl) this.activePlaylistId = pl.id;
    }
    return pl ?? { id: 'fallback', name: 'Основной', createdAt: Date.now(), tracks: [] };
  }

  setActivePlaylist(id: string): void {
    if (this.playlists.some((p) => p.id === id)) {
      this.activePlaylistId = id;
      this.saveToStorage();
      this.onPlaylistsChanged?.();
    }
  }

  createPlaylist(name: string): Playlist {
    const trimmed = name.trim() || `Плейлист ${this.playlists.length + 1}`;
    const newPl: Playlist = {
      id: `pl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: trimmed,
      createdAt: Date.now(),
      tracks: [],
    };
    this.playlists.push(newPl);
    this.activePlaylistId = newPl.id;
    this.saveToStorage();
    this.onPlaylistsChanged?.();
    return newPl;
  }

  renamePlaylist(id: string, newName: string): boolean {
    const pl = this.playlists.find((p) => p.id === id);
    if (!pl) return false;
    const trimmed = newName.trim();
    if (!trimmed) return false;
    pl.name = trimmed;
    this.saveToStorage();
    this.onPlaylistsChanged?.();
    return true;
  }

  deletePlaylist(id: string): boolean {
    if (this.playlists.length <= 1) {
      return false; // keep at least one playlist
    }
    const idx = this.playlists.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    this.playlists.splice(idx, 1);
    if (this.activePlaylistId === id) {
      this.activePlaylistId = this.playlists[0]?.id ?? '';
    }
    this.saveToStorage();
    this.onPlaylistsChanged?.();
    return true;
  }

  addDemoTrack(playlistId?: string): PlaylistTrack {
    const targetId = playlistId ?? this.activePlaylistId;
    const pl = this.playlists.find((p) => p.id === targetId) ?? this.getActivePlaylist();
    const cover = generateVinylCover('Adventures — A Himitsu', 'A Himitsu');
    const track: PlaylistTrack = {
      id: `demo-${Date.now()}`,
      title: 'Adventures — A Himitsu',
      artist: 'A Himitsu',
      durationSec: 224,
      sourceType: 'demo',
      coverArtUrl: cover,
      addedAt: Date.now(),
    };
    pl.tracks.push(track);
    this.saveToStorage();
    this.onPlaylistsChanged?.();
    return track;
  }

  async addFiles(files: FileList | File[], playlistId?: string): Promise<PlaylistTrack[]> {
    const targetId = playlistId ?? this.activePlaylistId;
    const pl = this.playlists.find((p) => p.id === targetId) ?? this.getActivePlaylist();
    const newTracks: PlaylistTrack[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(file.name)) {
        continue;
      }
      const trackId = `track-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
      this.fileCache.set(trackId, file);
      // Persist lossless audio in IndexedDB
      void saveTrackAudio(trackId, file);

      const title = file.name.replace(/\.[^.]+$/, '');
      let coverArtUrl: string | null = null;
      try {
        const readSize = Math.min(file.size, 24 * 1024 * 1024);
        const slice = await file.slice(0, readSize).arrayBuffer();
        let extracted = extractCoverArt(slice);
        if (!extracted && /\.(m4a|mp4|aac)$/i.test(file.name) && file.size > readSize) {
          // In M4A/MP4, 'moov' with 'covr' is frequently located at the end of the file
          const tailSize = Math.min(file.size, 10 * 1024 * 1024);
          const tailSlice = await file.slice(file.size - tailSize, file.size).arrayBuffer();
          extracted = extractCoverArt(tailSlice);
        }
        if (extracted) {
          coverArtUrl = extracted.url;
        }
      } catch (e) {
        console.warn('Cover extraction failed:', e);
      }
      if (!coverArtUrl) {
        coverArtUrl = generateVinylCover(title, 'Local Audio');
      }

      const track: PlaylistTrack = {
        id: trackId,
        title,
        sourceType: 'file',
        file,
        coverArtUrl,
        addedAt: Date.now(),
      };
      pl.tracks.push(track);
      newTracks.push(track);
    }

    this.saveToStorage();
    this.onPlaylistsChanged?.();
    return newTracks;
  }

  removeTrack(playlistId: string, trackId: string): void {
    const pl = this.playlists.find((p) => p.id === playlistId);
    if (!pl) return;
    const idx = pl.tracks.findIndex((t) => t.id === trackId);
    if (idx !== -1) {
      pl.tracks.splice(idx, 1);
      this.fileCache.delete(trackId);
      void deleteTrackAudio(trackId);
      this.saveToStorage();
      this.onPlaylistsChanged?.();
    }
  }

  moveTrack(playlistId: string, fromIndex: number, toIndex: number): void {
    const pl = this.playlists.find((p) => p.id === playlistId);
    if (!pl || fromIndex < 0 || fromIndex >= pl.tracks.length || toIndex < 0 || toIndex >= pl.tracks.length) {
      return;
    }
    const [moved] = pl.tracks.splice(fromIndex, 1);
    if (moved) {
      pl.tracks.splice(toIndex, 0, moved);
      this.saveToStorage();
      this.onPlaylistsChanged?.();
    }
  }

  updateTrackCover(trackId: string, coverUrl: string): void {
    for (const pl of this.playlists) {
      const tr = pl.tracks.find((t) => t.id === trackId);
      if (tr) {
        tr.coverArtUrl = coverUrl;
        this.saveToStorage();
        break;
      }
    }
  }

  getTrackById(trackId: string): PlaylistTrack | null {
    for (const pl of this.playlists) {
      const tr = pl.tracks.find((t) => t.id === trackId);
      if (tr) return tr;
    }
    return null;
  }

  getFile(trackId: string): File | undefined {
    return this.fileCache.get(trackId);
  }

  async getOrFetchFile(trackId: string): Promise<File | null> {
    const mem = this.fileCache.get(trackId);
    if (mem) return mem;
    const restored = await getTrackAudio(trackId);
    if (restored) {
      this.fileCache.set(trackId, restored);
      return restored;
    }
    return null;
  }

  setFile(trackId: string, file: File): void {
    this.fileCache.set(trackId, file);
    void saveTrackAudio(trackId, file);
  }

  getCurrentTrack(): PlaylistTrack | null {
    if (!this.currentTrackId) return null;
    const pl = this.getActivePlaylist();
    return pl.tracks.find((t) => t.id === this.currentTrackId) ?? null;
  }

  getCurrentTrackIndex(): number {
    if (!this.currentTrackId) return -1;
    const pl = this.getActivePlaylist();
    return pl.tracks.findIndex((t) => t.id === this.currentTrackId);
  }

  setCurrentTrackId(trackId: string | null): void {
    this.currentTrackId = trackId;
    this.onTrackChanged?.(this.getCurrentTrack());
  }

  playTrackByIndex(index: number): PlaylistTrack | null {
    const pl = this.getActivePlaylist();
    if (index < 0 || index >= pl.tracks.length) return null;
    const track = pl.tracks[index];
    this.currentTrackId = track.id;
    this.onTrackChanged?.(track);
    return track;
  }

  playTrackById(trackId: string): PlaylistTrack | null {
    const pl = this.getActivePlaylist();
    const track = pl.tracks.find((t) => t.id === trackId);
    if (!track) return null;
    this.currentTrackId = track.id;
    this.onTrackChanged?.(track);
    return track;
  }

  getNextTrack(): PlaylistTrack | null {
    const pl = this.getActivePlaylist();
    if (pl.tracks.length === 0) return null;
    if (this.repeatMode === 'one' && this.currentTrackId) {
      return this.getCurrentTrack();
    }
    const curIdx = this.getCurrentTrackIndex();
    if (this.isShuffle && pl.tracks.length > 1) {
      let randIdx = curIdx;
      while (randIdx === curIdx) {
        randIdx = Math.floor(Math.random() * pl.tracks.length);
      }
      return pl.tracks[randIdx] ?? null;
    }
    if (curIdx === -1) {
      return pl.tracks[0] ?? null;
    }
    const nextIdx = curIdx + 1;
    if (nextIdx < pl.tracks.length) {
      return pl.tracks[nextIdx] ?? null;
    }
    if (this.repeatMode === 'all') {
      return pl.tracks[0] ?? null;
    }
    return null;
  }

  getPrevTrack(): PlaylistTrack | null {
    const pl = this.getActivePlaylist();
    if (pl.tracks.length === 0) return null;
    const curIdx = this.getCurrentTrackIndex();
    if (curIdx === -1 || curIdx === 0) {
      if (this.repeatMode === 'all') {
        return pl.tracks[pl.tracks.length - 1] ?? null;
      }
      return pl.tracks[0] ?? null;
    }
    return pl.tracks[curIdx - 1] ?? null;
  }

  cycleRepeatMode(): RepeatMode {
    if (this.repeatMode === 'all') this.repeatMode = 'one';
    else if (this.repeatMode === 'one') this.repeatMode = 'none';
    else this.repeatMode = 'all';
    return this.repeatMode;
  }

  toggleShuffle(): boolean {
    this.isShuffle = !this.isShuffle;
    return this.isShuffle;
  }
}
