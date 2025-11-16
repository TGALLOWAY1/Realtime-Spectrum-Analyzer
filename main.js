// Audio context and analyser (shared across all sources)
let audioContext = null;
let analyser = null;

// FFT data arrays
let fftData = null;
let smoothedData = null;
let frequencyBinCount = 0;

// Animation loop
let animationFrameId = null;
let isAnimating = false;

// Canvas setup - ensure DOM is ready
const canvas = document.getElementById('rta-canvas');
if (!canvas) {
    console.error('Canvas element not found!');
}
const ctx = canvas ? canvas.getContext('2d') : null;
const canvasContainer = canvas ? canvas.parentElement : null;

if (!ctx) {
    console.error('Could not get canvas 2D context!');
}

// Default aspect ratio (800x400 = 2:1)
const CANVAS_ASPECT_RATIO = 2;

// Current test audio state
let currentAudioElement = null;
let currentAudioSource = null;

// UI elements
const audioSourceSelect = document.getElementById('audio-source');
const playPauseBtn = document.getElementById('play-pause-btn');
const smoothingSlider = document.getElementById('smoothing-slider');
const smoothingValue = document.getElementById('smoothing-value');
const viewLengthSelect = document.getElementById('view-length');
const decaySpeedSlider = document.getElementById('decay-speed-slider');
const decaySpeedValue = document.getElementById('decay-speed-value');

// Hardcoded BPM
const HARDCODED_BPM = 140;

// Oscilloscope canvas setup
const oscilloscopeCanvas = document.getElementById('oscilloscope-canvas');
const oscilloscopeCtx = oscilloscopeCanvas ? oscilloscopeCanvas.getContext('2d') : null;
const oscilloscopeContainer = oscilloscopeCanvas ? oscilloscopeCanvas.parentElement : null;

// Oscilloscope state
let waveformBuffer = []; // Circular buffer for waveform samples
let waveformBufferSize = 0; // Maximum buffer size (calculated based on view duration)
let waveformWriteIndex = 0; // Current write position in buffer
let waveformSamplesPerPixel = 1; // How many samples per pixel (for downsampling)
const OSCILLOSCOPE_ASPECT_RATIO = 4; // 800x200 = 4:1

// Band Visualizer canvas setup
const bandVisualizerCanvas = document.getElementById('band-visualizer-canvas');
const bandVisualizerCtx = bandVisualizerCanvas ? bandVisualizerCanvas.getContext('2d') : null;
const bandVisualizerContainer = bandVisualizerCanvas ? bandVisualizerCanvas.parentElement : null;
const BAND_VISUALIZER_ASPECT_RATIO = 5.33; // 800x150 = 5.33:1

// Band Visualizer configuration
const BAND_COUNT = 17;
const BAND_MIN_FREQ = 20;
const BAND_MAX_FREQ = 20000;

/**
 * Generate logarithmically-spaced frequency bands
 * @param {number} count - Number of bands
 * @param {number} minFreq - Minimum frequency in Hz
 * @param {number} maxFreq - Maximum frequency in Hz
 * @returns {Array<{min: number, max: number, center: number}>} Array of band definitions
 */
function generateLogBands(count, minFreq, maxFreq) {
    const bands = [];
    const logMin = Math.log10(minFreq);
    const logMax = Math.log10(maxFreq);
    const logRange = logMax - logMin;
    const step = logRange / count;
    
    for (let i = 0; i < count; i++) {
        const logStart = logMin + i * step;
        const logEnd = logMin + (i + 1) * step;
        const startFreq = Math.pow(10, logStart);
        const endFreq = Math.pow(10, logEnd);
        const centerFreq = Math.pow(10, (logStart + logEnd) / 2);
        
        bands.push({
            min: startFreq,
            max: endFreq,
            center: centerFreq
        });
    }
    
    return bands;
}

// Initialize band definitions
let bandDefinitions = generateLogBands(BAND_COUNT, BAND_MIN_FREQ, BAND_MAX_FREQ);

/**
 * Compute bin indices for each band and ensure every band has at least one bin
 * Called after audio context is initialized
 */
function computeBandBinIndices() {
    if (!audioContext || !analyser || !frequencyBinCount) {
        return;
    }
    
    const sampleRate = audioContext.sampleRate;
    const fftSize = analyser.fftSize;
    const freqPerBin = sampleRate / fftSize;
    
    // Compute bin indices for each band
    for (let i = 0; i < bandDefinitions.length; i++) {
        const band = bandDefinitions[i];
        
        // Calculate start and end bin indices from frequencies
        // Formula: binIndex = (freq * fftSize) / sampleRate
        let startBin = Math.floor((band.min * fftSize) / sampleRate);
        let endBin = Math.ceil((band.max * fftSize) / sampleRate);
        
        // Clamp to valid bin range [0, frequencyBinCount)
        startBin = Math.max(0, Math.min(startBin, frequencyBinCount - 1));
        endBin = Math.max(0, Math.min(endBin, frequencyBinCount - 1));
        
        // Ensure endBin >= startBin (at least one bin)
        if (endBin < startBin) {
            endBin = startBin;
        }
        
        // Ensure every band has at least one bin
        // If the band has zero width (endBin === startBin), expand it
        if (endBin === startBin) {
            // Try to expand endBin if possible
            if (endBin < frequencyBinCount - 1) {
                endBin = startBin + 1;
            } else if (startBin > 0) {
                // If we're at the end, move startBin back
                startBin = endBin - 1;
            }
            // If we're at bin 0 and can't expand, keep it as is (at least one bin)
        }
        
        // Calculate bin count
        const binCount = endBin - startBin + 1;
        
        // Store bin indices and count
        band.startBin = startBin;
        band.endBin = endBin;
        band.binCount = binCount;
        
        // Also store minFreq and maxFreq for logging (using actual bin frequencies)
        band.minFreq = (startBin * sampleRate) / fftSize;
        band.maxFreq = (endBin * sampleRate) / fftSize;
    }
    
    // Log band information once
    console.log('Band bin mapping computed:', {
        sampleRate: sampleRate,
        fftSize: fftSize,
        frequencyBinCount: frequencyBinCount,
        freqPerBin: freqPerBin.toFixed(2) + ' Hz'
    });
    
    for (let i = 0; i < bandDefinitions.length; i++) {
        const band = bandDefinitions[i];
        console.log(`Band ${i}: minFreq=${band.min.toFixed(1)} Hz, maxFreq=${band.max.toFixed(1)} Hz, ` +
                   `startBin=${band.startBin}, endBin=${band.endBin}, binCount=${band.binCount}, ` +
                   `actualFreqRange=${band.minFreq.toFixed(1)}-${band.maxFreq.toFixed(1)} Hz`);
    }
}

// Per-band state: current energy, peak hold, and configuration
let bandStates = [];

/**
 * Initialize band states with default configuration
 */
function initializeBandStates() {
    bandStates = [];
    
    // Default color palette - gradient from blue (low) to red (high)
    const defaultColors = [
        '#3b82f6', // blue-500 (sub-bass)
        '#3b82f6', // blue-500
        '#3b82f6', // blue-500
        '#3b82f6', // blue-500
        '#60a5fa', // blue-400
        '#60a5fa', // blue-400
        '#818cf8', // indigo-400
        '#a78bfa', // violet-400
        '#c084fc', // purple-400
        '#d946ef', // fuchsia-500
        '#f472b6', // pink-400
        '#fb7185', // rose-400
        '#fb7185', // rose-400
        '#f87171', // red-400
        '#f87171', // red-400
        '#ef4444', // red-500
        '#ef4444'  // red-500 (highs)
    ];
    
    for (let i = 0; i < BAND_COUNT; i++) {
        const band = bandDefinitions[i];
        
        // Determine category
        let category;
        if (i < 3) {
            category = 'Sub-bass';
        } else if (i < 12) {
            category = 'Mids';
        } else {
            category = 'Highs';
        }
        
        // Updated thresholds: Sub-bass: -80, Mids: -75, Highs: -78
        let threshold;
        if (i < 3) {
            threshold = -80; // Sub-bass
        } else if (i < 12) {
            threshold = -75; // Mids
        } else {
            threshold = -78; // Highs
        }
        
        // Default decay multiplier: Sub-bass: 0.8x, Mids: 1.2x, Highs: 1.6x
        let decayMultiplier;
        if (i < 3) {
            decayMultiplier = 0.8; // Sub-bass
        } else if (i < 12) {
            decayMultiplier = 1.2; // Mids
        } else {
            decayMultiplier = 1.6; // Highs
        }
        
        bandStates.push({
            currentEnergy: -Infinity, // Current energy in dB (raw, before compensation)
            category: category,       // Category: 'Sub-bass' | 'Mids' | 'Highs'
            threshold: threshold,     // Threshold in dB
            decayMultiplier: decayMultiplier, // Multiplier for decay rate
            color: defaultColors[i] || '#3b82f6', // Band color
            peakHoldDecayRate: 0.9,   // Peak hold decay rate (90% retention per frame, faster decay)
            peakValue: 0,              // Normalized peak value [0, 1] for peak cap indicator
            instantValue: 0,           // Instant normalized value [0, 1] for main bar (no peak hold)
            // Screen geometry for hover detection
            screenX: 0,
            screenY: 0,
            screenWidth: 0,
            screenHeight: 0
        });
    }
}

