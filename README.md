# Personance

A song-aware, real-time audio visualizer built on **Three.js WebGPU** and **TSL (Three.js Shading Language)** compute shaders.

Drop in any audio track and Personance *learns* it before playing — extracting a neural beat grid, section structure, energy arc, key/mode, emotional valence/arousal, and an OKLab-harmonized palette extracted from the album art. It then choreographs mathematical art to the music in real time: visuals inhale in the final bar before a drop and explode on impact.

---

## Highlights & Features

- **10 GPU-Accelerated Scenes**: Raymarched metaballs, strange attractors, black hole gravitational lensing, KIFS fractals, slime molds, 32k boids murmurations, and Rosensweig ferrofluid spikes.
- **Perturbation-Theory Deep Zoom (Beyond f32)**: Mandelbrot dive in the Fractal scene evaluates a 64-bit double-precision reference orbit on the CPU and integrates $\Delta_{n+1} = 2 Z_n \Delta_n + \Delta_n^2 + \delta_0$ on the GPU, achieving razor-sharp deep zoom down to **$10^{-12}$ and beyond** without single-precision float pixelation.
- **Perceptual OKLab Palette Interpolation**: Colors across the interface, Fractal, Ferrofluid, and Boids interpolate in Björn Ottosson's **OKLab & OKLCH** color spaces, eliminating desaturated muddy gray midpoints and brightness dips.
- **Client-Side Neural Beat Tracking**: Integrates the state-of-the-art [Beat This!](https://github.com/CPJKU/beat_this) (ISMIR 2024) ONNX model running locally via `onnxruntime-web` for downbeat and non-4/4 rhythm tracking.
- **Choreography Signals**: Built-in conductor maps song energy to `pulse` (per beat), `inhale` (anticipation ramp before loud sections), and `drop` (transient explosion).
- **Full Playlist Management**: Custom playlists, drag-and-drop file queues, IndexedDB audio caching, procedurally generated vinyl record sleeve art, shuffle, and repeat modes.
- **Live Audio Input**: Real-time microphone and tab/system loopback audio capture with real-time onset detection.
- **Optional LLM Director**: Connect your Anthropic API key to let Claude design section-by-section scene plans and dynamic conductor mappings tailored to the song's emotional arc.

---

## Visual Scenes (1–10)

1. **Ferrofluid** (`ferrofluid`)  
   A suspended 3D magnetic liquid blob with genuine Rosensweig instability spikes and obsidian chrome mirror reflections. Glancing angles display thin-film oil sheen iridescence with **OKLab spectral color dispersion**.

2. **Lava Lamp** (`lavalamp`)  
   Inside the warm, luminous core of a lava lamp. Raymarched metaball globules fuse, stretch, and undergo thermal convection driven by bass transients. Initial camera elevation set at $0.2$.

3. **Particles** (`particles`)  
   100,000 curl-noise flow-field particles bound within a breathing geometric shell, churning with the music's spectral flux.

4. **Terrain** (`terrain`)  
   Infinite ridged-FBM mountainous landscape with domain-warped scrolling, atmospheric depth fog, and beat-reactive wireframe terrain hulls.

5. **Fractal** (`fractal`)  
   Full-screen animated Julia set overview and Mandelbrot deep dive with **Perturbation Theory**. Pushes the zoom floor 8 orders of magnitude past standard $f32$ limits (down to $10^{-12}$). Filaments and contour glows flow through **OKLab perceptual ramps**.

6. **Physarum** (`physarum`)  
   200,000-agent Jeff Jones slime mold simulation. Agents deposit and follow chemoattractant trails in a ping-pong diffuse-and-decay compute pipeline, creating living neon vein networks.

7. **Attractor** (`attractor`)  
   150,000 particles evolving through strange-attractor phase spaces (Lorenz, Thomas, Aizawa, Halvorsen). Morphs smoothly between attractor families on section transitions.

8. **KIFS** (`kifs`)  
   Raymarched kaleidoscopic iterated function system (KIFS). Fold angles ride the song's spectral centroid, and drops kick rotational symmetries.

9. **Black Hole** (`blackhole`)  
   Relativistically raymarched Kerr black hole with gravitational lensing, photon sphere, and an accretion disk whose turbulence and flares surge with musical energy.

10. **Boids** (`boids`)  
    32,768-agent GPU murmuration flocking via counting-sort spatial grids. Flight speeds trigger **OKLab 3-stop perceptual color ramping** as panic waves scatter the flock on beat drops.

---

## Controls & Keyboard Shortcuts

| Key | Action |
| --- | --- |
| **Space** | Play / Pause |
| **A / D** | Previous / Next scene (or click scene 1–10 in the HUD bar) |
| **0** | Toggle auto-rotation on section changes (`Auto ↺`) |
| **Q** | Open / Close Playlist drawer |
| **N / ]** | Next track in playlist |
| **P / [** | Previous track in playlist |
| **← / →** | Seek $-5\text{s}$ / $+5\text{s}$ |
| **↑ / ↓** | Volume $\pm 10\%$ |
| **O** | Open audio file picker |
| **L** | Capture live tab / system audio |
| **M** | Capture live microphone input |
| **F** | Toggle Fullscreen |
| **H** | Cinema mode (toggle HUD visibility) |
| **`** (backtick) | Toggle Tweakpane dev panel |
| **?** | Shortcuts & info modal |
| **Esc** | Close active modals & drawers |

---

## Intelligence & Analysis Pipeline

1. **Classical DSP** (Web Worker, ~1.5–2s per song):  
   Calculates FFT feature curves, spectral flux onsets, autocorrelation tempo, phase-fitted beat grids, Foote novelty matrix section segmentation, and Krumhansl-Schmuckler key/mode detection (yielding valence & arousal estimates).
2. **Neural Beat Tracking** ([Beat This!](https://github.com/CPJKU/beat_this), ISMIR 2024):  
   Evaluates an ONNX transformer model locally on the WebGPU execution provider to detect downbeats and non-standard meters (such as 3/4 or odd time signatures), hot-swapping the refined grid mid-playback.
3. **OKLab / OKLCH Color Engine**:  
   Extracts vibrant swatches from ID3 cover art or synthesizes harmonic palettes in OKLCH. Palette transitions between song sections lerp through OKLab space to avoid muddy desaturation.
4. **LLM Director (Optional)**:  
   With an Anthropic API key provided in the dev panel, Claude reads song analysis metrics and crafts a bespoke scene progression plan and conductor curve configuration.

---

## Architecture

```
src/
├── analysis/         # Audio DSP, Beat This! ONNX integration, OKLab math & palette extraction
│   ├── oklab.ts      # CPU OKLab/OKLCH conversions, perceptual lighten/darken, CSS gradients
│   ├── oklab-tsl.ts  # WebGPU/TSL shader nodes for GPU perceptual color interpolation
│   └── palette.ts    # Emotion palette synthesis and dynamic UI styling
├── audio/            # Audio feature extraction bus, FilePlayer, and LiveProvider
├── conductor/        # Musical choreography engine, signal derivation, and LLM director
├── playlist/         # Playlist manager, IndexedDB track storage, and vinyl cover generator
├── post/             # Post-processing pipeline (bloom, chromatic aberration, trails)
├── scenes/           # 10 WebGPU visual scenes with typed parameter schemas
├── types/            # SongAnalysis and pipeline data contracts
└── ui/               # Tweakpane dev panel with live parameter tuning and scientific readouts
```

---

## Running Locally

```bash
# Install dependencies
npm install

# Start Vite dev server on port 3000
npm run dev

# Build production bundle with type checking
npm run build
```

Open `http://localhost:3000` in a WebGPU-capable browser (Chromium-based browsers recommended).
