# Real-Time Spectrum Analyzer

A web-based real-time spectrum analyzer for audio visualization.

## Features

- Real-time FFT spectrum analysis
- Logarithmic frequency scale (20 Hz - 20 kHz)
- Exponential Moving Average (EMA) smoothing
- Gradient-filled spectrum visualization
- Frequency markers at 100 Hz, 1 kHz, and 10 kHz
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

## Converting Audio Files

If you encounter issues with WAV files, you can convert them to MP3:

### Using the conversion script:

```bash
./convert_to_mp3.sh
```

This will convert `TEST AUDIO/D#m - 140BPM - Triple M v3.wav` to MP3 format.

### Manual conversion with ffmpeg:

```bash
ffmpeg -i "TEST AUDIO/D#m - 140BPM - Triple M v3.wav" -codec:a libmp3lame -qscale:a 2 "TEST AUDIO/D#m - 140BPM - Triple M v3.mp3"
```

### Installing ffmpeg:

**macOS:**
```bash
brew install ffmpeg
```

**Linux:**
```bash
sudo apt-get install ffmpeg  # Debian/Ubuntu
sudo yum install ffmpeg      # CentOS/RHEL
```

**Windows:**
Download from [ffmpeg.org](https://ffmpeg.org/download.html)

## Usage

1. Select an audio file from the dropdown
2. Click "Play" to start playback
3. Adjust the smoothing slider to control EMA smoothing (0-100%)
4. Watch the real-time spectrum visualization

## Browser Compatibility

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support (may require user interaction to start audio)

## Troubleshooting

### Audio not playing:
- Check browser console for errors
- Verify audio file path is correct
- Try converting WAV to MP3 if format errors occur
- Ensure file is accessible via HTTP server

### Spectrum not displaying:
- Check browser console for FFT data messages
- Verify audio is actually playing (not just loaded)
- Check that analyser node is connected properly