// Initialize band states
initializeBandStates();

/**
 * Get category gain (tilt compensation) for frequency bands
 * @param {string} category - Band category: 'Sub-bass' | 'Mids' | 'Highs'
 * @returns {number} Gain in dB to apply
 */
function getCategoryGain(category) {
    switch (category) {
        case 'Sub-bass':
            return 0;   // no boost
        case 'Mids':
            return -2;  // small attenuation to avoid constant max
        case 'Highs':
            return 3;   // modest boost to keep highs visible
        default:
            return 0;
    }
}

// EMA smoothing alpha value (0-1, where lower = more smoothing, higher = less smoothing)
// Default: 0.5 (moderate smoothing)
let emaAlpha = 0.5;
let emaInitialized = false;

// Global decay speed multiplier for energy density bands
// 1.0 = current behavior, >1 = faster decay, <1 = slower decay
let globalDecaySpeed = 1.0;

// Frequency mapping constants
const MIN_FREQ = 20;    // 20 Hz
const MAX_FREQ = 20000; // 20 kHz

// dB mapping constants
// Web Audio API getFloatFrequencyData returns dB values from -Infinity to 0 dB (full scale)
// Some implementations may return slightly positive values, so we allow up to +6 dB for headroom
const MIN_DB = -100;    // Minimum dB value (silence threshold)
const MAX_DB = 0;        // Maximum dB value (full scale, 0 dB = maximum digital level)

// Energy density band dynamic range
// dB window above threshold for full scale (wider range = less pegging)
const ENERGY_DYNAMIC_RANGE_DB = 40; // dB window above threshold for full scale

// Canvas padding to prevent labels from being cut off
const CANVAS_PADDING_TOP = 20;    // Space for frequency markers at top
const CANVAS_PADDING_BOTTOM = 10; // Space at bottom
const CANVAS_PADDING_LEFT = 60;   // Space for dB labels on left
const CANVAS_PADDING_RIGHT = 10;  // Space on right

/**
 * Calculate the frequency for a given FFT bin index
 * @param {number} i - Bin index (0 to binCount-1)
 * @param {number} sampleRate - Audio sample rate (e.g., 44100 Hz)
 * @param {number} binCount - Total number of frequency bins
 * @returns {number} Frequency in Hz
 */
function binFrequency(i, sampleRate, binCount) {
    return (i * sampleRate) / (2 * binCount);
}

/**
 * Map a frequency to an X coordinate on the canvas using logarithmic scale
 * @param {number} freq - Frequency in Hz
 * @param {number} width - Canvas width in pixels
 * @returns {number} X coordinate (accounting for left padding)
 */
function frequencyToX(freq, width) {
    // Clamp frequency to valid range
    const clampedFreq = Math.max(MIN_FREQ, Math.min(MAX_FREQ, freq));
    
    // Log10 mapping: map frequency to 0-1 range using log scale
    const logMin = Math.log10(MIN_FREQ);
    const logMax = Math.log10(MAX_FREQ);
    const logFreq = Math.log10(clampedFreq);
    
    // Normalize to 0-1 range
    const normalized = (logFreq - logMin) / (logMax - logMin);
    
    // Map to drawing area (accounting for left and right padding)
    const drawingWidth = width - CANVAS_PADDING_LEFT - CANVAS_PADDING_RIGHT;
    return CANVAS_PADDING_LEFT + normalized * drawingWidth;
}

/**
 * Map a dB value to a Y coordinate on the canvas
 * @param {number} db - dB value (typically -100 to 0, or -Infinity for silence)
 * @param {number} height - Canvas height in pixels
 * @returns {number} Y coordinate (accounting for top and bottom padding)
 */
function dbToY(db, height) {
    // Handle -Infinity (silence) - map to bottom of drawing area
    if (!isFinite(db) || db === -Infinity) {
        return height - CANVAS_PADDING_BOTTOM;
    }
    
    // Clamp dB to valid range
    const clampedDb = Math.max(MIN_DB, Math.min(MAX_DB, db));
    
    // Normalize dB to 0-1 range (inverted: higher dB = lower Y)
    const normalized = (clampedDb - MIN_DB) / (MAX_DB - MIN_DB);
    
    // Map to drawing area (accounting for top and bottom padding, inverted: 0 at top, height at bottom)
    const drawingHeight = height - CANVAS_PADDING_TOP - CANVAS_PADDING_BOTTOM;
    return CANVAS_PADDING_TOP + (1 - normalized) * drawingHeight;
}

/**
 * Get the sample rate from the audio context
 * @returns {number} Sample rate in Hz
 */
function getSampleRate() {
    return audioContext ? audioContext.sampleRate : 44100; // Default to 44.1 kHz
}

/**
 * Compute bin frequencies for all bins (helper for test audio mode)
 * @returns {Float32Array} Array of frequencies corresponding to each bin
 */
function computeBinFrequencies() {
    if (!frequencyBinCount || !audioContext) {
        return new Float32Array(0);
    }
    
    const sampleRate = getSampleRate();
    const frequencies = new Float32Array(frequencyBinCount);
    
    for (let i = 0; i < frequencyBinCount; i++) {
        frequencies[i] = binFrequency(i, sampleRate, frequencyBinCount);
    }
    
    return frequencies;
}

/**
 * Initialize AudioContext and AnalyserNode
 * Called once when first audio source is set up
 */
function initializeAudioContext() {
    if (!audioContext) {
        // Try to create AudioContext at 48 kHz to match the source audio file
        // If 48 kHz is not supported, fall back to browser default
        const preferredSampleRate = 48000; // 48 kHz to match source audio
        
        try {
            // Try creating with explicit 48 kHz sample rate
            audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: preferredSampleRate
            });
            
            // Check if we actually got 48 kHz (some browsers may ignore the request)
            if (audioContext.sampleRate !== preferredSampleRate) {
                console.warn(`Requested ${preferredSampleRate} Hz but got ${audioContext.sampleRate} Hz. Browser may not support ${preferredSampleRate} Hz.`);
            } else {
                console.log(`AudioContext created at ${audioContext.sampleRate} Hz (matches source audio)`);
            }
        } catch (e) {
            // If explicit sample rate fails, fall back to default
            console.warn(`Failed to create AudioContext at ${preferredSampleRate} Hz, using browser default:`, e);
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log(`AudioContext created at browser default: ${audioContext.sampleRate} Hz`);
        }
        
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        
        // Calculate frequency bin count (fftSize / 2)
        frequencyBinCount = analyser.frequencyBinCount;
        
        // Allocate FFT data arrays
        fftData = new Float32Array(frequencyBinCount);
        smoothedData = new Float32Array(frequencyBinCount);
        
        // Initialize smoothed data array (will be populated on first update)
        
        // Initialize waveform buffer size
        updateWaveformBufferSize();
        
        // Compute bin indices for each band
        computeBandBinIndices();
    }
    return { audioContext, analyser };
}

/**
 * Set up test audio file playback
 * @param {string} audioPath - Path to the audio file
 */
