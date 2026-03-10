# Real-Time Spectrum Analyzer

A browser-based real-time audio analysis tool for music production and sound design. Visualize spectral content, identify tonal balance, compare against reference tracks, and understand how sound evolves over time — all running client-side with the Web Audio API.

<img width="1223" height="1291" alt="Spectrum Analyzer Screenshot" src="https://github.com/user-attachments/assets/b223db0b-178c-4045-b412-64e0e585fba0" />

---

## Features

### Spectrum Analyzer
- Real-time FFT spectrum display with logarithmic frequency axis (20 Hz – 20 kHz)
- Adjustable FFT size (512 / 1024 / 2048 / 4096) for resolution vs. speed tradeoffs
- Configurable smoothing with exponential moving average (EMA)
- Peak hold with adjustable decay speed
- Gradient-filled spectrum curve with dB gridlines
- Frequency markers at standard positions (100 Hz, 1 kHz, 10 kHz)
- Responsive canvas resizing

### Spectral Insights
- **Band Energy Summary** — relative energy across six mixing bands: Sub, Bass, Low Mid, Mid, High Mid, Air
- **Spectral Centroid / Brightness** — tracks the "center of mass" of the frequency spectrum with a visual indicator
- **Tonal Character** — automatic descriptors like "sub-heavy," "mid-forward," "bright," or "dark"
- **Peak Detection** — identifies dominant resonances with frequency and magnitude labels

### Spectrogram
- Scrolling time × frequency heatmap showing spectral evolution over time
- Perceptual color mapping (black → blue → teal → orange → white)
- Centroid trace overlay (violet) and level trace (cyan)
- Logarithmic frequency axis matching the main analyzer

### Reference Comparison (Spectral Envelope)
- **Save Reference** captures a spectral envelope from the last ~5 seconds of audio
- Envelope is a per-frequency confidence band (10th / 50th / 90th percentile), not a single frozen curve
- Shaded rose band shows the reference track's spectral range; live spectrum renders on top
- **Exceedance highlighting** — yellow where live signal exceeds the reference envelope, indigo where it falls below
- Brightness and tonal character comparison summary
- References persist in localStorage across sessions
- Backward-compatible with older single-frame snapshots (renders as a dashed curve)

### Multi-Band Vectorscope
- Four frequency-banded stereo vectorscopes: Sub (< 120 Hz), Lows (120–250 Hz), Mids (250 Hz – 2.5 kHz), Highs (> 2.5 kHz)
- Reveals stereo width and phase behavior per frequency range

### Oscilloscope
- Time-domain waveform display with frequency-based color mapping
- Adjustable view length (1 / 4 / 8 bars)
- Mono sum mode for phase checking

---

## Setup

1. Start a local web server:
   ```bash
   python3 -m http.server 8000 2>/dev/null
   ```

2. Open in browser:
   ```
   http://localhost:8000
   ```

---

## Architecture

```
main.js            Entry point — audio pipeline, render loop, UI wiring
insights.js        Pure functions: band energies, centroid, peak detection, tonal descriptors
spectrogram.js     SpectrogramBuffer (ring buffer), color mapping, spectrogram renderer
snapshot.js        Reference snapshots: envelope computation, serialization, localStorage CRUD
index.html         Layout and controls (Tailwind CSS)
```

**Key design decisions:**
- Audio analysis pipeline is separated from UI rendering
- Derived metrics (centroid, bands, peaks) are computed as pure functions at a throttled rate (~10 Hz), decoupled from the 60fps render loop
- Spectrogram uses a bounded ring buffer to prevent memory growth
- Snapshot envelope captures percentile statistics across hundreds of FFT frames, giving a true spectral range rather than a single frozen moment

---

## Browser Compatibility

| Browser        | Support |
|----------------|---------|
| Chrome / Edge  | Full    |
| Firefox        | Full    |
| Safari         | Full (may require user interaction to start audio) |

---

## Audio Format Support

- **MP3**: Fully supported
- **WAV**: May have compatibility issues in some browsers (on the backlog)

---

## Troubleshooting

**Audio not playing:**
- Check browser console for errors
- Verify audio file path is correct
- Use MP3 format for best compatibility
- Ensure file is accessible via HTTP server

**Spectrum not displaying:**
- Verify audio is actually playing (not just loaded)
- Check that analyser node is connected properly
- Check browser console for FFT data messages
