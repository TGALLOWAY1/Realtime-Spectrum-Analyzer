# BACKLOG – Real-Time Spectrum Analyzer (RTA)
This backlog covers all tasks for building a single-page, real-time spectrum analyzer. 
---

## 🟦 CORE PROJECT SETUP

### 1. ✅ Create project scaffolding
- ✅ Add `index.html`
- ✅ Add `/TEST AUDIO/` directory
- ✅ Add test audio file (D#m - 140BPM - Triple M v3.wav and .mp3)
- ✅ Load Tailwind via CDN
- ✅ Externalized JavaScript to `main.js` (module system)

### 2. ✅ Create basic UI layout
- ✅ Add a `<canvas id="rta-canvas">` with responsive sizing
- ✅ Add controls section:
  - ✅ Audio source dropdown with test audio options
  - ✅ Play/Pause button for test audio
  - ✅ EMA smoothing slider (0-100%) with live value display
- ✅ Clean, minimal layout using Tailwind CSS

---

## 🟩 TEST AUDIO PIPELINE (Build This First)

### 3. ✅ Implement test audio file player (Primary Source)
- ✅ Create `<audio>` element for playback
- ✅ Use `MediaElementAudioSourceNode`
- ✅ Connect audio → analyser node
- ✅ Play/Pause functionality with proper state management
- ✅ Audio switching logic based on dropdown
- ✅ Graceful cleanup when switching files
- ✅ Error handling for audio loading (format issues, network errors)
- ✅ Automatic MP3 fallback if WAV fails
- ✅ URL encoding for filenames with special characters

### 4. ✅ Implement analyser + FFT configuration
- ✅ Create shared `AudioContext` with proper state management
- ✅ Create `AnalyserNode` with `fftSize = 2048`
- ✅ Create Float32Arrays for:
  - ✅ Raw FFT data (`fftData`)
  - ✅ Smoothed values (`smoothedData`)
- ✅ AudioContext resume/suspend logic for proper audio flow

### 5. ✅ Implement FFT data extraction loop
- ✅ `getFloatFrequencyData(fftArray)` in animation loop
- ✅ Proper handling of `-Infinity` values (silence)
- ✅ Data validation and debugging logs

---

## 🟧 DSP IMPLEMENTATION (Using Test Audio Only)

### 6. ✅ Implement log-frequency mapping (20 Hz → 20 kHz)
- ✅ Write `binFrequency(i, sampleRate, binCount)`
- ✅ Write `frequencyToX(freq, width)` with log10-based mapping
- ✅ Log10-based mapping between MIN_FREQ (20 Hz) and MAX_FREQ (20 kHz)
- ✅ Pre-computed bin frequencies for efficiency

### 7. ✅ Implement dB → Y mapping
- ✅ MIN_DB = -100 dB, MAX_DB = 0 dB (full scale)
- ✅ Implement `dbToY(db, height)` with proper `-Infinity` handling
- ✅ Inverted Y-axis mapping (0 dB at top, -100 dB at bottom)

### 8. ✅ Implement Exponential Moving Average (EMA)
- ✅ Persistent `smoothedData[]` array
- ✅ Function `updateEMA(fftData, smoothed, alpha)` with `-Infinity` handling
- ✅ Slider controls alpha (mapped to 0.1-0.95 range for noticeable effects)
- ✅ EMA initialization on first frame

---

## 🟨 CANVAS RENDERING (Test Audio Only)

### 9. ✅ Render the amplitude curve
- ✅ Connect bin → frequency → X position
- ✅ Map dB → Y with proper clamping
- ✅ Stroke the line with 2px width
- ✅ Smooth path drawing with proper point filtering

### 10. ✅ Render gradient energy fill
- ✅ Build a gradient (blue → purple → red)
- ✅ Fill the path under the curve
- ✅ Gradient respects canvas padding

### 11. ✅ Add frequency markers
- ✅ Vertical lines + labels at:
  - ✅ 100 Hz
  - ✅ 1 kHz
  - ✅ 10 kHz
- ✅ Labels with background for readability
- ✅ Lines drawn only in drawing area (respecting padding)

### 12. ✅ Finalize visual style
- ✅ Dark background (gray-950)
- ✅ Clear canvas per frame
- ✅ Crisp text for markers
- ✅ Added dB scale markers on vertical axis (0 dB to -100 dB)
- ✅ Canvas padding to prevent label cutoff (top: 20px, left: 60px, bottom: 10px, right: 10px)

## 🟪 DEPLOYMENT

### 15. ⏳ Add README.md
- Overview of tool
- Explanation of DSP choices (log scale, EMA, dB)
- Instructions for adding test audio to `/TEST AUDIO`
- Notes on browser permissions for microphone

### 16. ⏳ Deploy to GitHub Pages or Vercel
- Ensure audio files load via static hosting

---

## 🟫 OPTIONAL ENHANCEMENTS

### 17. ⏳ Smoothing presets (Fast / Medium / Slow)
### 18. ⏳ Peak-hold dots (slow decay)
### 19. ✅ Auto-resize canvas on window resize
- ✅ Responsive canvas that maintains aspect ratio
- ✅ Window resize event listener
- ✅ Canvas redraws on resize