function setupTestAudio(audioPath) {
    // Clean up previous audio source if it exists
    cleanupTestAudio();
    
    // Initialize audio context if needed
    const { audioContext: ctx, analyser: anal } = initializeAudioContext();
    
    // Create audio element
    const audioElement = document.createElement('audio');
    
    // Track if we've tried MP3 fallback
    let triedMp3Fallback = false;
    
    // Add error handling BEFORE setting src
    audioElement.addEventListener('error', (e) => {
        console.error('Audio element error event fired:', e);
        const error = audioElement.error;
        if (error) {
            const errorMessages = {
                1: 'MEDIA_ERR_ABORTED - The user aborted the loading',
                2: 'MEDIA_ERR_NETWORK - A network error occurred (file not found or CORS issue)',
                3: 'MEDIA_ERR_DECODE - An error occurred while decoding (format issue)',
                4: 'MEDIA_ERR_SRC_NOT_SUPPORTED - The audio format is not supported'
            };
            const errorMsg = errorMessages[error.code] || `Error code: ${error.code}`;
            console.error('Audio error details:', {
                code: error.code,
                message: error.message,
                errorMsg: errorMsg,
                src: audioElement.src,
                networkState: audioElement.networkState,
                readyState: audioElement.readyState
            });
            
            // Try MP3 fallback if WAV fails and we haven't tried yet
            if ((error.code === 3 || error.code === 4) && audioPath.endsWith('.wav') && !triedMp3Fallback) {
                const mp3Path = audioPath.replace(/\.wav$/i, '.mp3');
                console.log('WAV format error detected, trying MP3 fallback:', mp3Path);
                triedMp3Fallback = true;
                
                // Try loading MP3 version
                audioElement.src = mp3Path.split('/').map(segment => encodeURIComponent(segment)).join('/');
                audioElement.load();
                return; // Don't show error yet, wait to see if MP3 works
            }
            
            // More helpful error message
            let userMessage = `Audio Error: ${errorMsg}`;
            if (error.code === 2) {
                userMessage += '\n\nPossible causes:\n- File not found\n- CORS issue\n- Network problem';
            } else if (error.code === 3 || error.code === 4) {
                userMessage += '\n\nPossible causes:\n- Audio format not supported\n- File is corrupted';
                if (audioPath.endsWith('.wav')) {
                    userMessage += '\n\nTip: Try converting to MP3 using: ./convert_to_mp3.sh';
                }
            }
            userMessage += `\n\nFile: ${audioPath}`;
            
            alert(userMessage);
        } else {
            console.error('Audio error event but no error object available');
            console.error('Audio element state:', {
                src: audioElement.src,
                networkState: audioElement.networkState,
                readyState: audioElement.readyState
            });
        }
    });
    
    // Set up audio element
    // Note: crossOrigin not needed for same-origin files, and can cause issues
    audioElement.preload = 'auto';
    audioElement.volume = 1.0; // Ensure volume is at maximum
    
    // Store reference early
    currentAudioElement = audioElement;
    
    // Wait for audio to be ready before creating source node
    const setupSourceNode = () => {
        if (currentAudioSource) {
            console.log('Source node already exists, skipping');
            return;
        }
        
        // Check if audio has an error
        if (audioElement.error) {
            console.error('Cannot create source node: audio element has error', audioElement.error);
            return;
        }
        
        // Check if audio is ready
        if (audioElement.readyState < 2) {
            console.warn('Audio not ready yet, readyState:', audioElement.readyState);
            return;
        }
        
        try {
            // Create MediaElementAudioSourceNode
            const audioSource = ctx.createMediaElementSource(audioElement);
            
            // IMPORTANT: When using MediaElementAudioSourceNode, the audio element
            // should NOT be connected to its default destination. The source node
            // handles the connection. Connect: audio source → analyser → destination
            audioSource.connect(anal);
            anal.connect(ctx.destination);
            
            // Verify connection
            console.log('Audio node connections:', {
                sourceConnected: audioSource.numberOfOutputs > 0,
                analyserConnected: anal.numberOfInputs > 0 && anal.numberOfOutputs > 0,
                destinationConnected: ctx.destination.numberOfInputs > 0
            });
            
            // Store reference
            currentAudioSource = audioSource;
            
            console.log('Audio source node created successfully', {
                analyserFftSize: anal.fftSize,
                frequencyBinCount: anal.frequencyBinCount,
                sampleRate: ctx.sampleRate,
                audioContextState: ctx.state
            });
            
            // Verify FFT arrays are initialized
            if (!fftData || !smoothedData) {
                console.warn('FFT arrays not initialized yet, will be created when AudioContext initializes');
            } else {
                console.log('FFT arrays ready:', {
                    fftDataLength: fftData.length,
                    smoothedDataLength: smoothedData.length
                });
            }
        } catch (error) {
            console.error('Error creating MediaElementAudioSourceNode:', error);
            console.error('Error details:', {
                message: error.message,
                name: error.name,
                stack: error.stack,
                audioReadyState: audioElement.readyState,
                audioError: audioElement.error,
                audioNetworkState: audioElement.networkState
            });
            
            // Check if it's a specific error about the media element
            if (error.message && error.message.includes('MediaElement')) {
                alert(`Error: Cannot create audio source node.\n\nThis usually happens when:\n- The audio file failed to load\n- The audio format is not supported\n- The audio element is in an invalid state\n\nCheck the browser console for details.`);
            } else {
                alert(`Error setting up audio: ${error.message}\n\nCheck the browser console for details.`);
            }
        }
    };
    
    // Add load event listener
    audioElement.addEventListener('loadedmetadata', () => {
        console.log('Audio metadata loaded, readyState:', audioElement.readyState);
    });
    
    // Try to set up source node when audio can play
    audioElement.addEventListener('canplay', () => {
        console.log('Audio can play, readyState:', audioElement.readyState);
        if (!currentAudioSource) {
            setupSourceNode();
        }
    });
    
    // Log when audio is ready to play
    audioElement.addEventListener('canplaythrough', () => {
        console.log('Audio can play through without buffering');
        if (!currentAudioSource) {
            setupSourceNode();
        }
    });
    
    // Set src and load the audio
    // URL encode the path to handle spaces and special characters like #
    // Split by / and encode each segment, then rejoin
    const pathSegments = audioPath.split('/');
    const encodedPath = pathSegments.map(segment => encodeURIComponent(segment)).join('/');
    
    console.log('Setting audio src to:', audioPath);
    console.log('Encoded path:', encodedPath);
    
    audioElement.src = encodedPath;
    audioElement.load();
    
    // Update play/pause button state based on audio element
    audioElement.addEventListener('play', () => {
        playPauseBtn.textContent = 'Pause';
        
        // CRITICAL: Resume AudioContext before starting visualization
        // AudioContext starts suspended and needs user interaction to resume
        if (audioContext && audioContext.state === 'suspended') {
            console.log('Audio playing - resuming AudioContext...');
            audioContext.resume().then(() => {
                console.log('AudioContext resumed, state:', audioContext.state);
                startVisualization();
            }).catch(err => {
                console.error('Failed to resume AudioContext on play:', err);
                startVisualization(); // Try anyway
            });
        } else {
            startVisualization();
        }
    });
    
    audioElement.addEventListener('pause', () => {
        playPauseBtn.textContent = 'Play';
        stopVisualization();
    });
    
    audioElement.addEventListener('ended', () => {
        playPauseBtn.textContent = 'Play';
        stopVisualization();
    });
    
    // Return audio element (audioSource will be set up asynchronously)
    return { audioElement, audioSource: null };
}

/**
 * Clean up current test audio source
 */
function cleanupTestAudio() {
    // Stop visualization
    stopVisualization();
    
    // Reset EMA initialization flag for fresh start
    emaInitialized = false;
    
    if (currentAudioElement) {
        // Stop playback
        currentAudioElement.pause();
        currentAudioElement.src = '';
        
        // Disconnect source node if it exists
        if (currentAudioSource) {
            try {
                currentAudioSource.disconnect();
            } catch (e) {
                // Ignore disconnect errors (node may already be disconnected)
            }
        }
        
        // Remove audio element from DOM if it was added
        if (currentAudioElement.parentNode) {
            currentAudioElement.parentNode.removeChild(currentAudioElement);
        }
        
        currentAudioElement = null;
        currentAudioSource = null;
    }
}

/**
 * Apply Exponential Moving Average (EMA) smoothing to FFT data
 * @param {Float32Array} fftData - Raw FFT frequency data
 * @param {Float32Array} smoothed - Persistent smoothed data array
 * @param {number} alpha - Smoothing factor (0-1, higher = more smoothing)
 */
function updateEMA(fftData, smoothed, alpha) {
    if (!fftData || !smoothed || fftData.length !== smoothed.length) {
        return;
    }
    
    // On first call, initialize smoothed array with raw FFT data
    if (!emaInitialized) {
        for (let i = 0; i < fftData.length; i++) {
            smoothed[i] = fftData[i];
        }
        emaInitialized = true;
        return;
    }
    
    // Apply EMA smoothing: smoothed[i] = alpha * newValue + (1 - alpha) * oldValue
    // Note: Lower alpha = more smoothing (slower response), Higher alpha = less smoothing (faster response)
    // For dB values, we need to handle -Infinity specially
    for (let i = 0; i < fftData.length; i++) {
        const newVal = fftData[i];
        const oldVal = smoothed[i];
        
        // Handle -Infinity: if new value is -Infinity, keep old value (don't smooth to -Infinity)
        // If old value is -Infinity but new is finite, use new value
        if (!isFinite(newVal) && newVal === -Infinity) {
            // New value is silence, keep old smoothed value (don't update)
            continue;
        } else if (!isFinite(oldVal) && oldVal === -Infinity) {
            // Old value was silence, new value has signal - use new value
            smoothed[i] = newVal;
        } else {
            // Both values are finite, apply normal EMA
            smoothed[i] = alpha * newVal + (1 - alpha) * oldVal;
        }
    }
}

