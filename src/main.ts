import * as THREE from 'three/webgpu';
import { analyzeInWorker, cacheAnalysis, getCachedAnalysis, sha256Hex } from './analysis';
import { applyInterfacePalette, emotionPalette, extractPalette } from './analysis/palette';
import { requestDirectorPlan } from './conductor/director';
import { Attractor } from './scenes/attractor';
import { PostStack } from './post/pipeline';
import { FilePlayer } from './audio/file-player';
import type { FrameFeatures } from './audio/features';
import { LiveProvider, type LiveSource } from './audio/live-provider';
import { BlackHole } from './scenes/blackhole';
import { Boids } from './scenes/boids';
import { FerrofluidBlob } from './scenes/ferrofluid';
import { LavaLamp } from './scenes/lavalamp';
import { Fractal } from './scenes/fractal';
import { Kifs } from './scenes/kifs';
import { SceneManager } from './scenes/manager';
import { ParticleField } from './scenes/particles';
import { Physarum } from './scenes/physarum';
import type { SceneContext } from './scenes/scene';
import { Terrain } from './scenes/terrain';
import type { SongAnalysis, Palette } from './types/song-analysis';
import { SONG_ANALYSIS_VERSION } from './types/song-analysis';
import { DevPanel } from './ui/panel';
import { PlaylistManager, type PlaylistTrack } from './playlist/playlist-manager';
import { PlaylistUI } from './playlist/playlist-ui';
import { generateVinylCover } from './playlist/cover-generator';

// Core elements
const app = document.getElementById('app')!;
const hud = document.getElementById('hud')!;
const statusEl = document.getElementById('status')!;
const toastEl = document.getElementById('toast')!;
const progressWrap = document.getElementById('progress-wrap')!;
const progressBar = document.getElementById('progress-bar')!;
const backendTag = document.getElementById('backend-tag')!;

// Navigation & Dock elements
const autoSceneBtn = document.getElementById('auto-scene-btn') as HTMLButtonElement;
const sceneButtons = document.querySelectorAll<HTMLButtonElement>('.scene-btn');
const devPanelBtn = document.getElementById('dev-panel-btn') as HTMLButtonElement;
const helpBtn = document.getElementById('help-btn') as HTMLButtonElement;
const fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement;
const shortcutsModal = document.getElementById('shortcuts-modal')!;
const modalCloseBtn = document.getElementById('modal-close-btn') as HTMLButtonElement;
const openFileNavBtn = document.getElementById('open-file-nav-btn') as HTMLButtonElement;
const openFileBtn = document.getElementById('open-file-btn') as HTMLButtonElement;
const liveMicBtn = document.getElementById('live-mic-btn') as HTMLButtonElement;
const liveSysBtn = document.getElementById('live-sys-btn') as HTMLButtonElement;
const cinemaBtn = document.getElementById('cinema-btn') as HTMLButtonElement | null;

// Player Dock Controls & Rotating Vinyl Disc
const dockPlayBtn = document.getElementById('dock-play-btn') as HTMLButtonElement;
const dockPrevBtn = document.getElementById('dock-prev-btn') as HTMLButtonElement;
const dockNextBtn = document.getElementById('dock-next-btn') as HTMLButtonElement;
const dockCoverDisc = document.getElementById('dock-cover-disc') as HTMLElement;
const dockCoverArt = document.getElementById('dock-cover-art') as HTMLElement;
const playIcon = document.getElementById('play-icon') as unknown as HTMLElement;
const pauseIcon = document.getElementById('pause-icon') as unknown as HTMLElement;
const dockTrackTitle = document.getElementById('dock-track-title')!;
const badgeBpm = document.getElementById('badge-bpm')!;

// Timeline & Scrubber
const timelineContainer = document.getElementById('timeline-container')!;
const timelineFill = document.getElementById('timeline-fill')!;
const timelineThumb = document.getElementById('timeline-thumb')!;
const timelineSections = document.getElementById('timeline-sections')!;
const timeCurrent = document.getElementById('time-current')!;
const timeDuration = document.getElementById('time-duration')!;

