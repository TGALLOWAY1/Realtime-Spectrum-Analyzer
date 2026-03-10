# Real-Time Spectrum Analyzer

A browser-based real-time audio analysis tool for music production and sound design. Visualize spectral content, identify peaks and resonances, track tonal balance, compare against reference tracks, and understand how sound evolves over time — all running client-side with the Web Audio API.

**Zero dependencies. No build step. Pure vanilla JavaScript.**

<img width="1280" alt="Spectrum Analyzer Screenshot" src="https://github.com/user-attachments/assets/b223db0b-178c-4045-b412-64e0e585fba0" />

---

## Features

### Spectrum Analyzer
- Real-time FFT spectrum display with logarithmic frequency axis (20 Hz – 20 kHz)
- Adjustable FFT size (512 / 1024 / 2048 / 4096) for resolution vs. speed tradeoffs
- Configurable smoothing with exponential moving average (EMA)
- Peak hold with adjustable decay speed
- Gradient-filled spectrum curve with dB gridlines (-100 dB to 0 dB)
- Frequency markers at standard positions (100 Hz, 1 kHz, 10 kHz)
- Spectral centroid indicator overlaid on the graph
- Responsive canvas with device pixel ratio handling

### Spectral Insights
- **Band Energy Summary** — relative RMS energy across six mixing bands (Sub, Bass, Low Mid, Mid, High Mid, Air) with color-coded bar display and dB readout
- **Spectral Centroid / Brightness** — tracks the frequency "center of mass" with a visual Dark ↔ Bright slider and Hz readout
- **Tonal Character** — automatic descriptors (e.g. "Sub-heavy," "Bass-heavy," "Warm/Boxy," "Mid-forward," "Bright & Balanced")
- **Peak Detection** — identifies the top 5 dominant resonances with frequency and magnitude labels, using 6 dB prominence thresholding

### Spectrogram
- Scrolling time × frequency heatmap showing spectral evolution over time
- Perceptual color mapping (black → blue → teal → orange → white)
- Spectral centroid trace overlay (violet) and overall level trace (cyan)
- Logarithmic frequency axis matching the main analyzer
- Bounded ring buffer (600 frames) to prevent memory growth

### Reference Comparison (Spectral Envelope)
- **Save Reference** captures a spectral envelope from the last ~5 seconds of audio
- Envelope is a per-frequency confidence band (10th / 50th / 90th percentile), not a single frozen curve
- Shaded rose band shows the reference track's spectral range; live spectrum renders on top
- **Exceedance highlighting** — yellow where live signal exceeds the reference envelope, indigo where it falls below
- Real-time brightness delta and tonal character comparison summary
- References persist in localStorage across sessions
- Backward-compatible with older single-frame snapshots (renders as a dashed curve)

### Multi-Band Vectorscope
- Four frequency-banded stereo vectorscopes showing Lissajous curves:
  - **Sub** (< 120 Hz) — Indigo
  - **Lows** (120–250 Hz) — Blue
  - **Mids** (250 Hz – 2.5 kHz) — Teal
  - **Highs** (> 2.5 kHz) — Red
- Glowing border indicates phase correlation (green = coherent, red = phase-inverted)
- Reveals stereo width and phase behavior per frequency range

### Oscilloscope
- Time-domain waveform display with frequency-based color mapping (lows = purple/blue, mids = yellow/orange, highs = red/white)
- Adjustable view length (1 / 4 / 8 bars)
- Mono sum mode for phase checking
- Vertical dBFS amplitude axis

### Controls
- Play/Pause with included demo audio tracks
- Settings panel with FFT size, smoothing, peak decay, oscilloscope view length, and mono sum toggle
- Reference management: save, load, toggle overlay, delete

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Audio | Web Audio API (AnalyserNode, BiquadFilterNode, ChannelSplitterNode) |
| Rendering | Canvas 2D API at 60fps |
| Styling | Tailwind CSS (CDN) |
| Language | Vanilla ES6 JavaScript (no framework, no build step) |
| Server | Any static file server (Python, Node, etc.) |

---

## Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/TGALLOWAY1/Realtime-Spectrogram-Analyzer.git
   cd Realtime-Spectrogram-Analyzer
   ```

2. Start a local web server:
   ```bash
   python3 -m http.server 8000
   ```

3. Open in browser:
   ```
   http://localhost:8000
   ```

4. Click **Play** to start analysis with the included demo track.

---

## Architecture

```
main.js            Audio pipeline, animation loop, UI wiring, all canvas renderers
insights.js        Pure functions: band energies, centroid, peak detection, tonal descriptors
spectrogram.js     SpectrogramBuffer (ring buffer), perceptual color mapping, spectrogram renderer
snapshot.js        Spectral envelope computation, comparison deltas, localStorage serialization
index.html         Layout and controls (Tailwind CSS)
server.py          Simple Python HTTP server for local development
```

### Audio Pipeline

```
Audio Source
  → Stereo Splitter (L / R channels)
    → 4-band Crossover Filters (Sub / Low / Mid / High)
      → 8 AnalyserNodes (4 bands × 2 channels)
        → getFloatFrequencyData() / getFloatTimeDomainData()
```

### Key Design Decisions

- **Decoupled render rates** — FFT data and canvas rendering run at 60fps; derived metrics (centroid, band energy, peaks, tonal character) are computed at ~10 Hz to avoid unnecessary work
- **Bounded buffers** — spectrogram uses a ring buffer (600 frames) and waveform buffers are fixed-size to prevent memory growth
- **Pure metric functions** — all insight computations in `insights.js` are stateless and testable
- **Envelope over snapshot** — reference comparison captures percentile statistics across hundreds of FFT frames, giving a true spectral range rather than a single frozen moment
- **No framework** — vanilla JS for minimal overhead, full control over the render loop, and zero build complexity

---

## Browser Compatibility

| Browser        | Support |
|----------------|---------|
| Chrome / Edge  | Full    |
| Firefox        | Full    |
| Safari         | Full (may require user interaction to start audio) |

---

## Troubleshooting

**Audio not playing:**
- Check browser console for errors
- Verify audio file is accessible via HTTP server (not `file://`)
- Use MP3 format for best cross-browser compatibility

**Spectrum not displaying:**
- Verify audio is actually playing (not just loaded)
- Check that the AnalyserNode is connected properly in the console
- Try refreshing the page and clicking Play again