/**
 * Calculate view duration in seconds based on BPM and number of bars
 * @param {number} bpm - Beats per minute
 * @param {number} bars - Number of bars (1, 4, or 8)
 * @returns {number} Duration in seconds
 */
function calculateViewDuration(bpm, bars) {
    const beats = bars * 4; // 4 beats per bar
    const durationSeconds = (beats / bpm) * 60;
    return durationSeconds;
}

/**
 * Update waveform buffer size based on current view duration
 */
function updateWaveformBufferSize() {
    if (!analyser || !audioContext) return;
    
    const bpm = HARDCODED_BPM;
    const bars = parseInt(viewLengthSelect.value) || 4;
    const viewDuration = calculateViewDuration(bpm, bars);
    
    const sampleRate = getSampleRate();
    const canvasWidth = oscilloscopeCanvas ? oscilloscopeCanvas.width : 800;
    
    // Calculate how many samples we need to store
    const totalSamplesNeeded = Math.ceil(viewDuration * sampleRate);
    
    // Calculate samples per pixel for downsampling
    waveformSamplesPerPixel = Math.max(1, Math.floor(totalSamplesNeeded / canvasWidth));
    
    // Buffer size should be at least the number of pixels (for scrolling)
    waveformBufferSize = Math.max(canvasWidth, totalSamplesNeeded);
    
    // Resize buffer if needed
    if (waveformBuffer.length !== waveformBufferSize) {
        const oldBuffer = waveformBuffer;
        waveformBuffer = new Array(waveformBufferSize).fill(0);
        
        // Copy old data if buffer is growing (preserve recent history)
        if (oldBuffer.length > 0) {
            const copyLength = Math.min(oldBuffer.length, waveformBufferSize);
            const oldStart = Math.max(0, oldBuffer.length - copyLength);
            for (let i = 0; i < copyLength; i++) {
                waveformBuffer[waveformBufferSize - copyLength + i] = oldBuffer[oldStart + i];
            }
        }
        
        waveformWriteIndex = 0;
    }
}

/**
 * Update waveform buffer with new time-domain data
 */
function updateWaveform() {
    if (!analyser || !oscilloscopeCtx) return;
    
    // Get time-domain data (raw audio samples)
    const bufferLength = analyser.fftSize;
    const timeData = new Float32Array(bufferLength);
    analyser.getFloatTimeDomainData(timeData);
    
    // Downsample and add to buffer
    for (let i = 0; i < timeData.length; i += waveformSamplesPerPixel) {
        // Average samples for this pixel
        let sum = 0;
        let count = 0;
        for (let j = 0; j < waveformSamplesPerPixel && (i + j) < timeData.length; j++) {
            sum += timeData[i + j];
            count++;
        }
        const avg = count > 0 ? sum / count : 0;
        
        // Store in circular buffer
        waveformBuffer[waveformWriteIndex] = avg;
        waveformWriteIndex = (waveformWriteIndex + 1) % waveformBufferSize;
    }
}

/**
 * Get color for waveform based on frequency content at a given sample
 * Uses FFT data to determine frequency coloring
 * @param {number} sampleIndex - Index in the waveform buffer
 * @param {number} bufferLength - Total buffer length
 * @returns {string} CSS color string
 */
function getWaveformColor(sampleIndex, bufferLength) {
    if (!fftData || !smoothedData || smoothedData.length === 0) {
        // Default high-contrast color if no FFT data
        return '#3b82f6'; // blue-500
    }
    
    // Map sample position to frequency bin (approximate)
    // Lower frequencies are typically more prominent in the waveform
    // We'll use a simple mapping: earlier samples = lower frequencies
    const normalizedPos = sampleIndex / bufferLength;
    
    // Map to frequency bins (inverse: lower position = lower frequency)
    const freqBinIndex = Math.floor((1 - normalizedPos) * smoothedData.length);
    const binIndex = Math.max(0, Math.min(smoothedData.length - 1, freqBinIndex));
    
    // Get energy level from FFT data
    const energy = smoothedData[binIndex];
    const normalizedEnergy = isFinite(energy) ? Math.max(0, Math.min(1, (energy - MIN_DB) / (MAX_DB - MIN_DB))) : 0;
    
    // Color scheme: lows (blue) -> mids (purple) -> highs (red)
    // Based on position in buffer and energy
    if (normalizedPos < 0.33) {
        // Low frequencies - blue to cyan
        const intensity = 0.4 + normalizedEnergy * 0.6;
        return `rgba(59, 130, 246, ${intensity})`; // blue-500
    } else if (normalizedPos < 0.66) {
        // Mid frequencies - purple
        const intensity = 0.4 + normalizedEnergy * 0.6;
        return `rgba(168, 85, 247, ${intensity})`; // purple-500
    } else {
        // High frequencies - red to orange
        const intensity = 0.4 + normalizedEnergy * 0.6;
        return `rgba(239, 68, 68, ${intensity})`; // red-500
    }
}

/**
 * Draw the oscilloscope waveform
 */
function drawOscilloscope() {
    if (!oscilloscopeCtx || !oscilloscopeCanvas || waveformBuffer.length === 0) {
        return;
    }
    
    const width = oscilloscopeCanvas.width;
    const height = oscilloscopeCanvas.height;
    const centerY = height / 2;
    
    // Clear canvas
    oscilloscopeCtx.fillStyle = '#030712'; // gray-950
    oscilloscopeCtx.fillRect(0, 0, width, height);
    
    // Draw zero-crossing line
    oscilloscopeCtx.strokeStyle = 'rgba(107, 114, 128, 0.3)'; // gray-500 with transparency
    oscilloscopeCtx.lineWidth = 1;
    oscilloscopeCtx.beginPath();
    oscilloscopeCtx.moveTo(0, centerY);
    oscilloscopeCtx.lineTo(width, centerY);
    oscilloscopeCtx.stroke();
    
    // Draw waveform (scrolling from right to left)
    // Most recent data appears on the right, older data scrolls left
    const pixelsToDraw = Math.min(width, waveformBuffer.length);
    
    if (pixelsToDraw === 0) return;
    
    // Build arrays for top path (for filled waveform) and line path
    const topPath = [];
    const linePath = [];
    
    // Read from buffer: most recent data appears on the right, scrolling left
    // We want newest data (rightmost) to oldest data (leftmost)
    for (let x = 0; x < pixelsToDraw; x++) {
        // Calculate buffer index: read from newest (at writeIndex-1) to oldest
        // x=0 (rightmost) = newest data, x=pixelsToDraw-1 (leftmost) = oldest visible data
        // Newest is at (writeIndex - 1), oldest visible is at (writeIndex - pixelsToDraw)
        const bufferIndex = (waveformWriteIndex - 1 - x + waveformBufferSize) % waveformBufferSize;
        const sample = waveformBuffer[bufferIndex];
        
        // Convert sample (-1 to 1) to Y coordinate
        const amplitude = Math.max(-1, Math.min(1, sample));
        const y = centerY - (amplitude * (height * 0.4)); // Use 80% of height for waveform
        
        // Canvas X position: newest data (x=0) goes to rightmost (width-1)
        const canvasX = width - x - 1;
        
        linePath.push({ x: canvasX, y: y, bufferIndex: bufferIndex });
        topPath.push({ x: canvasX, y: y });
    }
    
    // Draw filled waveform with gradient
    if (topPath.length > 0) {
        oscilloscopeCtx.beginPath();
        
        // Draw top path (waveform line)
        oscilloscopeCtx.moveTo(topPath[0].x, topPath[0].y);
        for (let i = 1; i < topPath.length; i++) {
            oscilloscopeCtx.lineTo(topPath[i].x, topPath[i].y);
        }
        
        // Close path to center line for fill
        const lastX = topPath[topPath.length - 1].x;
        oscilloscopeCtx.lineTo(lastX, centerY);
        oscilloscopeCtx.lineTo(topPath[0].x, centerY);
        oscilloscopeCtx.closePath();
        
        // Create gradient fill (left to right: blue -> purple -> red)
        const gradient = oscilloscopeCtx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, 'rgba(59, 130, 246, 0.6)');   // blue-500 (left/old)
        gradient.addColorStop(0.5, 'rgba(168, 85, 247, 0.6)'); // purple-500 (middle)
        gradient.addColorStop(1, 'rgba(239, 68, 68, 0.6)');     // red-500 (right/new)
        
        oscilloscopeCtx.fillStyle = gradient;
        oscilloscopeCtx.fill();
    }
    
    // Draw waveform line with smooth continuous path
    if (linePath.length > 1) {
        oscilloscopeCtx.beginPath();
        oscilloscopeCtx.moveTo(linePath[0].x, linePath[0].y);
        
        for (let i = 1; i < linePath.length; i++) {
            oscilloscopeCtx.lineTo(linePath[i].x, linePath[i].y);
        }
        
        // Use gradient for line color too (for visual consistency)
        const lineGradient = oscilloscopeCtx.createLinearGradient(0, 0, width, 0);
        lineGradient.addColorStop(0, 'rgba(59, 130, 246, 1)');   // blue-500
        lineGradient.addColorStop(0.5, 'rgba(168, 85, 247, 1)'); // purple-500
        lineGradient.addColorStop(1, 'rgba(239, 68, 68, 1)');     // red-500
        
        oscilloscopeCtx.strokeStyle = lineGradient;
        oscilloscopeCtx.lineWidth = 2;
        oscilloscopeCtx.stroke();
    }
}

