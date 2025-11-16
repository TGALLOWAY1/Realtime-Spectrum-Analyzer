# Real-Time Spectrum Analyzer

A web-based real-time spectrum analyzer for audio visualization.

## Features

- Real-time FFT spectrum analysis
- Logarithmic frequency scale (20 Hz - 20 kHz)
- Exponential Moving Average (EMA) smoothing
- Gradient-filled spectrum visualization
- Frequency markers at 100 Hz, 1 kHz, and 10 kHz
- **Oscilloscope waveform visualization** with frequency-based color mapping
- **Advanced Spectral Energy Density Band Visualizer** with 17 logarithmically-spaced bands
  - Per-band RMS energy calculation
  - Customizable thresholds, decay rates, and color mapping
  - Peak hold indicators for each band
  - Decay system linked to global smoothing factor
- Responsive canvas resizing
- Test audio file support

## Setup

1. Start a local web server:
   ```bash
   python3 -m http.server 8000
   ```

2. Open in browser:
   ```
   http://localhost:8000
   ```

## Audio Format Support

- **MP3**: Fully supported and working
- **WAV**: Support is on the backlog (currently may have compatibility issues in some browsers)

## Usage

1. Select an audio file from the dropdown
2. Click "Play" to start playback
3. Adjust the smoothing slider to control EMA smoothing (0-100%)
   - This affects both the spectrogram and the energy density bands decay rates
4. Watch the real-time visualizations:
   - **Spectrogram**: Main frequency spectrum with logarithmic scale
   - **Energy Density Bands**: 17-band energy visualization with peak hold indicators
   - **Oscilloscope**: Time-domain waveform with frequency-based coloring
5. Adjust the view length dropdown to change the oscilloscope time window (1, 4, or 8 bars)

## Browser Compatibility

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support (may require user interaction to start audio)

## Troubleshooting

### Audio not playing:
- Check browser console for errors
- Verify audio file path is correct
- Use MP3 format (WAV support is on the backlog)
- Ensure file is accessible via HTTP server

### Spectrum not displaying:
- Check browser console for FFT data messages
- Verify audio is actually playing (not just loaded)
- Check that analyser node is connected properly