// Volume
const volSlider = document.getElementById('vol-slider') as HTMLInputElement;
const volMuteBtn = document.getElementById('vol-mute-btn') as HTMLButtonElement;
const volIcon = document.getElementById('vol-icon') as unknown as HTMLElement;
const volMutedIcon = document.getElementById('vol-muted-icon') as unknown as HTMLElement;

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function toast(msg: string, holdMs = 2600): void {
  toastEl.textContent = msg;
  toastEl.classList.add('visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('visible'), holdMs);
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const IDLE_SPECTRUM = new Float32Array(1024);

/** Inspection hook for automated validation. */
const debugState = {
  features: null as FrameFeatures | null,
  analysis: null as SongAnalysis | null,
  analysisMs: 0,
  analysisCached: false,
  playing: false,
  time: 0,
  frames: 0,
  onsetCount: 0,
  sceneName: '',
  signals: { pulse: 0, downbeat: 0, inhale: 0, drop: 0 },
  downbeatCount: 0,
  seek: null as ((sec: number) => void) | null,
  directorMood: '',
};
(window as unknown as Record<string, unknown>).__personance = debugState;
(window as unknown as Record<string, unknown>).__resonance = debugState;

function idleFeatures(t: number): FrameFeatures {
  const breathe = 0.5 + 0.5 * Math.sin(t * 0.4);
  return {
    time: t,
    level: 0.12 + breathe * 0.05,
    bass: 0.1 + breathe * 0.08,
    mid: 0.1,
    treble: 0.08 + (1 - breathe) * 0.05,
    centroid: 0.4,
    onset: false,
    downbeat: false,
    beatPhase: null,
    nextBeatIn: null,
    energyPercentile: null,
    section: null,
    nextSectionIn: null,
    nextSectionEnergy: null,
    spectrum: IDLE_SPECTRUM,
  };
}

async function boot(): Promise<void> {
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  await renderer.init();
  app.appendChild(renderer.domElement);

  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  const backendLabel = isWebGPU ? 'WebGPU' : 'WebGL2';
  backendTag.textContent = backendLabel;
  setStatus('');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#050510');
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(0, 0, 22);

  const ctx: SceneContext = { renderer, scene, camera };
  const manager = new SceneManager();
  await manager.init(ctx, [
    new FerrofluidBlob(),
    new LavaLamp(),
    new ParticleField(),
    new Terrain(),
    new Fractal(),
    new Physarum(),
    new Attractor(),
    new Kifs(),
    new BlackHole(),
    new Boids(),
  ]);
  debugState.sceneName = manager.active.name;
  const post = new PostStack(renderer, scene, camera);
  const panel = new DevPanel(manager);
  let trackName = '';
  let directorToken = 0;

  // Scene UI Synchronizer
  function syncSceneButtons(activeIdx: number): void {
    sceneButtons.forEach((btn, idx) => {
      btn.classList.toggle('active', idx === activeIdx);
    });
  }
  syncSceneButtons(0);

  sceneButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-scene'));
      if (!Number.isNaN(idx)) {
        manager.switchTo(idx, { manual: true });
        syncSceneButtons(idx);
        toast(`Scene ${idx + 1}: ${manager.sceneNames[idx]}`);
      }
    });
  });

  const prevOnSceneChanged = manager.onSceneChanged;
  manager.onSceneChanged = (sc) => {
    prevOnSceneChanged?.(sc);
    syncSceneButtons(manager.activeIndexValue);
  };

  const prevOnAutoRotateChanged = manager.onAutoRotateChanged;
  manager.onAutoRotateChanged = (on) => {
    prevOnAutoRotateChanged?.(on);
    autoSceneBtn.classList.toggle('active', on);
  };

  autoSceneBtn.addEventListener('click', () => {
    const nextState = !manager.autoRotate;
    manager.setAutoRotate(nextState);
    autoSceneBtn.classList.toggle('active', nextState);
    toast(`Auto Scene: ${nextState ? 'ON' : 'OFF'}`);
  });

  function updateTrackDetails(name: string, analysis?: SongAnalysis | null): void {
    dockTrackTitle.textContent = name || 'Ожидание аудио…';
    if (analysis) {
      badgeBpm.textContent = `${analysis.tempo.bpm.toFixed(1)} BPM`;
    } else {
      badgeBpm.textContent = live?.isPlaying ? 'LIVE' : '';
    }
  }

  // Playlist Manager & UI Setup
  const playlistManager = new PlaylistManager();
  const playlistUI = new PlaylistUI(playlistManager, (track) => {
    void playPlaylistTrack(track);
  });

  // Set initial rotating round cover backdrop & interface palette
  const initialCover = generateVinylCover('Adventures — A Himitsu', 'A Himitsu');
  dockCoverArt.style.backgroundImage = `url("${initialCover}")`;
  applyInterfacePalette({
    background: '#0a0a18',
    primary: '#8a7cff',
    secondary: '#4ce0d2',
    accent: '#b8adff',
    swatches: ['#8a7cff', '#4ce0d2', '#b8adff'],
    coverArtUrl: initialCover,
  });

  function populateSectionMarkers(analysis: SongAnalysis): void {
    timelineSections.innerHTML = '';
    if (!analysis.sections || analysis.sections.length === 0 || !analysis.durationSec) return;
    const dur = analysis.durationSec;
    for (const sec of analysis.sections) {
      if (sec.startSec <= 0) continue;
      const mark = document.createElement('div');
      mark.className = 'section-mark';
      mark.style.left = `${(sec.startSec / dur) * 100}%`;
      const alpha = 0.2 + sec.energy * 0.5;
      mark.style.backgroundColor = `rgba(255, 255, 255, ${alpha.toFixed(2)})`;
      timelineSections.appendChild(mark);
    }
  }

  async function maybeRunDirector(analysis: SongAnalysis): Promise<void> {
    const { apiKey, enabled, model } = panel.director;
    if (!enabled || !apiKey) return;
    const token = ++directorToken;
    panel.setDirectorStatus('thinking…');
    try {
      const plan = await requestDirectorPlan(analysis, trackName, manager.sceneSpecs, {
        apiKey,
        model,
      });
      if (token !== directorToken) return;
      manager.applyDirectorPlan(plan);
      debugState.directorMood = plan.mood;
      const tok = plan.usage ? ` · ${plan.usage.input}→${plan.usage.output} tok` : '';
      panel.setDirectorStatus(`✓ ${plan.mood}${tok}`);
      panel.setDirectorPlan(plan);
    } catch (err) {
      if (token === directorToken) {
        panel.setDirectorStatus(`error: ${err instanceof Error ? err.message.slice(0, 60) : err}`);
      }
    }
  }

  let player: FilePlayer | null = null;
  let live: LiveProvider | null = null;
  let uiLoading = false;

  async function toggleLive(source: LiveSource): Promise<void> {
    if (live?.isPlaying) {
      live.stop();
      trackName = '';
      setStatus('');
      updateTrackDetails('');
      toast('Live audio capture stopped');
      return;
    }
    try {
      player?.pause();
      live ??= new LiveProvider();
      await live.start(source);
      trackName = source === 'display' ? 'Live · System Audio' : 'Live · Microphone';
      document.title = `Personance — ${trackName}`;
      setStatus('');
      updateTrackDetails(trackName);
      toast(`Capturing: ${trackName}`);
    } catch (err) {
      setStatus(`Capture failed: ${err instanceof Error ? err.message : err}`);
      toast(`Capture failed: ${err instanceof Error ? err.message : err}`, 4000);
    }
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  let currentTrackId: string | null = 'demo-track-adventures';

  function handleTrackEnded(): void {
    const next = playlistManager.getNextTrack();
    if (next) {
      void playPlaylistTrack(next);
      toast(`Следующий трек: ${next.title}`);
    } else {
      dockCoverDisc.classList.remove('is-playing');
      toast('Конец плейлиста');
    }
  }

  async function playPlaylistTrack(track: PlaylistTrack): Promise<void> {
    currentTrackId = track.id;
    playlistManager.setCurrentTrackId(track.id);
    playlistUI.render();

    if (track.coverArtUrl) {
      dockCoverArt.style.backgroundImage = `url("${track.coverArtUrl}")`;
    }

    if (track.sourceType === 'demo') {
      await loadDemo(track.id);
    } else if (track.file) {
      await loadFile(track.file, track.id);
    } else {
      const storedFile = await playlistManager.getOrFetchFile(track.id);
      if (storedFile) {
        track.file = storedFile;
        await loadFile(storedFile, track.id);
      } else {
        toast(`Загрузка «${track.title}»…`);
        playlistUI.render();
      }
    }
  }

  async function loadFile(file: File, trackId?: string): Promise<void> {
    const name = file.name.replace(/\.[^.]+$/, '');
    toast(`♪ ${name}`, 4000);
    uiLoading = true;
    setStatus(`Decoding ${file.name}…`);
    player?.pause();
    try {
      const bytes = await file.arrayBuffer();
      const hash = await sha256Hex(bytes);
      const t0 = performance.now();
      let analysis = await getCachedAnalysis(hash);
      debugState.analysisCached = analysis !== null;

      // Extract fresh embedded palette & cover art from audio bytes
      let palette: Palette | null = await extractPalette(bytes);
      if (!palette && analysis?.palette) {
        palette = analysis.palette;
      }
      if (palette && !palette.coverArtUrl && trackId) {
        const cur = playlistManager.getTrackById(trackId);
        if (cur?.coverArtUrl) {
          palette.coverArtUrl = cur.coverArtUrl;
        }
      }

      player ??= new FilePlayer();
      player.onEnded = handleTrackEnded;
      (debugState as Record<string, unknown>).player = player;
      const audioBuffer = await player.load(bytes);

      if (!analysis) {
        progressWrap.classList.add('visible');
        const stageBase: Record<string, number> = { decoding: 0, curves: 5, beats: 75, sections: 90, palette: 96 };
        analysis = await analyzeInWorker(
          audioBuffer,
          hash,
          (p) => {
            const pct = 'pct' in p ? p.pct : 0;
            if (p.stage === 'model' || p.stage === 'infer') {
              const label = p.stage === 'model' ? 'Downloading beat model' : 'Neural beats tracking';
              setStatus(`${label} — ${Math.round(pct * 100)}%`);
              return;
            }
            const base = stageBase[p.stage] ?? 0;
            const span = p.stage === 'curves' ? 70 : 8;
            progressBar.style.width = `${Math.min(99, base + pct * span)}%`;
            setStatus(`Analyzing — ${p.stage}`);
          },
          (refined) => {
            refined.palette = palette ? { ...palette, coverArtUrl: null } : null;
            player?.attachAnalysis(refined);
            debugState.analysis = refined;
            void cacheAnalysis(refined);
            panel.setAnalysis(trackName, refined);
            populateSectionMarkers(refined);
            setStatus('');
          },
        );
        progressBar.style.width = '100%';
        progressWrap.classList.remove('visible');
        analysis.palette = palette ? { ...palette, coverArtUrl: null } : null;
        await cacheAnalysis(analysis);
      }
      debugState.analysisMs = performance.now() - t0;
      debugState.analysis = analysis;
      player.attachAnalysis(analysis);
      manager.setIntensity(analysis.emotion?.arousal ?? 0.5);

      const effectivePalette =
        palette ?? (analysis.emotion ? emotionPalette(analysis.emotion) : null);
      if (effectivePalette) {
        manager.setBasePalette(effectivePalette);
        scene.background = new THREE.Color(effectivePalette.background);
        applyInterfacePalette(effectivePalette);
      }

      // Update rotating round vinyl cover artwork
      const coverUrl = palette?.coverArtUrl || generateVinylCover(name, 'Local Audio', effectivePalette);
      dockCoverArt.style.backgroundImage = `url("${coverUrl}")`;
      const targetId = trackId || currentTrackId;
      if (targetId) {
        playlistManager.updateTrackCover(targetId, coverUrl);
        playlistUI.renderTracks();
      }

      populateSectionMarkers(analysis);
      await player.play();
      debugState.seek = (sec: number) => player?.seek(sec);
      setStatus('');
      trackName = name;
      document.title = `Personance — ${trackName}`;
      updateTrackDetails(trackName, analysis);
      panel.setAnalysis(trackName, analysis);
      manager.clearDirectorPlan();
      void maybeRunDirector(analysis);
    } catch (err) {
      setStatus(`Failed to load: ${err instanceof Error ? err.message : err}`);
      console.error(err);
      toast(`Load failed: ${err instanceof Error ? err.message : err}`, 4000);
    } finally {
      uiLoading = false;
    }
  }

  async function loadDemo(trackId?: string): Promise<void> {
    try {
      setStatus('Fetching demo…');
      const [analysisRes, mp3Res] = await Promise.all([
        fetch('presets/adventures.analysis.json'),
        fetch('presets/adventures.mp3'),
      ]);
      if (analysisRes.ok) {
        const raw = (await analysisRes.json()) as SongAnalysis & {
          curves: Record<string, number[] | number>;
        };
        if (raw.version === SONG_ANALYSIS_VERSION) {
          for (const k of ['energy', 'bass', 'mid', 'treble', 'centroid', 'flux'] as const) {
            raw.curves[k] = new Float32Array(raw.curves[k] as unknown as number[]) as never;
          }
          await cacheAnalysis(raw as SongAnalysis);
        }
      }
      const demoCover = generateVinylCover('Adventures — A Himitsu', 'A Himitsu');
      dockCoverArt.style.backgroundImage = `url("${demoCover}")`;
      applyInterfacePalette({
        background: '#0a0a18',
        primary: '#8a7cff',
        secondary: '#4ce0d2',
        accent: '#b8adff',
        swatches: ['#8a7cff', '#4ce0d2', '#b8adff'],
        coverArtUrl: demoCover,
      });
      if (trackId) {
        playlistManager.updateTrackCover(trackId, demoCover);
      }
      const blob = await mp3Res.blob();
      await loadFile(new File([blob], 'Adventures — A Himitsu.mp3', { type: 'audio/mpeg' }), trackId);
    } catch (err) {
      setStatus(`Demo failed: ${err instanceof Error ? err.message : err}`);
      toast(`Demo failed: ${err instanceof Error ? err.message : err}`, 4000);
    }
  }

  // Action Buttons
  document.getElementById('demo-btn')?.addEventListener('click', () => {
    const demoTrack = playlistManager.getActivePlaylist().tracks.find((t) => t.sourceType === 'demo');
    if (demoTrack) {
      void playPlaylistTrack(demoTrack);
    } else {
      void loadDemo();
    }
  });
  liveMicBtn.addEventListener('click', () => void toggleLive('mic'));
  liveSysBtn.addEventListener('click', () => void toggleLive('display'));

  // Hidden File Picker
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*';
  input.multiple = true;
  input.id = 'file-input';
  input.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(input);
  input.addEventListener('change', async () => {
    if (input.files && input.files.length > 0) {
      const newTracks = await playlistManager.addFiles(input.files);
      playlistUI.render();
      if (newTracks[0]) void playPlaylistTrack(newTracks[0]);
    }
  });

  openFileBtn.addEventListener('click', () => input.click());
  openFileNavBtn.addEventListener('click', () => input.click());

  // Drag & drop audio files (auto-adds to playlist and plays!)
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.body.classList.add('dragging');
  });
  window.addEventListener('dragleave', () => document.body.classList.remove('dragging'));
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    document.body.classList.remove('dragging');
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const newTracks = await playlistManager.addFiles(files);
      playlistUI.render();
      if (newTracks[0]) void playPlaylistTrack(newTracks[0]);
    }
  });

  // Dock Play / Pause Button
  dockPlayBtn.addEventListener('click', () => {
    if (player) {
      void player.toggle();
    } else if (live?.isPlaying) {
      live.stop();
      trackName = '';
      updateTrackDetails('');
    } else {
      const cur = playlistManager.getCurrentTrack() || playlistManager.getActivePlaylist().tracks[0];
      if (cur) {
        void playPlaylistTrack(cur);
      } else {
        void loadDemo();
      }
    }
  });

  // Dock Next Track Button
  dockNextBtn.addEventListener('click', () => {
    const next = playlistManager.getNextTrack();
    if (next) {
      void playPlaylistTrack(next);
      toast(`Следующий: ${next.title}`);
    } else {
      toast('Конец плейлиста');
    }
  });

  // Dock Previous Track Button
  dockPrevBtn.addEventListener('click', () => {
    const prev = playlistManager.getPrevTrack();
    if (prev) {
      void playPlaylistTrack(prev);
      toast(`Предыдущий: ${prev.title}`);
    }
  });

  // Interactive Timeline Scrubber
  let isSeeking = false;
  function handleTimelineSeek(e: MouseEvent): void {
    if (!player || !player.duration) return;
    const rect = timelineContainer.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetSec = pct * player.duration;
    player.seek(targetSec);
    timelineFill.style.width = `${pct * 100}%`;
    timelineThumb.style.left = `${pct * 100}%`;
    timeCurrent.textContent = formatTime(targetSec);
  }

  timelineContainer.addEventListener('mousedown', (e) => {
    isSeeking = true;
    handleTimelineSeek(e);
  });
  window.addEventListener('mousemove', (e) => {
    if (isSeeking) handleTimelineSeek(e);
  });
  window.addEventListener('mouseup', () => {
    isSeeking = false;
  });

  // Volume Slider & Mute
  let lastVolume = 1;
  function updateVolIcons(v: number): void {
    volIcon.style.display = v > 0 ? '' : 'none';
    volMutedIcon.style.display = v > 0 ? 'none' : '';
  }
  volSlider.addEventListener('input', () => {
    const v = parseFloat(volSlider.value);
    player?.setVolume(v);
    updateVolIcons(v);
    if (v > 0) lastVolume = v;
  });
  volMuteBtn.addEventListener('click', () => {
    if (!player) return;
    if (player.volume > 0) {
      lastVolume = player.volume;
      player.setVolume(0);
      volSlider.value = '0';
    } else {
      const restore = lastVolume || 1;
      player.setVolume(restore);
      volSlider.value = String(restore);
    }
    updateVolIcons(player.volume);
  });

  // Top Tools & Modals
  devPanelBtn.addEventListener('click', () => {
    const isOpen = panel.toggle();
    toast(isOpen ? 'Parameter Tuning Panel Open' : 'Tuning Panel Closed');
  });
  const hudOpenHelpBtn = document.getElementById('hud-open-help-btn');
  hudOpenHelpBtn?.addEventListener('click', () => shortcutsModal.classList.add('open'));
  helpBtn.addEventListener('click', () => shortcutsModal.classList.add('open'));
  modalCloseBtn.addEventListener('click', () => shortcutsModal.classList.remove('open'));
  shortcutsModal.addEventListener('click', (e) => {
    if (e.target === shortcutsModal) shortcutsModal.classList.remove('open');
  });
  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });
  cinemaBtn?.addEventListener('click', () => {
    const isCinema = document.body.classList.toggle('cinema-mode');
    toast(isCinema ? 'Cinema Mode: Press H to restore' : 'Controls Restored');
  });

  // Auto-hide controls when idle during playback
  let hideTimer = 0;
  function resetControlsTimer(): void {
    document.body.classList.remove('controls-hidden');
    clearTimeout(hideTimer);
    const active = (live?.isPlaying ?? false) || (player?.isPlaying ?? false);
    if (active && !uiLoading) {
      hideTimer = window.setTimeout(() => {
        document.body.classList.add('controls-hidden');
      }, 4000);
    }
  }
  window.addEventListener('mousemove', resetControlsTimer);
  window.addEventListener('mousedown', resetControlsTimer);
  window.addEventListener('touchstart', resetControlsTimer);
  window.addEventListener('keydown', resetControlsTimer);

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (e.key === 'o' || e.key === 'O') input.click();
    if (e.key === 'l' || e.key === 'L') void toggleLive('display');
    if (e.key === 'm' || e.key === 'M') void toggleLive('mic');
    if (e.key === 'f' || e.key === 'F') {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
      else document.exitFullscreen().catch(() => {});
    }
    if (e.key === 'h' || e.key === 'H') {
      document.body.classList.toggle('cinema-mode');
    }

    // N or ]: Next track
    if (e.key === 'n' || e.key === 'N' || e.key === ']' || e.key === 'т' || e.key === 'Т' || e.key === 'ъ') {
      const next = playlistManager.getNextTrack();
      if (next) {
        void playPlaylistTrack(next);
        toast(`Следующий: ${next.title}`);
      } else {
        toast('Конец плейлиста');
      }
    }

    // P or [: Previous track
    if (e.key === 'p' || e.key === 'P' || e.key === '[' || e.key === 'з' || e.key === 'З' || e.key === 'х') {
      const prev = playlistManager.getPrevTrack();
      if (prev) {
        void playPlaylistTrack(prev);
        toast(`Предыдущий: ${prev.title}`);
      }
    }

    // Q: Toggle playlist modal
    if (e.key === 'q' || e.key === 'Q' || e.key === 'й' || e.key === 'Й') {
      playlistUI.toggle();
    }

    // A: Previous Scene (Left)
    if (e.code === 'KeyA' || e.key === 'a' || e.key === 'A' || e.key === 'ф' || e.key === 'Ф') {
      const total = manager.sceneNames.length;
      const prevIdx = (manager.activeIndexValue - 1 + total) % total;
      manager.switchTo(prevIdx, { manual: true });
      syncSceneButtons(prevIdx);
      toast(`Сцена [ ◀ A ]: ${manager.sceneNames[prevIdx]}`);
    }

    // D: Next Scene (Right)
    if (e.code === 'KeyD' || e.key === 'd' || e.key === 'D' || e.key === 'в' || e.key === 'В') {
      const total = manager.sceneNames.length;
      const nextIdx = (manager.activeIndexValue + 1) % total;
      manager.switchTo(nextIdx, { manual: true });
      syncSceneButtons(nextIdx);
      toast(`Сцена [ D ▶ ]: ${manager.sceneNames[nextIdx]}`);
    }

    // 0: Toggle Auto-Rotate
    if (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') {
      const next = !manager.autoRotate;
      manager.setAutoRotate(next);
      autoSceneBtn.classList.toggle('active', next);
      toast(`Авто-ротация сцен: ${next ? 'ВКЛ' : 'ВЫКЛ'}`);
    }
    if (e.code === 'Backquote' || e.key === '`' || e.key === 'ё' || e.key === 'Ё' || e.key === '~') {
      e.preventDefault();
      const isOpen = panel.toggle();
      toast(isOpen ? 'Панель параметров [ ` ]: Открыта' : 'Панель параметров [ ` ]: Закрыта');
    }
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      shortcutsModal.classList.toggle('open');
    }
    if (e.key === 'Escape') {
      shortcutsModal.classList.remove('open');
      document.body.classList.remove('cinema-mode');
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (player) {
        void player.toggle();
      } else if (!live?.isPlaying) {
        void loadDemo();
      }
    }
    if (e.key === 'ArrowLeft' && player) {
      player.seek(Math.max(0, player.currentTime - 5));
      toast('Seek -5s');
    }
    if (e.key === 'ArrowRight' && player) {
      player.seek(Math.min(player.duration, player.currentTime + 5));
      toast('Seek +5s');
    }
    if (e.key === 'ArrowUp' && player) {
      const v = Math.min(1, player.volume + 0.1);
      player.setVolume(v);
      volSlider.value = String(v);
      updateVolIcons(v);
      toast(`Volume: ${Math.round(v * 100)}%`);
    }
    if (e.key === 'ArrowDown' && player) {
      const v = Math.max(0, player.volume - 0.1);
      player.setVolume(v);
      volSlider.value = String(v);
      updateVolIcons(v);
      toast(`Volume: ${Math.round(v * 100)}%`);
    }
  });

  let last = performance.now();
  let elapsed = 0;
  let cameraPunch = 0;
  let attractTimer = 0;
  let fpsSmooth = 60;

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    elapsed += dt;
    const features = live?.isPlaying
      ? live.frame()
      : player?.isPlaying
        ? player.frame()
        : idleFeatures(elapsed);
    manager.update(features, dt);
    debugState.features = features;
    if (features.onset) debugState.onsetCount++;
    if (features.downbeat) debugState.downbeatCount++;
    debugState.playing = player?.isPlaying ?? false;
    debugState.time = player?.currentTime ?? 0;
    debugState.frames++;
    debugState.sceneName = manager.active.name;

    // Attract mode: before any track loads, tour the scene gallery.
    if (!trackName && !uiLoading) {
      attractTimer += dt;
      if (attractTimer > 22) {
        attractTimer = 0;
        const nextIdx = (manager.activeIndexValue + 1) % manager.sceneNames.length;
        manager.switchTo(nextIdx);
        syncSceneButtons(nextIdx);
      }
    } else {
      attractTimer = 0;
    }

    // Downbeat camera punch: quick push-in, eased release.
    if (features.downbeat) cameraPunch = 1;
    cameraPunch *= Math.exp(-dt * 3.2);
    if (!manager.updateCamera(camera, elapsed, features)) {
      const t = elapsed * 0.04;
      const radius = 22 - features.level * 4 - cameraPunch * 1.6;
      camera.position.set(Math.sin(t) * radius, Math.sin(t * 0.7) * 3, Math.cos(t) * radius);
      camera.lookAt(0, 0, 0);
    }

    const bg = manager.paletteBackground;
    if (bg) (scene.background as THREE.Color).copy(bg);
    post.update(features, dt, manager.signals);
    debugState.signals = manager.signals;

    // HUD visibility: visible while loading or idle/paused.
    const active = (live?.isPlaying ?? false) || (player?.isPlaying ?? false);
    hud.classList.toggle('hidden', active && !uiLoading);

    // Update Dock Play/Pause icon & Rotating Vinyl Cover Disc
    playIcon.style.display = active ? 'none' : '';
    pauseIcon.style.display = active ? '' : 'none';
    dockCoverDisc.classList.toggle('is-playing', active);

    // Update Timeline & Time
    if (player && player.duration > 0) {
      const cur = player.currentTime;
      const dur = player.duration;
      if (!isSeeking) {
        const pct = Math.min(100, Math.max(0, (cur / dur) * 100));
        timelineFill.style.width = `${pct}%`;
        timelineThumb.style.left = `${pct}%`;
      }
      timeCurrent.textContent = formatTime(cur);
      timeDuration.textContent = formatTime(dur);
    } else if (live?.isPlaying) {
      timeCurrent.textContent = formatTime(debugState.time);
      timeDuration.textContent = 'LIVE';
      timelineFill.style.width = '100%';
    }

    fpsSmooth += (1 / Math.max(dt, 1e-4) - fpsSmooth) * 0.05;
    panel.update(fpsSmooth, manager.signals, dt);

    try {
      post.render();
    } catch {
      renderer.render(scene, camera);
    }
  });
}

function setStatus(msg: string): void {
  statusEl.textContent = msg;
}

void boot().catch((err) => {
  setStatus(`Boot failed: ${err instanceof Error ? err.message : err}`);
  console.error(err);
});