/**
 * Resize oscilloscope canvas to match container size
 */
function resizeOscilloscopeCanvas() {
    if (!oscilloscopeCanvas || !oscilloscopeContainer) return;
    
    const containerWidth = oscilloscopeContainer.clientWidth;
    const containerHeight = oscilloscopeContainer.clientHeight;
    
    let newWidth = containerWidth;
    let newHeight = containerWidth / OSCILLOSCOPE_ASPECT_RATIO;
    
    if (newHeight > containerHeight) {
        newHeight = containerHeight;
        newWidth = containerHeight * OSCILLOSCOPE_ASPECT_RATIO;
    }
    
    oscilloscopeCanvas.width = newWidth;
    oscilloscopeCanvas.height = newHeight;
    
    // Update buffer size when canvas resizes
    updateWaveformBufferSize();
    
    // Redraw if we have data
    if (waveformBuffer.length > 0) {
        drawOscilloscope();
    }
}

/**
 * Calculate energy (RMS) for a frequency band from FFT data
 * Uses bin indices (startBin/endBin) if available for efficient computation
 * @param {Float32Array} fftData - FFT frequency data in dB
 * @param {Object} bandDef - Band definition object with startBin, endBin properties
 * @returns {number} Energy in dB (or -Infinity if no energy)
 */
function calculateBandEnergy(fftData, bandDef) {
    if (!fftData || !bandDef) {
        return -Infinity;
    }
    
    // Use bin indices if available, otherwise fall back to frequency-based lookup
    if (bandDef.startBin != null && bandDef.endBin != null) {
        // Use bin indices directly (more efficient and accurate)
        const validBins = [];
        const startBin = Math.max(0, Math.min(bandDef.startBin, fftData.length - 1));
        const endBin = Math.max(startBin, Math.min(bandDef.endBin, fftData.length - 1));
        
        for (let i = startBin; i <= endBin; i++) {
            const dbValue = fftData[i];
            // Only include finite values (skip -Infinity)
            if (isFinite(dbValue)) {
                validBins.push(dbValue);
            }
        }
        
        if (validBins.length === 0) {
            return -Infinity;
        }
        
        // Convert dB to linear scale, calculate RMS, then convert back to dB
        // RMS in linear: sqrt(sum(x^2) / n)
        // For dB values: x_linear = 10^(dB/20)
        let sumSquared = 0;
        for (let i = 0; i < validBins.length; i++) {
            const linearValue = Math.pow(10, validBins[i] / 20);
            sumSquared += linearValue * linearValue;
        }
        
        const rmsLinear = Math.sqrt(sumSquared / validBins.length);
        const rmsDb = 20 * Math.log10(rmsLinear);
        
        return rmsDb;
    } else {
        // Fallback to frequency-based lookup (for backwards compatibility)
        return -Infinity;
    }
}

/**
 * Update band states with new energy values and apply decay
 * Uses normalized 0-1 values with category gain compensation
 * @param {Float32Array} fftData - Current FFT data in dB
 * @param {Float32Array} binFrequencies - Array of frequencies for each bin
 */
function updateBandStates(fftData, binFrequencies) {
    if (!fftData || !binFrequencies || bandStates.length === 0) {
        return;
    }
    
    for (let i = 0; i < bandStates.length; i++) {
        const bandState = bandStates[i];
        const bandDef = bandDefinitions[i];
        
        // 1. Calculate current energy for this band (in dB)
        const newEnergy = calculateBandEnergy(fftData, bandDef);
        
        // Store raw energy for reference
        if (isFinite(newEnergy)) {
            bandState.currentEnergy = newEnergy;
        }
        
        // 2. Apply category gain (tilt compensation)
        const categoryGain = getCategoryGain(bandState.category);
        const compensated = isFinite(newEnergy) ? newEnergy + categoryGain : -Infinity;
        
        // 3. Compute how far above threshold (in dB)
        const above = isFinite(compensated) ? compensated - bandState.threshold : -Infinity;
        
        // 4. Normalize to 0-1 using dynamic range window above threshold with gentle curve
        const linear = isFinite(above) && above > 0 
            ? Math.max(0, Math.min(1, above / ENERGY_DYNAMIC_RANGE_DB))
            : 0;
        
        // Apply a gentle curve so small values are a bit more visible,
        // but we don't instantly saturate to 1.0
        const normalized = Math.pow(linear, 0.8);
        
        // 5. Store instant value (drives the main bar, no peak hold)
        bandState.instantValue = normalized;
        
        // 6. Update peakValue with decay logic (only for peak cap indicator)
        if (normalized > bandState.peakValue) {
            // If new normalized value is higher, update immediately
            bandState.peakValue = normalized;
        } else {
            // Otherwise, apply decay based on decayMultiplier and globalDecaySpeed
            const decayFactor = Math.pow(bandState.peakHoldDecayRate, bandState.decayMultiplier * globalDecaySpeed);
            bandState.peakValue *= decayFactor;
        }
        
        // Ensure peakValue stays in valid range
        bandState.peakValue = Math.max(0, Math.min(1, bandState.peakValue));
    }
}

/**
 * Draw the band visualizer
 * Uses instantValue for main bar and peakValue for peak cap indicator
 */
function drawBandVisualizer() {
    if (!bandVisualizerCtx || !bandVisualizerCanvas || bandStates.length === 0) {
        return;
    }
    
    const width = bandVisualizerCanvas.width;
    const height = bandVisualizerCanvas.height;
    
    // Clear canvas
    bandVisualizerCtx.fillStyle = '#030712'; // gray-950
    bandVisualizerCtx.fillRect(0, 0, width, height);
    
    // Calculate band width
    const bandWidth = width / BAND_COUNT;
    const bandHeight = height;
    const padding = 2; // Padding between bands
    const minVisible = 0.02; // Minimum visible fraction (2% of max height, only for drawing)
    
    // Draw each band
    for (let i = 0; i < BAND_COUNT; i++) {
        const bandState = bandStates[i];
        const x = i * bandWidth;
        const barX = x + padding;
        const barWidth = bandWidth - padding * 2;
        
        // Use instantValue for main bar (no peak hold)
        const instantValue = bandState.instantValue || 0;
        const instantDisplay = instantValue > 0 ? Math.max(minVisible, instantValue) : 0;
        const barHeight = instantDisplay * bandHeight;
        
        // Draw band background (subtle)
        bandVisualizerCtx.fillStyle = 'rgba(31, 41, 55, 0.5)'; // gray-800 with transparency
        bandVisualizerCtx.fillRect(barX, 0, barWidth, bandHeight);
        
        // Draw main bar (from bottom up) using instantValue
        if (barHeight > 0) {
            const barY = bandHeight - barHeight;
            
            // Create gradient for amplitude-driven color (brighter at top)
            const gradient = bandVisualizerCtx.createLinearGradient(x, barY, x, bandHeight);
            const baseColor = bandState.color;
            
            // Convert hex to RGB
            const r = parseInt(baseColor.slice(1, 3), 16);
            const g = parseInt(baseColor.slice(3, 5), 16);
            const b = parseInt(baseColor.slice(5, 7), 16);
            
            // Top of bar (brighter)
            gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.9)`);
            // Bottom of bar (dimmer)
            gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.3)`);
            
            bandVisualizerCtx.fillStyle = gradient;
            bandVisualizerCtx.fillRect(barX, barY, barWidth, barHeight);
        }
        
        // Draw peak cap indicator (small rectangle at peak height)
        if (bandState.peakValue > 0) {
            const peakHeight = bandState.peakValue * bandHeight;
            const peakY = bandHeight - peakHeight;
            const capHeight = Math.max(2, bandHeight * 0.02); // Small cap, at least 2px
            
            bandVisualizerCtx.fillStyle = 'rgba(255, 255, 255, 0.9)'; // White peak cap
            bandVisualizerCtx.fillRect(barX, peakY - capHeight, barWidth, capHeight);
        }
        
        // Store screen geometry for hover detection
        const bandDef = bandDefinitions[i];
        bandState.screenX = barX;
        bandState.screenY = 0;
        bandState.screenWidth = barWidth;
        bandState.screenHeight = bandHeight;
        // Store band definition reference for tooltip
        bandState.bandDef = bandDef;
    }
}

/**
 * Resize band visualizer canvas to match container size
 */
function resizeBandVisualizerCanvas() {
    if (!bandVisualizerCanvas || !bandVisualizerContainer) return;
    
    const containerWidth = bandVisualizerContainer.clientWidth;
    const containerHeight = bandVisualizerContainer.clientHeight;
    
    let newWidth = containerWidth;
    let newHeight = containerWidth / BAND_VISUALIZER_ASPECT_RATIO;
    
    if (newHeight > containerHeight) {
        newHeight = containerHeight;
        newWidth = containerHeight * BAND_VISUALIZER_ASPECT_RATIO;
    }
    
    bandVisualizerCanvas.width = newWidth;
    bandVisualizerCanvas.height = newHeight;
    
    // Redraw if we have data
    if (bandStates.length > 0) {
        drawBandVisualizer();
    }
}

/**
 * Update function: Read FFT data from analyser and apply smoothing
 */
function update() {
    if (!analyser) {
        if (Math.random() < 0.01) {
            console.warn('Update: No analyser available');
        }
        return;
    }
    
    if (!fftData) {
        if (Math.random() < 0.01) {
            console.warn('Update: No fftData array available');
        }
        return;
    }
    
    // Read FFT data from analyser
    analyser.getFloatFrequencyData(fftData);
    
    // Check if we're getting any valid values (-Infinity is valid, NaN is not)
    const hasAnyData = Array.from(fftData).some(val => !isNaN(val));
    
    if (!hasAnyData && Math.random() < 0.1) {
        console.warn('FFT data appears to be all NaN. Audio may not be flowing through analyser.');
    }
    
    // Apply EMA smoothing
    if (smoothedData) {
        updateEMA(fftData, smoothedData, emaAlpha);
        
        // Debug: Log first few values occasionally
        if (Math.random() < 0.01) { // Log ~1% of the time
            const fftArray = Array.from(fftData);
            const smoothedArray = Array.from(smoothedData);
            const validFft = fftArray.filter(v => !isNaN(v));
            const validSmoothed = smoothedArray.filter(v => !isNaN(v));
            const finiteFft = validFft.filter(v => isFinite(v));
            const finiteSmoothed = validSmoothed.filter(v => isFinite(v));
            
            console.log('FFT data sample:', {
                fftLength: fftData.length,
                smoothedLength: smoothedData.length,
                validFftCount: validFft.length,
                validSmoothedCount: validSmoothed.length,
                finiteFftCount: finiteFft.length,
                finiteSmoothedCount: finiteSmoothed.length,
                first5: fftArray.slice(0, 5),
                smoothedFirst5: smoothedArray.slice(0, 5),
                fftMin: finiteFft.length > 0 ? Math.min(...finiteFft) : (validFft.length > 0 ? 'All -Infinity' : 'N/A'),
                fftMax: finiteFft.length > 0 ? Math.max(...finiteFft) : (validFft.length > 0 ? 'All -Infinity' : 'N/A'),
                smoothedMin: finiteSmoothed.length > 0 ? Math.min(...finiteSmoothed) : (validSmoothed.length > 0 ? 'All -Infinity' : 'N/A'),
                smoothedMax: finiteSmoothed.length > 0 ? Math.max(...finiteSmoothed) : (validSmoothed.length > 0 ? 'All -Infinity' : 'N/A')
            });
        }
    } else {
        if (Math.random() < 0.01) {
            console.warn('Update: No smoothedData array available');
        }
    }
    
    // Update waveform buffer
    updateWaveform();
    
    // Update band states with smoothed FFT data
    if (smoothedData && audioContext) {
        const binFrequencies = computeBinFrequencies();
        if (binFrequencies.length > 0) {
            updateBandStates(smoothedData, binFrequencies);
        }
    }
}

/**
 * Draw the spectrum with amplitude line and gradient fill
 * @param {Float32Array} smoothed - Smoothed FFT data array
 * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 */
function drawSpectrum(smoothed, ctx, width, height) {
    if (!smoothed || smoothed.length === 0 || !audioContext) {
        console.warn('drawSpectrum: No data to draw', {
            hasSmoothed: !!smoothed,
            smoothedLength: smoothed ? smoothed.length : 0,
            hasAudioContext: !!audioContext
        });
        return;
    }
    
    const sampleRate = getSampleRate();
    const binFrequencies = computeBinFrequencies();
    
    if (binFrequencies.length === 0) {
        console.warn('drawSpectrum: No bin frequencies computed');
        return;
    }
    
    // Build the path for the spectrum line
    ctx.beginPath();
    
    let firstX = null;
    let firstY = null;
    let pointsDrawn = 0;
    
    for (let i = 0; i < smoothed.length; i++) {
        const freq = binFrequencies[i];
        
        // Skip bins outside the frequency range
        if (freq < MIN_FREQ || freq > MAX_FREQ) {
            continue;
        }
        
        const x = frequencyToX(freq, width);
        const y = dbToY(smoothed[i], height);
        
        // Clamp Y to valid drawing area bounds (accounting for padding)
        const clampedY = Math.max(CANVAS_PADDING_TOP, Math.min(height - CANVAS_PADDING_BOTTOM, y));
        
        if (firstX === null) {
            firstX = x;
            firstY = clampedY;
            ctx.moveTo(x, clampedY);
            pointsDrawn++;
        } else {
            ctx.lineTo(x, clampedY);
            pointsDrawn++;
        }
    }
    
    // Debug: Log occasionally
    if (Math.random() < 0.01) { // Log ~1% of the time
        console.log('drawSpectrum:', {
            pointsDrawn: pointsDrawn,
            firstX: firstX,
            firstY: firstY,
            canvasWidth: width,
            canvasHeight: height,
            sampleRate: sampleRate
        });
    }
    
    // Close the path to the bottom corners for gradient fill
    if (firstX !== null) {
        const lastX = frequencyToX(MAX_FREQ, width);
        const bottomY = height - CANVAS_PADDING_BOTTOM;
        ctx.lineTo(lastX, bottomY); // Bottom right (at drawing area bottom)
        ctx.lineTo(firstX, bottomY); // Bottom left (at drawing area bottom)
        ctx.closePath();
    } else {
        return; // No valid data to draw
    }
    
    // Create gradient fill (blue to red) - only in the drawing area
    const gradient = ctx.createLinearGradient(0, CANVAS_PADDING_TOP, 0, height - CANVAS_PADDING_BOTTOM);
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.6)');   // blue-500 with transparency
    gradient.addColorStop(0.5, 'rgba(168, 85, 247, 0.6)'); // purple-500
    gradient.addColorStop(1, 'rgba(239, 68, 68, 0.6)');     // red-500
    
    // Fill the area under the curve
    ctx.fillStyle = gradient;
    ctx.fill();
    
    // Stroke the line
    ctx.strokeStyle = '#3b82f6'; // blue-500
    ctx.lineWidth = 2;
    ctx.stroke();
}

/**
 * Draw frequency markers (vertical lines and labels)
 * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 */
function drawFrequencyMarkers(ctx, width, height) {
    const frequencies = [100, 1000, 10000]; // 100 Hz, 1 kHz, 10 kHz
    const labelY = CANVAS_PADDING_TOP / 2; // Position labels in the top padding area
    
    ctx.strokeStyle = '#6b7280'; // gray-500
    ctx.lineWidth = 1;
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#d1d5db'; // gray-300
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    for (const freq of frequencies) {
        const x = frequencyToX(freq, width);
        
        // Draw vertical line (only in the drawing area, not in padding)
        ctx.beginPath();
        ctx.moveTo(x, CANVAS_PADDING_TOP);
        ctx.lineTo(x, height - CANVAS_PADDING_BOTTOM);
        ctx.stroke();
        
        // Format label
        let label;
        if (freq >= 1000) {
            label = `${freq / 1000} kHz`;
        } else {
            label = `${freq} Hz`;
        }
        
        // Draw label background for better readability
        const textMetrics = ctx.measureText(label);
        const textWidth = textMetrics.width;
        const textHeight = 14;
        const padding = 4;
        
        ctx.fillStyle = 'rgba(3, 7, 18, 0.8)'; // gray-950 with transparency
        ctx.fillRect(
            x - textWidth / 2 - padding,
            labelY - textHeight / 2 - 1,
            textWidth + padding * 2,
            textHeight + 2
        );
        
        // Draw label text
        ctx.fillStyle = '#d1d5db'; // gray-300
        ctx.fillText(label, x, labelY);
    }
}

/**
 * Draw dB scale markers on the left side (vertical axis)
 * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 */
function drawDbMarkers(ctx, width, height) {
    // dB values to display (from MAX_DB to MIN_DB, top to bottom)
    // Show markers every 10 dB from 0 dB (top) down to -100 dB (bottom)
    const dbValues = [0, -10, -20, -30, -40, -50, -60, -70, -80, -90, -100];
    const labelX = 8; // Position labels on the left
    
    ctx.strokeStyle = '#4b5563'; // gray-600 (lighter than frequency markers)
    ctx.lineWidth = 0.5;
    ctx.font = '11px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#9ca3af'; // gray-400
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    for (const db of dbValues) {
        const y = dbToY(db, height);
        
        // Draw horizontal line (from left padding edge to start of drawing area)
        ctx.beginPath();
        ctx.moveTo(CANVAS_PADDING_LEFT - 10, y);
        ctx.lineTo(CANVAS_PADDING_LEFT, y);
        ctx.stroke();
        
        // Format label
        const label = `${db} dB`;
        
        // Draw label background for better readability
        const textMetrics = ctx.measureText(label);
        const textWidth = textMetrics.width;
        const textHeight = 12;
        const padding = 3;
        
        ctx.fillStyle = 'rgba(3, 7, 18, 0.7)'; // gray-950 with transparency
        ctx.fillRect(
            labelX - 2,
            y - textHeight / 2 - 1,
            textWidth + padding,
            textHeight + 2
        );
        
        // Draw label text
        ctx.fillStyle = '#9ca3af'; // gray-400
        ctx.fillText(label, labelX, y);
    }
}

/**
 * Resize canvas to match container size
 */
function resizeCanvas() {
    if (!canvas || !canvasContainer) return;
    
    // Get container dimensions
    const containerWidth = canvasContainer.clientWidth;
    const containerHeight = canvasContainer.clientHeight;
    
    // Calculate canvas dimensions maintaining aspect ratio
    let newWidth = containerWidth;
    let newHeight = containerWidth / CANVAS_ASPECT_RATIO;
    
    // If calculated height exceeds container, scale down
    if (newHeight > containerHeight) {
        newHeight = containerHeight;
        newWidth = containerHeight * CANVAS_ASPECT_RATIO;
    }
    
    // Set canvas dimensions (this clears the canvas)
    canvas.width = newWidth;
    canvas.height = newHeight;
    
    // Redraw if we have data
    if (smoothedData && smoothedData.length > 0) {
        draw();
    }
}

/**
 * Draw function: Render to canvas
 */
function draw() {
    if (!ctx || !canvas) {
        console.warn('Cannot draw: canvas or context not available');
        return;
    }
    
    // Clear canvas
    ctx.fillStyle = '#030712'; // gray-950
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw the spectrum if we have smoothed data
    if (smoothedData && smoothedData.length > 0) {
        // Debug: Check if data has valid values
        // FFT data is in dB: -Infinity (silence) to ~0 dB (loud)
        // -Infinity is valid, NaN is not
        const validValues = Array.from(smoothedData).filter(val => !isNaN(val));
        const hasValidData = validValues.length > 0;
        
        // Debug logging occasionally
        if (Math.random() < 0.01) { // Log ~1% of the time
            console.log('draw: Data check', {
                totalLength: smoothedData.length,
                validCount: validValues.length,
                sampleValues: validValues.slice(0, 10),
                min: validValues.length > 0 ? Math.min(...validValues) : 'N/A',
                max: validValues.length > 0 ? Math.max(...validValues) : 'N/A'
            });
        }
        
        if (!hasValidData) {
            console.warn('draw: smoothedData has no valid values', {
                length: smoothedData.length,
                first10: Array.from(smoothedData.slice(0, 10)),
                hasAnalyser: !!analyser,
                hasFftData: !!fftData
            });
            ctx.fillStyle = '#ff0000';
            ctx.font = '16px system-ui';
            ctx.textAlign = 'center';
            ctx.fillText('No valid audio data - Check console', canvas.width / 2, canvas.height / 2);
        } else {
            drawSpectrum(smoothedData, ctx, canvas.width, canvas.height);
        }
    } else {
        // Draw a test message if no data
        ctx.fillStyle = '#ffffff';
        ctx.font = '16px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('Waiting for audio data...', canvas.width / 2, canvas.height / 2);
    }
    
    // Draw frequency markers on top
    drawFrequencyMarkers(ctx, canvas.width, canvas.height);
    
    // Draw dB scale markers on the left
    drawDbMarkers(ctx, canvas.width, canvas.height);
    
    // Draw band visualizer
    drawBandVisualizer();
    
    // Draw oscilloscope
    drawOscilloscope();
}

let frameCount = 0;
/**
 * Animation loop
 */
function animate() {
    if (!isAnimating) {
        console.log('Animation stopped');
        return;
    }
    
    frameCount++;
    
    // Log every 60 frames (~1 second at 60fps)
    if (frameCount % 60 === 0) {
        console.log('Animation running, frame:', frameCount, {
            hasAnalyser: !!analyser,
            hasFftData: !!fftData,
            hasSmoothedData: !!smoothedData,
            smoothedDataLength: smoothedData ? smoothedData.length : 0
        });
    }
    
    update();
    draw();
    
    animationFrameId = requestAnimationFrame(animate);
}

/**
 * Start the animation loop
 */
function startAnimationLoop() {
    if (!isAnimating && analyser) {
        isAnimating = true;
        animate();
    }
}

/**
 * Stop the animation loop
 */
function stopAnimationLoop() {
    isAnimating = false;
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
}

/**
 * Start visualization (resume AudioContext and start animation)
 */
function startVisualization() {
    console.log('startVisualization called');
    console.log('AudioContext state:', audioContext ? audioContext.state : 'null');
    console.log('Analyser available:', !!analyser);
    console.log('Is animating:', isAnimating);
    
    // Resume AudioContext if suspended - CRITICAL for audio to flow
    if (audioContext && audioContext.state === 'suspended') {
        console.log('Resuming suspended AudioContext...');
        audioContext.resume().then(() => {
            console.log('AudioContext resumed successfully, state:', audioContext.state);
            
            // Start animation loop after context is resumed
            if (analyser && !isAnimating) {
                console.log('Starting animation loop...');
                startAnimationLoop();
            }
        }).catch(err => {
            console.error('Failed to resume AudioContext:', err);
        });
    } else {
        // Start animation loop if analyser is available
        if (analyser && !isAnimating) {
            console.log('Starting animation loop...');
            startAnimationLoop();
        } else {
            console.warn('Cannot start animation:', {
                hasAnalyser: !!analyser,
                isAnimating: isAnimating,
                audioContextState: audioContext ? audioContext.state : 'null'
            });
        }
    }
}

/**
 * Stop visualization (suspend AudioContext and stop animation)
 */
function stopVisualization() {
    // Stop animation loop
    stopAnimationLoop();
    
    // Suspend AudioContext to save resources
    if (audioContext && audioContext.state === 'running') {
        audioContext.suspend().catch(err => {
            console.error('Failed to suspend AudioContext:', err);
        });
    }
}

/**
 * Handle play/pause button click
 */
function handlePlayPause() {
    if (!currentAudioElement) {
        // If no audio is set up, set up the selected audio file
        const selectedPath = audioSourceSelect.value;
        setupTestAudio(selectedPath);
        
        // Wait a moment for audio to be ready, then try playing
        setTimeout(() => {
            if (currentAudioElement) {
                handlePlayPause();
            }
        }, 100);
        return;
    }
    
    if (currentAudioElement.paused) {
        // Check if audio source node is ready
        if (!currentAudioSource) {
            console.warn('Audio source node not ready yet, waiting...');
            // Wait a bit and try again
            setTimeout(() => {
                if (currentAudioElement && currentAudioElement.paused) {
                    handlePlayPause();
                }
            }, 200);
            return;
        }
        
        // Check if audio is ready to play
        const readyState = currentAudioElement.readyState;
        console.log('Audio readyState:', readyState, 'HAVE_NOTHING=0, HAVE_METADATA=1, HAVE_CURRENT_DATA=2, HAVE_FUTURE_DATA=3, HAVE_ENOUGH_DATA=4');
        
        // Start visualization and play audio
        startVisualization();
        
        // play() returns a Promise that can be rejected
        const playPromise = currentAudioElement.play();
        
        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    // Playback started successfully
                    console.log('Audio playback started successfully');
                })
                .catch((error) => {
                    // Playback failed
                    console.error('Error playing audio:', error);
                    console.error('Audio element state:', {
                        readyState: currentAudioElement.readyState,
                        networkState: currentAudioElement.networkState,
                        error: currentAudioElement.error,
                        src: currentAudioElement.src
                    });
                    alert(`Failed to play audio: ${error.message || 'Unknown error'}\n\nCheck the browser console for more details.`);
                    stopVisualization();
                });
        }
    } else {
        // Pause audio (visualization will stop via event listener)
        currentAudioElement.pause();
    }
}

/**
 * Handle audio source dropdown change
 */
function handleAudioSourceChange() {
    const selectedPath = audioSourceSelect.value;
    
    // If audio is currently playing, stop it first
    if (currentAudioElement && !currentAudioElement.paused) {
        currentAudioElement.pause();
    }
    
    // Set up new audio source
    setupTestAudio(selectedPath);
    
    // Update button text
    playPauseBtn.textContent = 'Play';
}

/**
 * Handle smoothing slider change
 * Maps slider value (0-100) to alpha (0.1-0.95)
 * Note: Lower alpha = more smoothing (slower response), Higher alpha = less smoothing (faster response)
 */
function handleSmoothingChange() {
    const sliderValue = parseFloat(smoothingSlider.value);
    
    // Update display
    smoothingValue.textContent = Math.round(sliderValue);
    
    // Map slider value (0-100) to alpha (0.1-0.95)
    // 0% = maximum smoothing (alpha = 0.1, very slow response, very smooth)
    // 100% = minimal smoothing (alpha = 0.95, very fast response, follows input closely)
    // This range provides more noticeable smoothing effects
    emaAlpha = 0.1 + (sliderValue / 100) * 0.85;
    
    console.log(`Smoothing updated: ${Math.round(sliderValue)}% -> alpha = ${emaAlpha.toFixed(3)}`);
}

/**
 * Handle view length dropdown change
 */
function handleViewLengthChange() {
    updateWaveformBufferSize();
    console.log('View length updated');
}

/**
 * Handle decay speed slider change
 */
function handleDecaySpeedChange() {
    if (!decaySpeedSlider) return;
    
    const raw = parseFloat(decaySpeedSlider.value);
    
    if (!Number.isNaN(raw)) {
        globalDecaySpeed = raw;
        
        if (decaySpeedValue) {
            decaySpeedValue.textContent = raw.toFixed(2);
        }
        
        console.log(`Decay speed updated: ${raw.toFixed(2)}x`);
    }
}

// Event listeners
playPauseBtn.addEventListener('click', handlePlayPause);
audioSourceSelect.addEventListener('change', handleAudioSourceChange);
smoothingSlider.addEventListener('input', handleSmoothingChange);
viewLengthSelect.addEventListener('change', handleViewLengthChange);
if (decaySpeedSlider) {
    decaySpeedSlider.addEventListener('input', handleDecaySpeedChange);
}

// Initialize alpha from slider's initial value
handleSmoothingChange();

// Initialize decay speed from slider's initial value
handleDecaySpeedChange();

// Initialize canvas size
resizeCanvas();
resizeBandVisualizerCanvas();
resizeOscilloscopeCanvas();

// Test canvas rendering
if (ctx && canvas) {
    console.log('Canvas initialized:', {
        width: canvas.width,
        height: canvas.height,
        hasContext: !!ctx
    });
    // Draw a test pattern to verify canvas works
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Canvas ready - Click Play to start visualization', canvas.width / 2, canvas.height / 2);
}

// Test oscilloscope canvas rendering
if (oscilloscopeCtx && oscilloscopeCanvas) {
    console.log('Oscilloscope canvas initialized:', {
        width: oscilloscopeCanvas.width,
        height: oscilloscopeCanvas.height,
        hasContext: !!oscilloscopeCtx
    });
    // Draw a test pattern
    oscilloscopeCtx.fillStyle = '#1f2937';
    oscilloscopeCtx.fillRect(0, 0, oscilloscopeCanvas.width, oscilloscopeCanvas.height);
    oscilloscopeCtx.fillStyle = '#ffffff';
    oscilloscopeCtx.font = '14px system-ui';
    oscilloscopeCtx.textAlign = 'center';
    oscilloscopeCtx.fillText('Oscilloscope ready - Click Play to start', oscilloscopeCanvas.width / 2, oscilloscopeCanvas.height / 2);
}

// Test band visualizer canvas rendering
if (bandVisualizerCtx && bandVisualizerCanvas) {
    console.log('Band visualizer canvas initialized:', {
        width: bandVisualizerCanvas.width,
        height: bandVisualizerCanvas.height,
        hasContext: !!bandVisualizerCtx,
        bandCount: BAND_COUNT
    });
    // Draw a test pattern
    bandVisualizerCtx.fillStyle = '#1f2937';
    bandVisualizerCtx.fillRect(0, 0, bandVisualizerCanvas.width, bandVisualizerCanvas.height);
    bandVisualizerCtx.fillStyle = '#ffffff';
    bandVisualizerCtx.font = '14px system-ui';
    bandVisualizerCtx.textAlign = 'center';
    bandVisualizerCtx.fillText('Energy Density Bands ready - Click Play to start', bandVisualizerCanvas.width / 2, bandVisualizerCanvas.height / 2);
}

// Add window resize event listener with debouncing
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        resizeCanvas();
        resizeBandVisualizerCanvas();
        resizeOscilloscopeCanvas();
    }, 100); // Debounce resize events
});

// Initialize with the default selected audio file
const defaultPath = audioSourceSelect.value;
if (defaultPath) {
    setupTestAudio(defaultPath);
}

// Tooltip element for band hover
const tooltip = document.getElementById('bandTooltip');

/**
 * Get the hovered band based on mouse coordinates
 * @param {MouseEvent} event - Mouse event
 * @returns {Object|null} The hovered band state or null
 */
function getHoveredBand(event) {
    if (!bandVisualizerCanvas || !bandStates.length) return null;
    
    const rect = bandVisualizerCanvas.getBoundingClientRect();
    const scaleX = bandVisualizerCanvas.width / rect.width;
    const scaleY = bandVisualizerCanvas.height / rect.height;
    
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;
    
    for (const band of bandStates) {
        if (
            band.screenX != null &&
            band.screenY != null &&
            band.screenWidth != null &&
            band.screenHeight != null &&
            x >= band.screenX &&
            x <= band.screenX + band.screenWidth &&
            y >= band.screenY &&
            y <= band.screenY + band.screenHeight
        ) {
            return band;
        }
    }
    
    return null;
}

/**
 * Handle mouse move to update tooltip
 * @param {MouseEvent} event - Mouse event
 */
function handleMouseMove(event) {
    if (!tooltip) return;
    
    const hovered = getHoveredBand(event);
    
    if (!hovered || !hovered.bandDef) {
        tooltip.style.display = 'none';
        return;
    }
    
    const bandDef = hovered.bandDef;
    if (!bandDef || bandDef.min == null || bandDef.max == null) {
        tooltip.style.display = 'none';
        return;
    }
    
    const freqRange = `${bandDef.min.toFixed(1)}–${bandDef.max.toFixed(1)} Hz`;
    const threshold = hovered.threshold != null ? `${hovered.threshold.toFixed(1)} dB` : 'n/a';
    const decay = hovered.decayMultiplier != null ? `${hovered.decayMultiplier.toFixed(2)}x` : 'n/a';
    const peakVal = hovered.peakValue != null ? hovered.peakValue.toFixed(2) : 'n/a';
    const energyDb = isFinite(hovered.currentEnergy) ? hovered.currentEnergy.toFixed(1) : 'n/a';
    
    tooltip.innerHTML = `
        <div><strong>${hovered.category}</strong></div>
        <div>Freq: ${freqRange}</div>
        <div>Energy: ${energyDb} dB</div>
        <div>Threshold: ${threshold}</div>
        <div>Decay: ${decay}</div>
        <div>Peak: ${peakVal}</div>
    `;
    
    tooltip.style.left = `${event.clientX + 12}px`;
    tooltip.style.top = `${event.clientY + 12}px`;
    tooltip.style.display = 'block';
}

// Register mouse event listeners
if (bandVisualizerCanvas) {
    bandVisualizerCanvas.addEventListener('mousemove', handleMouseMove);
    bandVisualizerCanvas.addEventListener('mouseleave', () => {
        if (tooltip) {
            tooltip.style.display = 'none';
        }
    });
}

