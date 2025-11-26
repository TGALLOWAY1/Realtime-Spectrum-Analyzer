// Audio context and analysers (shared across all sources)
let audioContext = null;
let analyserLeft = null; // For spectrum visualization
let analyserRight = null; // For spectrum visualization
let analyser = null; // Alias for analyserLeft (backward compatibility)
let channelSplitter = null;

// Crossover frequency constants (4-band crossover)
const CROSSOVER_SUB_LOW = 120;
const CROSSOVER_LOW_MID = 250;
const CROSSOVER_MID_HIGH = 2500;

// Multi-band crossover analysers (4 bands × 2 channels = 8 analysers)
let analyserSubL = null;
let analyserSubR = null;
let analyserLowL = null;
let analyserLowR = null;
let analyserMidL = null;
let analyserMidR = null;
let analyserHighL = null;
let analyserHighR = null;

// Crossover filter nodes (4 bands × 2 channels = 8 primary filters + 4 intermediate filters = 12 total)
let filterSubL = null;
let filterSubR = null;
let filterLowL = null;
let filterLowR = null;
let filterLowL_LP = null;  // Intermediate lowpass for Low band
let filterLowR_LP = null;  // Intermediate lowpass for Low band
let filterMidL = null;
let filterMidR = null;
let filterMidL_LP = null;  // Intermediate lowpass for Mid band
let filterMidR_LP = null;  // Intermediate lowpass for Mid band
let filterHighL = null;
let filterHighR = null;

// FFT data arrays
let fftData = null;
let smoothedData = null; // Fast/Live data (fixed fast smoothing)
let averageData = null;  // Long-term average data (variable smoothing from slider)
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
const fftSizeSelect = document.getElementById('fft-size-select');
const monoScopeCheck = document.getElementById('mono-scope-check');

// Hardcoded BPM
const HARDCODED_BPM = 140;

// Oscilloscope canvas setup
const oscilloscopeCanvas = document.getElementById('oscilloscope-canvas');
const oscilloscopeCtx = oscilloscopeCanvas ? oscilloscopeCanvas.getContext('2d') : null;
const oscilloscopeContainer = oscilloscopeCanvas ? oscilloscopeCanvas.parentElement : null;

// Oscilloscope state
let timeDomainDataLeft = null; // Reusable Float32Array for left channel time-domain data (allocated in initializeAudioContext)
let timeDomainDataRight = null; // Reusable Float32Array for right channel time-domain data (allocated in initializeAudioContext)

// Multi-band time-domain data arrays (4 bands × 2 channels = 8 arrays)
let timeDomainDataSubL = null;
let timeDomainDataSubR = null;
let timeDomainDataLowL = null;
let timeDomainDataLowR = null;
let timeDomainDataMidL = null;
let timeDomainDataMidR = null;
let timeDomainDataHighL = null;
let timeDomainDataHighR = null;
let waveformBuffer = []; // Circular buffer for storing raw waveform samples (no downsampling)
let waveformColorBuffer = []; // Circular buffer for storing RGB color strings (parallel to waveformBuffer)
let waveformBufferSize = 0; // Maximum buffer size (calculated based on view duration)
let waveformWriteIndex = 0; // Current write position in circular buffer
let lastTimeDomainSampleIdx = 0; // Track which samples we've already added to buffer
const OSCILLOSCOPE_ASPECT_RATIO = 4; // 800x200 = 4:1

// Frequency band definitions for color calculation
const FREQ_BAND_LOWS_MIN = 20;    // 20 Hz
const FREQ_BAND_LOWS_MAX = 250;   // 250 Hz
const FREQ_BAND_MIDS_MIN = 250;   // 250 Hz
const FREQ_BAND_MIDS_MAX = 2500;  // 2.5 kHz
const FREQ_BAND_HIGHS_MIN = 2500; // 2.5 kHz
const FREQ_BAND_HIGHS_MAX = 20000; // 20 kHz

// Band Visualizer canvas setup
// Multi-band vector scope canvases (4-band)
const scopeSubCanvas = document.getElementById('scope-sub');
const scopeSubCtx = scopeSubCanvas ? scopeSubCanvas.getContext('2d') : null;
const scopeLowCanvas = document.getElementById('scope-low');
const scopeLowCtx = scopeLowCanvas ? scopeLowCanvas.getContext('2d') : null;
const scopeMidCanvas = document.getElementById('scope-mid');
const scopeMidCtx = scopeMidCanvas ? scopeMidCanvas.getContext('2d') : null;
const scopeHighCanvas = document.getElementById('scope-high');
const scopeHighCtx = scopeHighCanvas ? scopeHighCanvas.getContext('2d') : null;
const vectorScopeContainer = scopeSubCanvas ? scopeSubCanvas.parentElement?.parentElement : null;
const VECTOR_SCOPE_ASPECT_RATIO = 1.2; // 300x250 = 1.2:1 (approximate)

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
    if (!audioContext || !analyserLeft || !frequencyBinCount) {
        return;
    }
    
    const sampleRate = audioContext.sampleRate;
    const fftSize = analyserLeft.fftSize;
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

// EMA smoothing alpha values
// smoothedData uses fixed fast alpha (0.8) for responsive live view
// averageData uses variable alpha from slider for long-term average
const SMOOTHED_DATA_ALPHA = 0.8; // Fixed fast alpha for live data
let averageDataAlpha = 0.5; // Variable alpha for average data (controlled by slider)
let emaInitialized = false;
let averageDataInitialized = false;

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

// Chart layout margins - define the active draw area
const MARGIN_LEFT = 60;    // Space for dB labels on left
const MARGIN_BOTTOM = 30;  // Space for frequency labels at bottom
const MARGIN_TOP = 20;     // Space at top
const MARGIN_RIGHT = 20;   // Space on right

// Legacy constants for backward compatibility (will be removed after refactoring)
const CANVAS_PADDING_TOP = MARGIN_TOP;
const CANVAS_PADDING_BOTTOM = MARGIN_BOTTOM;
const CANVAS_PADDING_LEFT = MARGIN_LEFT;
const CANVAS_PADDING_RIGHT = MARGIN_RIGHT;

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
    
    // Map to active draw area (accounting for left and right margins)
    const activeWidth = width - MARGIN_LEFT - MARGIN_RIGHT;
    return MARGIN_LEFT + normalized * activeWidth;
}

/**
 * Map an X coordinate to a frequency using inverse logarithmic scale
 * This is the inverse of frequencyToX()
 * @param {number} x - X coordinate in pixels
 * @param {number} width - Canvas width in pixels
 * @returns {number} Frequency in Hz
 */
function xToFrequency(x, width) {
    // Account for left and right margins
    const activeWidth = width - MARGIN_LEFT - MARGIN_RIGHT;
    
    // Get position in active draw area (0 to activeWidth)
    const xInActiveArea = x - MARGIN_LEFT;
    
    // Normalize to 0-1 range
    const normalized = activeWidth > 0 ? xInActiveArea / activeWidth : 0;
    
    // Clamp normalized value to valid range
    const clampedNormalized = Math.max(0, Math.min(1, normalized));
    
    // Inverse logarithmic mapping: freq = min * (max/min)^normalized
    // Using log10 for consistency with frequencyToX:
    // log10(freq) = log10(MIN_FREQ) + normalized * (log10(MAX_FREQ) - log10(MIN_FREQ))
    const logMin = Math.log10(MIN_FREQ);
    const logMax = Math.log10(MAX_FREQ);
    const logFreq = logMin + clampedNormalized * (logMax - logMin);
    const freq = Math.pow(10, logFreq);
    
    return freq;
}

/**
 * Get the FFT bin index for a given frequency
 * @param {number} frequency - Frequency in Hz
 * @param {number} fftSize - FFT size (e.g., 32768)
 * @returns {number} Bin index (0 to fftSize/2 - 1)
 */
function getBinIndex(frequency, fftSize) {
    if (!audioContext) {
        return 0;
    }
    
    const sampleRate = getSampleRate();
    const binCount = fftSize / 2;
    
    // Formula: binIndex = (frequency * fftSize) / sampleRate
    const binIndex = Math.floor((frequency * fftSize) / sampleRate);
    
    // Clamp to valid bin range [0, binCount)
    return Math.max(0, Math.min(binCount - 1, binIndex));
}

/**
 * Map a dB value to a Y coordinate on the canvas
 * @param {number} db - dB value (typically -100 to 0, or -Infinity for silence)
 * @param {number} height - Canvas height in pixels
 * @returns {number} Y coordinate (accounting for top and bottom padding)
 */
function dbToY(db, height) {
    // Handle -Infinity (silence) - map to bottom of active draw area
    if (!isFinite(db) || db === -Infinity) {
        return height - MARGIN_BOTTOM;
    }
    
    // Clamp dB to valid range
    const clampedDb = Math.max(MIN_DB, Math.min(MAX_DB, db));
    
    // Normalize dB to 0-1 range (inverted: higher dB = lower Y)
    const normalized = (clampedDb - MIN_DB) / (MAX_DB - MIN_DB);
    
    // Map to active draw area (accounting for top and bottom margins, inverted: 0 at top, height at bottom)
    const activeHeight = height - MARGIN_TOP - MARGIN_BOTTOM;
    return MARGIN_TOP + (1 - normalized) * activeHeight;
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
        
        // Create left and right channel analysers (for spectrum visualization)
        analyserLeft = audioContext.createAnalyser();
        analyserRight = audioContext.createAnalyser();
        
        // Read initial FFT size from dropdown, or default to 4096
        let initialFFTSize = 4096; // Default
        if (fftSizeSelect && fftSizeSelect.value) {
            initialFFTSize = parseInt(fftSizeSelect.value, 10);
            if (!isFinite(initialFFTSize) || initialFFTSize < 32) {
                console.warn('Invalid FFT size from dropdown, using default 4096');
                initialFFTSize = 4096;
            }
        }
        
        // Set FFT size for spectrum visualization
        analyserLeft.fftSize = initialFFTSize;
        analyserRight.fftSize = initialFFTSize;
        
        // Calculate frequency bin count (fftSize / 2)
        frequencyBinCount = analyserLeft.frequencyBinCount;
        
        // Allocate FFT data arrays (using left channel for spectrum visualization)
        fftData = new Float32Array(frequencyBinCount);
        smoothedData = new Float32Array(frequencyBinCount); // Fast/Live data
        averageData = new Float32Array(frequencyBinCount);  // Long-term average data
        
        // Allocate reusable time-domain data arrays for both channels (reused every frame to avoid allocations)
        timeDomainDataLeft = new Float32Array(analyserLeft.fftSize);
        timeDomainDataRight = new Float32Array(analyserRight.fftSize);
        
        // Set analyser alias for backward compatibility
        analyser = analyserLeft;
        
        // Create multi-band analysers (4 bands × 2 channels = 8 analysers)
        analyserSubL = audioContext.createAnalyser();
        analyserSubR = audioContext.createAnalyser();
        analyserLowL = audioContext.createAnalyser();
        analyserLowR = audioContext.createAnalyser();
        analyserMidL = audioContext.createAnalyser();
        analyserMidR = audioContext.createAnalyser();
        analyserHighL = audioContext.createAnalyser();
        analyserHighR = audioContext.createAnalyser();
        
        // Set fftSize for multi-band analysers (2048 or 4096 for good performance)
        const multiBandFftSize = 4096;
        analyserSubL.fftSize = multiBandFftSize;
        analyserSubR.fftSize = multiBandFftSize;
        analyserLowL.fftSize = multiBandFftSize;
        analyserLowR.fftSize = multiBandFftSize;
        analyserMidL.fftSize = multiBandFftSize;
        analyserMidR.fftSize = multiBandFftSize;
        analyserHighL.fftSize = multiBandFftSize;
        analyserHighR.fftSize = multiBandFftSize;
        
        // Allocate reusable time-domain data arrays for multi-band analysers
        timeDomainDataSubL = new Float32Array(analyserSubL.fftSize);
        timeDomainDataSubR = new Float32Array(analyserSubR.fftSize);
        timeDomainDataLowL = new Float32Array(analyserLowL.fftSize);
        timeDomainDataLowR = new Float32Array(analyserLowR.fftSize);
        timeDomainDataMidL = new Float32Array(analyserMidL.fftSize);
        timeDomainDataMidR = new Float32Array(analyserMidR.fftSize);
        timeDomainDataHighL = new Float32Array(analyserHighL.fftSize);
        timeDomainDataHighR = new Float32Array(analyserHighR.fftSize);
        
        // Initialize smoothed data array (will be populated on first update)
        
        // Initialize waveform buffer size
        updateWaveformBufferSize();
        
        // Compute bin indices for each band
        computeBandBinIndices();
    }
    return { 
        audioContext, 
        analyserLeft, 
        analyserRight,
        analyserSubL,
        analyserSubR,
        analyserLowL,
        analyserLowR,
        analyserMidL,
        analyserMidR,
        analyserHighL,
        analyserHighR
    };
}

/**
 * Update FFT size for spectrum visualization
 * Re-allocates all data arrays and resets state to prevent mismatches
 * @param {number} newSize - New FFT size (must be power of 2, typically 512, 1024, 2048, 4096, etc.)
 */
function updateFFTSize(newSize) {
    if (!analyserLeft || !analyserRight || !audioContext) {
        console.warn('Cannot update FFT size: analysers not initialized');
        return;
    }
    
    // Validate FFT size (must be power of 2 and within valid range)
    if (!isFinite(newSize) || newSize < 32 || newSize > 32768) {
        console.warn(`Invalid FFT size: ${newSize}, must be between 32 and 32768`);
        return;
    }
    
    // Check if it's a power of 2
    if ((newSize & (newSize - 1)) !== 0) {
        console.warn(`FFT size ${newSize} is not a power of 2, rounding may occur`);
    }
    
    console.log(`Updating FFT size from ${analyserLeft.fftSize} to ${newSize}`);
    
    // Update analyser FFT sizes
    analyserLeft.fftSize = newSize;
    analyserRight.fftSize = newSize;
    
    // Update analyser alias for backward compatibility
    analyser = analyserLeft;
    
    // Update global frequency bin count
    frequencyBinCount = analyserLeft.frequencyBinCount;
    
    // Re-allocate FFT data arrays with new lengths
    fftData = new Float32Array(frequencyBinCount);
    smoothedData = new Float32Array(frequencyBinCount); // Fast/Live data
    averageData = new Float32Array(frequencyBinCount);  // Long-term average data
    
    // Re-allocate time-domain data arrays
    timeDomainDataLeft = new Float32Array(analyserLeft.fftSize);
    timeDomainDataRight = new Float32Array(analyserRight.fftSize);
    
    // Re-compute band bin indices for the new FFT size
    computeBandBinIndices();
    
    // Reset state flags to prevent data mismatches
    emaInitialized = false;
    averageDataInitialized = false;
    
    console.log(`FFT size updated successfully. New frequencyBinCount: ${frequencyBinCount}`);
}

/**
 * Set up test audio file playback
 * @param {string} audioPath - Path to the audio file
 */
function setupTestAudio(audioPath) {
    // Clean up previous audio source if it exists
    cleanupTestAudio();
    
    // Initialize audio context if needed
            const {
                audioContext: ctx,
                analyserLeft: analLeft,
                analyserRight: analRight,
                analyserSubL: analSubL,
                analyserSubR: analSubR,
                analyserLowL: analLowL,
                analyserLowR: analLowR,
                analyserMidL: analMidL,
                analyserMidR: analMidR,
                analyserHighL: analHighL,
                analyserHighR: analHighR
            } = initializeAudioContext();
    
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
            
            // Create ChannelSplitterNode to split stereo channels
            channelSplitter = ctx.createChannelSplitter(2);
            
            // IMPORTANT: When using MediaElementAudioSourceNode, the audio element
            // should NOT be connected to its default destination. The source node
            // handles the connection.
            // Connect: audio source → splitter
            audioSource.connect(channelSplitter);
            
            // ===== CREATE 4-BAND CROSSOVER FILTERS =====
            // Left channel filters
            
            // Sub Band: Lowpass @ CROSSOVER_SUB_LOW (120Hz)
            filterSubL = ctx.createBiquadFilter();
            filterSubL.type = 'lowpass';
            filterSubL.frequency.value = CROSSOVER_SUB_LOW;
            
            // Low Band: Highpass @ CROSSOVER_SUB_LOW -> Lowpass @ CROSSOVER_LOW_MID
            filterLowL = ctx.createBiquadFilter();
            filterLowL.type = 'highpass';
            filterLowL.frequency.value = CROSSOVER_SUB_LOW;
            filterLowL_LP = ctx.createBiquadFilter();
            filterLowL_LP.type = 'lowpass';
            filterLowL_LP.frequency.value = CROSSOVER_LOW_MID;
            filterLowL.connect(filterLowL_LP);
            
            // Mid Band: Highpass @ CROSSOVER_LOW_MID -> Lowpass @ CROSSOVER_MID_HIGH
            filterMidL = ctx.createBiquadFilter();
            filterMidL.type = 'highpass';
            filterMidL.frequency.value = CROSSOVER_LOW_MID;
            filterMidL_LP = ctx.createBiquadFilter();
            filterMidL_LP.type = 'lowpass';
            filterMidL_LP.frequency.value = CROSSOVER_MID_HIGH;
            filterMidL.connect(filterMidL_LP);
            
            // High Band: Highpass @ CROSSOVER_MID_HIGH (2500Hz)
            filterHighL = ctx.createBiquadFilter();
            filterHighL.type = 'highpass';
            filterHighL.frequency.value = CROSSOVER_MID_HIGH;
            
            // Right channel filters (same structure as left)
            
            // Sub Band: Lowpass @ CROSSOVER_SUB_LOW (120Hz)
            filterSubR = ctx.createBiquadFilter();
            filterSubR.type = 'lowpass';
            filterSubR.frequency.value = CROSSOVER_SUB_LOW;
            
            // Low Band: Highpass @ CROSSOVER_SUB_LOW -> Lowpass @ CROSSOVER_LOW_MID
            filterLowR = ctx.createBiquadFilter();
            filterLowR.type = 'highpass';
            filterLowR.frequency.value = CROSSOVER_SUB_LOW;
            filterLowR_LP = ctx.createBiquadFilter();
            filterLowR_LP.type = 'lowpass';
            filterLowR_LP.frequency.value = CROSSOVER_LOW_MID;
            filterLowR.connect(filterLowR_LP);
            
            // Mid Band: Highpass @ CROSSOVER_LOW_MID -> Lowpass @ CROSSOVER_MID_HIGH
            filterMidR = ctx.createBiquadFilter();
            filterMidR.type = 'highpass';
            filterMidR.frequency.value = CROSSOVER_LOW_MID;
            filterMidR_LP = ctx.createBiquadFilter();
            filterMidR_LP.type = 'lowpass';
            filterMidR_LP.frequency.value = CROSSOVER_MID_HIGH;
            filterMidR.connect(filterMidR_LP);
            
            // High Band: Highpass @ CROSSOVER_MID_HIGH (2500Hz)
            filterHighR = ctx.createBiquadFilter();
            filterHighR.type = 'highpass';
            filterHighR.frequency.value = CROSSOVER_MID_HIGH;
            
            // ===== CONNECT SPLITTER TO FILTERS =====
            // Left channel (output 0) → filters
            channelSplitter.connect(filterSubL, 0);
            channelSplitter.connect(filterLowL, 0);
            channelSplitter.connect(filterMidL, 0);
            channelSplitter.connect(filterHighL, 0);
            
            // Right channel (output 1) → filters
            channelSplitter.connect(filterSubR, 1);
            channelSplitter.connect(filterLowR, 1);
            channelSplitter.connect(filterMidR, 1);
            channelSplitter.connect(filterHighR, 1);
            
            // ===== CONNECT FILTERS TO ANALYSERS =====
            // Left channel filters → analysers
            filterSubL.connect(analSubL);
            filterLowL_LP.connect(analLowL);  // Connect the lowpass stage of Low band
            filterMidL_LP.connect(analMidL);  // Connect the lowpass stage of Mid band
            filterHighL.connect(analHighL);
            
            // Right channel filters → analysers
            filterSubR.connect(analSubR);
            filterLowR_LP.connect(analLowR);  // Connect the lowpass stage of Low band
            filterMidR_LP.connect(analMidR);  // Connect the lowpass stage of Mid band
            filterHighR.connect(analHighR);
            
            // ===== CONNECT TO SPECTRUM ANALYSERS =====
            // Also connect splitter outputs to analyserLeft/analyserRight for spectrum visualization
            channelSplitter.connect(analLeft, 0);
            channelSplitter.connect(analRight, 1);
            
            // ===== CONNECT TO AUDIO OUTPUT =====
            // Connect source to destination for audio playback (maintains full stereo output)
            audioSource.connect(ctx.destination);
            
            // Verify connection
            console.log('Audio node connections:', {
                sourceConnected: audioSource.numberOfOutputs > 0,
                splitterCreated: !!channelSplitter,
                filtersCreated: {
                    left: { sub: !!filterSubL, low: !!filterLowL, mid: !!filterMidL, high: !!filterHighL },
                    right: { sub: !!filterSubR, low: !!filterLowR, mid: !!filterMidR, high: !!filterHighR }
                },
                analyserLeftConnected: analLeft.numberOfInputs > 0 && analLeft.numberOfOutputs > 0,
                analyserRightConnected: analRight.numberOfInputs > 0 && analRight.numberOfOutputs > 0,
                multiBandAnalysersConnected: {
                    subL: analSubL.numberOfInputs > 0,
                    subR: analSubR.numberOfInputs > 0,
                    lowL: analLowL.numberOfInputs > 0,
                    lowR: analLowR.numberOfInputs > 0,
                    midL: analMidL.numberOfInputs > 0,
                    midR: analMidR.numberOfInputs > 0,
                    highL: analHighL.numberOfInputs > 0,
                    highR: analHighR.numberOfInputs > 0
                },
                destinationConnected: ctx.destination.numberOfInputs > 0
            });
            
            // Store reference
            currentAudioSource = audioSource;
            
            console.log('Audio source node created successfully with 4-band crossover routing', {
                analyserLeftFftSize: analLeft.fftSize,
                analyserRightFftSize: analRight.fftSize,
                multiBandFftSize: analSubL.fftSize,
                frequencyBinCount: analLeft.frequencyBinCount,
                sampleRate: ctx.sampleRate,
                audioContextState: ctx.state,
                crossoverFrequencies: {
                    subLow: CROSSOVER_SUB_LOW,
                    lowMid: CROSSOVER_LOW_MID,
                    midHigh: CROSSOVER_MID_HIGH
                },
                bandRanges: {
                    sub: `0-${CROSSOVER_SUB_LOW}Hz`,
                    low: `${CROSSOVER_SUB_LOW}-${CROSSOVER_LOW_MID}Hz`,
                    mid: `${CROSSOVER_LOW_MID}-${CROSSOVER_MID_HIGH}Hz`,
                    high: `${CROSSOVER_MID_HIGH}Hz+`
                }
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
    console.log('Full URL will be:', window.location.origin + '/' + encodedPath);
    
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
    
    // Reset EMA initialization flags for fresh start
    emaInitialized = false;
    averageDataInitialized = false;
    
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
    
    // Disconnect and reset channel splitter reference
    if (channelSplitter) {
        try {
            channelSplitter.disconnect();
        } catch (e) {
            // Ignore disconnect errors (node may already be disconnected)
        }
        channelSplitter = null;
    }
    
    // Disconnect and reset crossover filter references
    const filters = [
        filterSubL, filterSubR,
        filterLowL, filterLowR, filterLowL_LP, filterLowR_LP,
        filterMidL, filterMidR, filterMidL_LP, filterMidR_LP,
        filterHighL, filterHighR
    ];
    filters.forEach(filter => {
        if (filter) {
            try {
                filter.disconnect();
            } catch (e) {
                // Ignore disconnect errors
            }
        }
    });
    
    // Reset filter references
    filterSubL = null;
    filterSubR = null;
    filterLowL = null;
    filterLowR = null;
    filterLowL_LP = null;
    filterLowR_LP = null;
    filterMidL = null;
    filterMidR = null;
    filterMidL_LP = null;
    filterMidR_LP = null;
    filterHighL = null;
    filterHighR = null;
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
 * Calculates how many samples are needed to store the requested time duration
 */
function updateWaveformBufferSize() {
    if (!analyserLeft || !audioContext) return;
    
    const bpm = HARDCODED_BPM;
    const bars = parseInt(viewLengthSelect.value) || 4;
    const viewDuration = calculateViewDuration(bpm, bars);
    
    const sampleRate = getSampleRate();
    
    // Calculate how many samples we need to store for the view duration
    const totalSamplesNeeded = Math.ceil(viewDuration * sampleRate);
    
    // Buffer size should be at least the number of samples needed
    // Add some headroom to ensure smooth scrolling
    waveformBufferSize = Math.max(1024, totalSamplesNeeded);
    
    // Resize buffers if needed
    if (waveformBuffer.length !== waveformBufferSize) {
        const oldBuffer = waveformBuffer;
        const oldColorBuffer = waveformColorBuffer;
        waveformBuffer = new Array(waveformBufferSize).fill(0);
        waveformColorBuffer = new Array(waveformBufferSize).fill('#808080'); // Default gray color
        
        // Copy old data if buffer is growing (preserve recent history)
        if (oldBuffer.length > 0) {
            const copyLength = Math.min(oldBuffer.length, waveformBufferSize);
            const oldStart = Math.max(0, oldBuffer.length - copyLength);
            for (let i = 0; i < copyLength; i++) {
                waveformBuffer[waveformBufferSize - copyLength + i] = oldBuffer[oldStart + i];
                waveformColorBuffer[waveformBufferSize - copyLength + i] = oldColorBuffer[oldStart + i] || '#808080';
            }
        }
        
        // Reset write index if buffer shrunk significantly
        if (waveformBufferSize < oldBuffer.length) {
            waveformWriteIndex = 0;
        }
    }
    
    console.log('Waveform buffer updated:', {
        viewDuration: viewDuration.toFixed(3) + 's',
        bars: bars,
        sampleRate: sampleRate,
        bufferSize: waveformBufferSize,
        samplesNeeded: totalSamplesNeeded
    });
}

/**
 * Calculate frequency band energy and convert to RGB color
 * @param {Float32Array} fftData - Current FFT frequency data in dB
 * @param {number} fftSize - FFT size
 * @returns {string} RGB color string (e.g., "rgb(255, 50, 100)")
 */
function calculateFrequencyColor(fftData, fftSize) {
    if (!fftData || !audioContext) {
        return 'rgb(128, 128, 128)'; // Default gray
    }
    
    const sampleRate = getSampleRate();
    const binCount = fftSize / 2;
    
    // Calculate bin indices for frequency bands
    const lowsStartBin = getBinIndex(FREQ_BAND_LOWS_MIN, fftSize);
    const lowsEndBin = getBinIndex(FREQ_BAND_LOWS_MAX, fftSize);
    const midsStartBin = getBinIndex(FREQ_BAND_MIDS_MIN, fftSize);
    const midsEndBin = getBinIndex(FREQ_BAND_MIDS_MAX, fftSize);
    const highsStartBin = getBinIndex(FREQ_BAND_HIGHS_MIN, fftSize);
    const highsEndBin = getBinIndex(FREQ_BAND_HIGHS_MAX, fftSize);
    
    // Calculate energy in each band (convert dB to linear, sum, then back to dB)
    let lowsEnergy = 0;
    let midsEnergy = 0;
    let highsEnergy = 0;
    let lowsCount = 0;
    let midsCount = 0;
    let highsCount = 0;
    
    for (let i = 0; i < fftData.length; i++) {
        const dbValue = fftData[i];
        if (!isFinite(dbValue) || dbValue === -Infinity) {
            continue;
        }
        
        // Convert dB to linear scale for energy calculation
        const linearValue = Math.pow(10, dbValue / 20);
        const energy = linearValue * linearValue;
        
        if (i >= lowsStartBin && i <= lowsEndBin) {
            lowsEnergy += energy;
            lowsCount++;
        } else if (i >= midsStartBin && i <= midsEndBin) {
            midsEnergy += energy;
            midsCount++;
        } else if (i >= highsStartBin && i <= highsEndBin) {
            highsEnergy += energy;
            highsCount++;
        }
    }
    
    // Calculate average energy per band (avoid division by zero)
    const lowsAvg = lowsCount > 0 ? lowsEnergy / lowsCount : 0;
    const midsAvg = midsCount > 0 ? midsEnergy / midsCount : 0;
    const highsAvg = highsCount > 0 ? highsEnergy / highsCount : 0;
    
    // Total energy for normalization
    const totalEnergy = lowsAvg + midsAvg + highsAvg;
    
    // Normalize band energies (0.0 to 1.0)
    let lowsNorm = 0, midsNorm = 0, highsNorm = 0;
    
    if (totalEnergy > 0) {
        lowsNorm = lowsAvg / totalEnergy;
        midsNorm = midsAvg / totalEnergy;
        highsNorm = highsAvg / totalEnergy;
    }
    
    // Map to Cool Color Palette (Blues, Cyans, Whites)
    // Formula:
    // R = highsNorm * 255  (Highs -> Red channel: High Treble + Cyan + Blue = White)
    // G = midsNorm * 255   (Mids -> Green channel: High Mids -> Cyan)
    // B = 150 + (lowsNorm * 105)  (Base Blue 150 + Lows contribution: Bass-heavy -> Deep Blue)
    
    // Clamp normalized values to [0, 1] for safety
    lowsNorm = Math.max(0, Math.min(1, lowsNorm));
    midsNorm = Math.max(0, Math.min(1, midsNorm));
    highsNorm = Math.max(0, Math.min(1, highsNorm));
    
    // Calculate RGB values
    const r = Math.floor(highsNorm * 255);
    const g = Math.floor(midsNorm * 255);
    const b = Math.floor(150 + (lowsNorm * 105)); // Base blue of 150, plus lows up to 255
    
    // Clamp RGB values to valid range [0, 255]
    const clampedR = Math.max(0, Math.min(255, r));
    const clampedG = Math.max(0, Math.min(255, g));
    const clampedB = Math.max(0, Math.min(255, b));
    
    return `rgb(${clampedR}, ${clampedG}, ${clampedB})`;
}

/**
 * Get color from circular buffer at a given index (handles wrapping)
 * @param {number} index - Index in the circular buffer
 * @returns {string} RGB color string
 */
function getBufferColor(index) {
    // Handle negative indices and wrap around
    while (index < 0) {
        index += waveformBufferSize;
    }
    index = index % waveformBufferSize;
    return waveformColorBuffer[index] || 'rgb(128, 128, 128)';
}

/**
 * Update waveform buffer with new time-domain data and calculate colors from frequency data
 * Supports mono sum mode for phase cancellation visualization
 */
function updateWaveform() {
    if (!analyserLeft || !analyserRight || !timeDomainDataLeft || !timeDomainDataRight || waveformBufferSize === 0 || !fftData) return;
    
    // Get time-domain data for both channels (raw audio samples) - reuse the same arrays
    analyserLeft.getFloatTimeDomainData(timeDomainDataLeft);
    analyserRight.getFloatTimeDomainData(timeDomainDataRight);
    
    // Read checkbox state for mono sum mode
    const useMonoSum = monoScopeCheck && monoScopeCheck.checked;
    
    // Estimate: at 60fps, we get ~800 new samples per frame at 48kHz
    // Add samples from the last portion of time-domain data
    const samplesToAdd = Math.min(1024, timeDomainDataLeft.length);
    const startIdx = Math.max(0, timeDomainDataLeft.length - samplesToAdd);
    
    // Iterate through new samples and add to circular buffer
    for (let i = startIdx; i < timeDomainDataLeft.length; i++) {
        let sample;
        
        if (useMonoSum) {
            // Mono Mode: Calculate mono sum (left + right) / 2
            // This helps visualize phase cancellation:
            // If mono sum is quieter than individual channels, there's phase cancellation
            const left = timeDomainDataLeft[i];
            const right = timeDomainDataRight[i];
            
            if (isFinite(left) && isFinite(right)) {
                sample = (left + right) / 2;
            } else if (isFinite(left)) {
                sample = left;
            } else if (isFinite(right)) {
                sample = right;
            } else {
                sample = 0; // Both invalid, use zero
            }
        } else {
            // Normal Mode: Use left channel only
            sample = timeDomainDataLeft[i];
        }
        
        // Push calculated sample into waveform buffer
        // Color is now calculated dynamically in drawOscilloscope based on amplitude
        waveformBuffer[waveformWriteIndex] = sample;
        waveformWriteIndex = (waveformWriteIndex + 1) % waveformBufferSize;
    }
}

/**
 * Calculate Pearson correlation coefficient between two audio buffers
 * Measures phase correlation: -1 (180° out of phase) to +1 (perfect mono)
 * @param {Float32Array} leftBuffer - Left channel time-domain data
 * @param {Float32Array} rightBuffer - Right channel time-domain data
 * @returns {number} Correlation coefficient (-1 to +1)
 */
function calculateCorrelation(leftBuffer, rightBuffer) {
    if (!leftBuffer || !rightBuffer || leftBuffer.length === 0 || rightBuffer.length === 0) {
        return 0;
    }
    
    const minLength = Math.min(leftBuffer.length, rightBuffer.length);
    if (minLength === 0) {
        return 0;
    }
    
    // Calculate sums for Pearson correlation coefficient
    let sumLR = 0;  // Sum of (L[i] * R[i])
    let sumL2 = 0;  // Sum of (L[i]^2)
    let sumR2 = 0;  // Sum of (R[i]^2)
    
    for (let i = 0; i < minLength; i++) {
        const left = leftBuffer[i];
        const right = rightBuffer[i];
        
        // Skip invalid samples
        if (!isFinite(left) || !isFinite(right)) {
            continue;
        }
        
        sumLR += left * right;
        sumL2 += left * left;
        sumR2 += right * right;
    }
    
    // Calculate denominator: sqrt(Sum(L[i]^2)) * sqrt(Sum(R[i]^2))
    const denominator = Math.sqrt(sumL2) * Math.sqrt(sumR2);
    
    // Avoid division by zero
    if (denominator === 0 || !isFinite(denominator)) {
        return 0;
    }
    
    // Pearson correlation coefficient: Sum(L[i] * R[i]) / (sqrt(Sum(L[i]^2)) * sqrt(Sum(R[i]^2)))
    const correlation = sumLR / denominator;
    
    // Clamp to valid range [-1, 1]
    return Math.max(-1, Math.min(1, correlation));
}

/**
 * Get phase correlation color and glow style based on correlation value and band type
 * @param {number} correlation - Correlation coefficient (-1 to +1)
 * @param {string} bandType - Band type: 'low', 'mid', or 'high'
 * @returns {Object} Object with `color` (CSS color string) and `glow` (CSS box-shadow string)
 */
function getPhaseColor(correlation, bandType) {
    if (!isFinite(correlation)) {
        return { color: '#6b7280', glow: '0 0 0px rgba(107, 114, 128, 0)' }; // gray-500, no glow
    }
    
    let color;
    let glowColor;
    let glowIntensity;
    
    // Define thresholds and colors based on band type
    if (bandType === 'sub') {
        // Sub band: Green if > 0.95, Yellow > 0.8, else Red
        // Sub frequencies are typically very mono, so use stricter thresholds
        if (correlation > 0.95) {
            color = '#22c55e'; // green-500
            glowColor = 'rgba(34, 197, 94, 0.8)'; // green-500 with alpha
            glowIntensity = 8;
        } else if (correlation > 0.8) {
            color = '#eab308'; // yellow-500
            glowColor = 'rgba(234, 179, 8, 0.6)'; // yellow-500 with alpha
            glowIntensity = 6;
        } else {
            color = '#ef4444'; // red-500
            glowColor = 'rgba(239, 68, 68, 0.4)'; // red-500 with alpha
            glowIntensity = 4;
        }
    } else if (bandType === 'low') {
        // Low band: Green if > 0.9, Yellow > 0.7, else Red
        if (correlation > 0.9) {
            color = '#22c55e'; // green-500
            glowColor = 'rgba(34, 197, 94, 0.8)'; // green-500 with alpha
            glowIntensity = 8;
        } else if (correlation > 0.7) {
            color = '#eab308'; // yellow-500
            glowColor = 'rgba(234, 179, 8, 0.6)'; // yellow-500 with alpha
            glowIntensity = 6;
        } else {
            color = '#ef4444'; // red-500
            glowColor = 'rgba(239, 68, 68, 0.4)'; // red-500 with alpha
            glowIntensity = 4;
        }
    } else if (bandType === 'mid') {
        // Mid band: Green if > 0.5, Yellow > 0.0, else Red
        if (correlation > 0.5) {
            color = '#22c55e'; // green-500
            glowColor = 'rgba(34, 197, 94, 0.8)'; // green-500 with alpha
            glowIntensity = 8;
        } else if (correlation > 0.0) {
            color = '#eab308'; // yellow-500
            glowColor = 'rgba(234, 179, 8, 0.6)'; // yellow-500 with alpha
            glowIntensity = 6;
        } else {
            color = '#ef4444'; // red-500
            glowColor = 'rgba(239, 68, 68, 0.4)'; // red-500 with alpha
            glowIntensity = 4;
        }
    } else if (bandType === 'high') {
        // High band: Green if > 0.0, Yellow > -0.5, else Red
        if (correlation > 0.0) {
            color = '#22c55e'; // green-500
            glowColor = 'rgba(34, 197, 94, 0.8)'; // green-500 with alpha
            glowIntensity = 8;
        } else if (correlation > -0.5) {
            color = '#eab308'; // yellow-500
            glowColor = 'rgba(234, 179, 8, 0.6)'; // yellow-500 with alpha
            glowIntensity = 6;
        } else {
            color = '#ef4444'; // red-500
            glowColor = 'rgba(239, 68, 68, 0.4)'; // red-500 with alpha
            glowIntensity = 4;
        }
    } else {
        // Default fallback
        color = '#6b7280'; // gray-500
        glowColor = 'rgba(107, 114, 128, 0)'; // gray-500, no glow
        glowIntensity = 0;
    }
    
    // Create glow style string (box-shadow)
    const glow = `0 0 ${glowIntensity}px ${glowColor}`;
    
    return { color, glow };
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
 * Draw the amplitude axis with dBFS tick marks
 * Shows -INF at center line and one reference line at 0 dBFS (full scale)
 * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 */
function drawAmplitudeAxis(ctx, width, height) {
    if (!ctx) return;
    
    const centerY = height / 2;
    const waveformHeight = height * 0.4; // 80% of height for waveform (40% above and below center)
    
    // Clear canvas
    ctx.fillStyle = '#030712'; // gray-950
    ctx.fillRect(0, 0, width, height);
    
    // Set up drawing style (matching existing UI)
    ctx.strokeStyle = '#4b5563'; // gray-600
    ctx.lineWidth = 1;
    ctx.font = '11px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#9ca3af'; // gray-400
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    // Draw center line (-INF at 0 amplitude)
    const tickStartX = 2; // Start 2px from left edge
    const tickEndX = width - 2; // End 2px from right edge
    
    ctx.strokeStyle = 'rgba(107, 114, 128, 0.5)'; // gray-500 with transparency
    ctx.beginPath();
    ctx.moveTo(tickStartX, centerY);
    ctx.lineTo(tickEndX, centerY);
    ctx.stroke();
    
    // Draw -INF label at center
    const centerLabel = '-INF';
    const labelX = 4; // Position label 4px from left edge
    const centerTextHeight = 12;
    const centerPadding = 2;
    
    // Measure text to ensure it fits
    const centerTextMetrics = ctx.measureText(centerLabel);
    const centerTextWidth = centerTextMetrics.width;
    
    // Draw label background (ensure it doesn't exceed canvas width)
    const bgWidth = Math.min(centerTextWidth + centerPadding * 2, width - labelX - 2);
    ctx.fillStyle = 'rgba(3, 7, 18, 0.7)'; // gray-950 with transparency
    ctx.fillRect(
        labelX,
        centerY - centerTextHeight / 2 - 1,
        bgWidth,
        centerTextHeight + 2
    );
    
    // Draw center label text
    ctx.fillStyle = '#9ca3af'; // gray-400
    ctx.fillText(centerLabel, labelX + centerPadding, centerY);
    
    // Draw reference line at 0 dBFS (full scale, top of waveform area)
    // 0 dBFS = amplitude 1.0, maps to top: centerY - waveformHeight
    const referenceY = centerY - waveformHeight;
    
    ctx.strokeStyle = '#4b5563'; // gray-600
    ctx.beginPath();
    ctx.moveTo(tickStartX, referenceY);
    ctx.lineTo(tickEndX, referenceY);
    ctx.stroke();
    
    // Draw 0 dBFS label
    const referenceLabel = '0 dBFS';
    const referenceTextMetrics = ctx.measureText(referenceLabel);
    const referenceTextWidth = referenceTextMetrics.width;
    
    // Draw label background (ensure it doesn't exceed canvas width)
    const refBgWidth = Math.min(referenceTextWidth + centerPadding * 2, width - labelX - 2);
    ctx.fillStyle = 'rgba(3, 7, 18, 0.7)';
    ctx.fillRect(
        labelX,
        referenceY - centerTextHeight / 2 - 1,
        refBgWidth,
        centerTextHeight + 2
    );
    
    ctx.fillStyle = '#9ca3af';
    ctx.fillText(referenceLabel, labelX + centerPadding, referenceY);
    
    // Draw second reference line at 0 dBFS (full scale, bottom of waveform area)
    // 0 dBFS = amplitude 1.0, maps to bottom: centerY + waveformHeight
    const referenceYBottom = centerY + waveformHeight;
    
    ctx.strokeStyle = '#4b5563'; // gray-600
    ctx.beginPath();
    ctx.moveTo(tickStartX, referenceYBottom);
    ctx.lineTo(tickEndX, referenceYBottom);
    ctx.stroke();
    
    // Draw 0 dBFS label at bottom
    const refBgWidthBottom = Math.min(referenceTextWidth + centerPadding * 2, width - labelX - 2);
    ctx.fillStyle = 'rgba(3, 7, 18, 0.7)';
    ctx.fillRect(
        labelX,
        referenceYBottom - centerTextHeight / 2 - 1,
        refBgWidthBottom,
        centerTextHeight + 2
    );
    
    ctx.fillStyle = '#9ca3af';
    ctx.fillText(referenceLabel, labelX + centerPadding, referenceYBottom);
}

/**
 * Get sample from circular buffer at a given index (handles wrapping)
 * @param {number} index - Index in the circular buffer (can be negative or beyond buffer size)
 * @returns {number} Sample value
 */
function getBufferSample(index) {
    // Handle negative indices and wrap around
    while (index < 0) {
        index += waveformBufferSize;
    }
    index = index % waveformBufferSize;
    return waveformBuffer[index] || 0;
}

/**
 * Draw the oscilloscope waveform with Rekordbox-style multi-colored visualization
 * Draws vertical lines/rectangles with colors representing frequency content
 * Shows most recent data on the right, older data on the left
 * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
 * @param {AnalyserNode} analyser - Web Audio AnalyserNode (left channel for waveform display)
 * @param {number} canvasWidth - Canvas width in CSS pixels
 * @param {number} canvasHeight - Canvas height in CSS pixels
 */
function drawOscilloscope(ctx, analyser, canvasWidth, canvasHeight) {
    if (!ctx || !analyser || waveformBuffer.length === 0) {
        return;
    }
    
    // Calculate active draw area using same margins as spectrum
    const activeLeft = MARGIN_LEFT;
    const activeTop = MARGIN_TOP;
    const activeRight = canvasWidth - MARGIN_RIGHT;
    const activeBottom = canvasHeight - MARGIN_BOTTOM;
    const activeWidth = activeRight - activeLeft;
    const activeHeight = activeBottom - activeTop;
    
    // Map amplitude range (-1.0 to +1.0) to active area (activeBottom to activeTop)
    // +1.0 maps to activeTop (top of active area)
    // -1.0 maps to activeBottom (bottom of active area)
    // 0.0 maps to center
    const centerY = activeTop + activeHeight / 2;
    const amplitudeRange = activeHeight / 2; // Half the active height represents amplitude range from 0 to ±1.0
    
    const bufferLength = waveformBuffer.length;
    
    // Calculate how many samples to show based on view duration
    const bpm = HARDCODED_BPM;
    const bars = parseInt(viewLengthSelect.value) || 4;
    const viewDuration = calculateViewDuration(bpm, bars);
    const sampleRate = getSampleRate();
    const samplesToShow = Math.min(bufferLength, Math.ceil(viewDuration * sampleRate));
    
    // Calculate buffer index range to display
    // Newest sample is at writeIndex - 1 (most recent)
    // Oldest visible sample is at writeIndex - samplesToShow
    const newestBufferIdx = waveformWriteIndex - 1;
    const oldestBufferIdx = waveformWriteIndex - samplesToShow;
    
    // Clear entire canvas
    ctx.fillStyle = '#030712'; // gray-950
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    
    // ===== DRAW Y-AXIS LABELS AND GRID (Linear Amplitude Scale) =====
    ctx.save();
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    // Linear amplitude markers: +1.0 (top), +0.5, 0.0 (center), -0.5, -1.0 (bottom)
    const amplitudeMarkers = [
        { label: '+1.0', amplitude: 1.0 },
        { label: '+0.5', amplitude: 0.5 },
        { label: ' 0.0', amplitude: 0.0 },  // Center line (will be brighter)
        { label: '-0.5', amplitude: -0.5 },
        { label: '-1.0', amplitude: -1.0 },
    ];
    
    for (const marker of amplitudeMarkers) {
        // Map amplitude (-1.0 to +1.0) to Y coordinate (activeBottom to activeTop)
        // +1.0 -> activeTop, -1.0 -> activeBottom, 0.0 -> centerY
        const y = centerY - (marker.amplitude * amplitudeRange);
        const clampedY = Math.max(activeTop, Math.min(activeBottom, y));
        
        // Draw horizontal grid line across active area
        // Center line (0.0) is slightly brighter
        if (marker.amplitude === 0.0) {
            ctx.strokeStyle = 'rgba(75, 85, 99, 0.5)'; // Slightly brighter for center line
        } else {
            ctx.strokeStyle = 'rgba(75, 85, 99, 0.3)'; // gray-600 with transparency
        }
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(activeLeft, clampedY);
        ctx.lineTo(Math.min(activeRight, canvasWidth - 1), clampedY); // Ensure line doesn't extend past canvas
        ctx.stroke();
        
        // Draw label in left margin
        ctx.fillStyle = '#9ca3af'; // gray-400
        const labelX = 8; // Position in left margin
        ctx.fillText(marker.label, labelX, clampedY);
    }
    
    ctx.restore();
    
    // ===== DRAW WAVEFORM IN ACTIVE AREA =====
    // Save context and clip to active area
    ctx.save();
    ctx.beginPath();
    ctx.rect(activeLeft, activeTop, activeWidth, activeHeight);
    ctx.clip();
    
    // Draw waveform using Peak Sampling (scan all samples in pixel's time window)
    // Most recent data appears on the right, older data scrolls left
    // x=activeLeft (leftmost) = oldest visible data, x=activeRight-1 (rightmost) = newest data
    
    // Calculate samples per pixel for peak sampling
    const samplesPerPixel = samplesToShow / activeWidth;
    
    // Iterate through each pixel column in the active area
    for (let x = activeLeft; x < activeRight; x++) {
        // Calculate the normalized position (0.0 to 1.0) within the active area
        const normalizedX = activeWidth > 1 ? (x - activeLeft) / (activeWidth - 1) : 0;
        
        // Calculate the buffer index range for this pixel's time slice
        const centerBufferIdx = oldestBufferIdx + normalizedX * (newestBufferIdx - oldestBufferIdx);
        const startBufferIndex = Math.floor(centerBufferIdx - samplesPerPixel / 2);
        const endBufferIndex = Math.ceil(centerBufferIdx + samplesPerPixel / 2);
        
        // Find the peak (maximum absolute amplitude) in this pixel's time slice
        let maxAmplitude = 0;
        
        for (let bufferIdx = startBufferIndex; bufferIdx <= endBufferIndex; bufferIdx++) {
            const sample = getBufferSample(bufferIdx);
            
            // Calculate amplitude (absolute value)
            const amplitude = Math.abs(sample);
            
            // Track the peak
            if (amplitude > maxAmplitude) {
                maxAmplitude = amplitude;
            }
        }
        
        // Clamp maxAmplitude to valid range [0, 1]
        maxAmplitude = Math.max(0, Math.min(1, maxAmplitude));
        
        // Calculate amplitude-based color (matches Spectrogram's gradient style)
        // Normalized amplitude (0.0 to 1.0)
        const normalized = maxAmplitude;
        
        // Dynamic HSLA coloring:
        // Hue: shifts from Blue (210) to Cyan (190) as amplitude increases
        const hue = 210 - (normalized * 20);
        
        // Lightness: shifts from Dark (20) to Bright White (90) as amplitude increases
        const lightness = 20 + (normalized * 70);
        
        // Alpha: shifts from Transparent (0.6) to Opaque (1.0) as amplitude increases
        const alpha = 0.6 + (normalized * 0.4);
        
        // Create HSLA color string
        const color = `hsla(${hue}, 100%, ${lightness}%, ${alpha})`;
        
        // Calculate bar height based on peak amplitude
        const barHeight = maxAmplitude * amplitudeRange;
        
        // Draw symmetric vertical bar centered at centerY with amplitude-based color
        // This creates a solid "envelope" that looks much cleaner than a thin line
        ctx.fillStyle = color;
        ctx.fillRect(x, centerY - barHeight, 1, barHeight * 2);
    }
    
    // Restore context (removes clipping)
    ctx.restore();
}

/**
 * Draw the oscilloscope waveform (wrapper for compatibility)
 */
function drawOscilloscopeWrapper() {
    if (!oscilloscopeCtx || !oscilloscopeCanvas || waveformBuffer.length === 0) {
        return;
    }
    
    // Get CSS dimensions from canvas style or calculate from device pixels
    // canvas.width is in device pixels after resizeOscilloscopeCanvas is called
    const dpr = window.devicePixelRatio || 1;
    let cssWidth = oscilloscopeCanvas.width / dpr;
    let cssHeight = oscilloscopeCanvas.height / dpr;
    
    // If style width is set, use that (more reliable)
    if (oscilloscopeCanvas.style.width) {
        cssWidth = parseFloat(oscilloscopeCanvas.style.width);
    }
    if (oscilloscopeCanvas.style.height) {
        cssHeight = parseFloat(oscilloscopeCanvas.style.height);
    }
    
    drawOscilloscope(oscilloscopeCtx, analyserLeft, cssWidth, cssHeight);
}

/**
 * Resize oscilloscope canvas to match container size with HiDPI support
 */
function resizeOscilloscopeCanvas() {
    if (!oscilloscopeCanvas || !oscilloscopeContainer) return;
    
    // Get container dimensions (clientWidth/clientHeight already account for padding)
    const containerWidth = oscilloscopeContainer.clientWidth;
    const containerHeight = oscilloscopeContainer.clientHeight;
    
    // Calculate canvas CSS dimensions (single canvas fills container, accounting for padding)
    // The container has p-4 padding (16px on each side), so clientWidth already accounts for this
    let cssWidth = containerWidth;
    let cssHeight = containerWidth / OSCILLOSCOPE_ASPECT_RATIO;
    
    if (cssHeight > containerHeight) {
        cssHeight = containerHeight;
        cssWidth = containerHeight * OSCILLOSCOPE_ASPECT_RATIO;
    }
    
    // Ensure canvas doesn't exceed container bounds
    cssWidth = Math.min(cssWidth, containerWidth);
    cssHeight = Math.min(cssHeight, containerHeight);
    
    // Handle devicePixelRatio for HiDPI displays
    const dpr = window.devicePixelRatio || 1;
    
    // Set canvas internal resolution (device pixels)
    // Note: Setting width/height resets the context transform
    oscilloscopeCanvas.width = cssWidth * dpr;
    oscilloscopeCanvas.height = cssHeight * dpr;
    
    // Set canvas CSS size (logical pixels) - use explicit pixel values, not percentage
    oscilloscopeCanvas.style.width = cssWidth + 'px';
    oscilloscopeCanvas.style.height = cssHeight + 'px';
    oscilloscopeCanvas.style.maxWidth = '100%'; // Prevent overflow
    oscilloscopeCanvas.style.maxHeight = '100%'; // Prevent overflow
    
    // Reset transform and scale context to account for devicePixelRatio
    oscilloscopeCtx.setTransform(1, 0, 0, 1, 0, 0);
    oscilloscopeCtx.scale(dpr, dpr);
    
    // Update buffer size when canvas resizes
    updateWaveformBufferSize();
    
    // Redraw if we have data
    if (waveformBuffer.length > 0) {
        drawOscilloscopeWrapper();
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
/**
 * Draw Vector Scope (Lissajous curve) visualization
 * Rotated 45 degrees so Vertical = Mono, Horizontal = Stereo
 * Uses "Cool" color palette (Blue->Cyan->White) based on amplitude
 * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
 * @param {Float32Array} leftData - Left channel time-domain data
 * @param {Float32Array} rightData - Right channel time-domain data
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @param {string} color - CSS color string for border/glow (traffic light status) - NOT used for line color
 */
function drawScope(ctx, leftData, rightData, width, height, color) {
    if (!ctx || !leftData || !rightData || leftData.length === 0 || rightData.length === 0) {
        return;
    }
    
    const centerWidth = width / 2;
    const centerHeight = height / 2;
    
    // Scale factor to fit waveform in canvas (leave some margin)
    const scale = Math.min(width, height) * 0.4;
    
    // Phosphor persistence effect: semi-transparent black overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.fillRect(0, 0, width, height);
    
    // Draw center crosshair (subtle grid lines)
    ctx.strokeStyle = 'rgba(107, 114, 128, 0.2)'; // gray-500 with low opacity
    ctx.lineWidth = 1;
    
    // Vertical line (mono indicator)
    ctx.beginPath();
    ctx.moveTo(centerWidth, 0);
    ctx.lineTo(centerWidth, height);
    ctx.stroke();
    
    // Horizontal line (stereo indicator)
    ctx.beginPath();
    ctx.moveTo(0, centerHeight);
    ctx.lineTo(width, centerHeight);
    ctx.stroke();
    
    // ===== CALCULATE TOTAL BAND ENERGY (RMS) FOR COLOR =====
    // Calculate RMS (Root Mean Square) of both channels to determine overall amplitude
    let sumSquares = 0;
    let validSamples = 0;
    const minLength = Math.min(leftData.length, rightData.length);
    
    for (let i = 0; i < minLength; i++) {
        const left = leftData[i];
        const right = rightData[i];
        
        if (isFinite(left) && isFinite(right)) {
            // Average of both channels for mono representation
            const avg = (left + right) / 2;
            sumSquares += avg * avg;
            validSamples++;
        }
    }
    
    // Calculate RMS and normalize to [0, 1]
    const rms = validSamples > 0 ? Math.sqrt(sumSquares / validSamples) : 0;
    const normalized = Math.max(0, Math.min(1, rms)); // Clamp to [0, 1]
    
    // Generate "Cool" color palette based on amplitude (matches Oscilloscope style)
    // Hue: shifts from Blue (210) to Cyan (190) as amplitude increases
    const hue = 210 - (normalized * 20);
    
    // Lightness: shifts from Dark (20) to Bright White (90) as amplitude increases
    const lightness = 20 + (normalized * 70);
    
    // Alpha: shifts from Transparent (0.6) to Opaque (1.0) as amplitude increases
    const alpha = 0.6 + (normalized * 0.4);
    
    // Create HSLA color string for the scope line
    const coolColor = `hsla(${hue}, 100%, ${lightness}%, ${alpha})`;
    
    // ===== ADAPTIVE SAMPLING (AVOID SPIKES) =====
    // Calculate step size to draw ~800 points regardless of FFT size
    // This prevents the scope from becoming a jagged mess at high resolutions
    const step = Math.max(1, Math.floor(leftData.length / 800));
    
    // Set color for the trace (using "Cool" palette, not the traffic light color)
    ctx.fillStyle = coolColor;
    ctx.strokeStyle = coolColor;
    ctx.lineWidth = 1;
    
    // Draw Lissajous curve (rotated 45 degrees)
    // Draw points as small dots for cleaner look
    for (let i = 0; i < minLength; i += step) {
        const left = leftData[i];
        const right = rightData[i];
        
        // Skip invalid samples
        if (!isFinite(left) || !isFinite(right)) {
            continue;
        }
        
        // Lissajous curve math (rotated 45 degrees):
        // X = centerWidth + ((right - left) * scale)  // Horizontal = Stereo
        // Y = centerHeight - ((right + left) * scale) // Vertical = Mono
        // Note: Subtract for Y because screen Y increases downward, but we want positive mono to go up
        const x = centerWidth + ((right - left) * scale);
        const y = centerHeight - ((right + left) * scale);
        
        // Clamp to canvas bounds
        const clampedX = Math.max(0, Math.min(width - 1, x));
        const clampedY = Math.max(0, Math.min(height - 1, y));
        
        // Draw a small dot (1 pixel)
        ctx.fillRect(Math.floor(clampedX), Math.floor(clampedY), 1, 1);
    }
    
    // Note: The `color` parameter (traffic light status) is only used for the canvas border
    // which is set via boxShadow in the calling code. The line color uses the "Cool" palette above.
}

/**
 * Resize multi-band vector scope canvases to match container size
 * Each canvas takes 1/4 of the container width (4-band)
 */
function resizeVectorScopeCanvas() {
    if (!scopeSubCanvas || !scopeLowCanvas || !scopeMidCanvas || !scopeHighCanvas || !vectorScopeContainer) return;
    
    // Get container dimensions (accounting for gap-4 = 1rem = 16px, 3 gaps = 48px total)
    const containerWidth = vectorScopeContainer.clientWidth;
    const containerHeight = vectorScopeContainer.clientHeight;
    
    // Each canvas gets 1/4 of the width (minus gaps)
    const gap = 16; // gap-4 = 1rem = 16px
    const totalGaps = gap * 3; // 3 gaps between 4 canvases
    const canvasWidth = (containerWidth - totalGaps) / 4;
    const canvasHeight = Math.min(250, containerHeight - 40); // Leave room for labels
    
    // Handle devicePixelRatio for HiDPI displays
    const dpr = window.devicePixelRatio || 1;
    
    // Resize all four canvases
    const canvases = [
        { canvas: scopeSubCanvas, ctx: scopeSubCtx },
        { canvas: scopeLowCanvas, ctx: scopeLowCtx },
        { canvas: scopeMidCanvas, ctx: scopeMidCtx },
        { canvas: scopeHighCanvas, ctx: scopeHighCtx }
    ];
    
    canvases.forEach(({ canvas, ctx }) => {
        if (!canvas || !ctx) return;
        
        // Set canvas internal resolution (device pixels)
        canvas.width = canvasWidth * dpr;
        canvas.height = canvasHeight * dpr;
        
        // Set canvas CSS size (logical pixels)
        canvas.style.width = canvasWidth + 'px';
        canvas.style.height = canvasHeight + 'px';
        
        // Reset transform and scale context to account for devicePixelRatio
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
    });
}

/**
 * Update function: Read FFT data from analyser and apply smoothing
 */
function update() {
    if (!analyserLeft) {
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
    
    // Read FFT data from left analyser (for spectrum visualization)
    analyserLeft.getFloatFrequencyData(fftData);
    
    // Check if we're getting any valid values (-Infinity is valid, NaN is not)
    const hasAnyData = Array.from(fftData).some(val => !isNaN(val));
    
    if (!hasAnyData && Math.random() < 0.1) {
        console.warn('FFT data appears to be all NaN. Audio may not be flowing through analyser.');
    }
    
    // Update smoothedData with fixed fast alpha (0.8) for responsive live view
    if (smoothedData) {
        updateEMA(fftData, smoothedData, SMOOTHED_DATA_ALPHA);
    }
    
    // Update averageData with variable alpha from slider (for long-term average)
    if (averageData) {
        // Use a separate initialization flag for averageData
        if (!averageDataInitialized) {
            for (let i = 0; i < fftData.length; i++) {
                averageData[i] = fftData[i];
            }
            averageDataInitialized = true;
        } else {
            updateEMA(fftData, averageData, averageDataAlpha);
        }
    }
    
    // Update waveform buffer
    updateWaveform();
    
    // Update multi-band time-domain data arrays (for multi-band vector scope)
    if (analyserSubL && analyserSubR && analyserLowL && analyserLowR && analyserMidL && analyserMidR && analyserHighL && analyserHighR &&
        timeDomainDataSubL && timeDomainDataSubR && timeDomainDataLowL && timeDomainDataLowR && timeDomainDataMidL && timeDomainDataMidR && 
        timeDomainDataHighL && timeDomainDataHighR) {
        analyserSubL.getFloatTimeDomainData(timeDomainDataSubL);
        analyserSubR.getFloatTimeDomainData(timeDomainDataSubR);
        analyserLowL.getFloatTimeDomainData(timeDomainDataLowL);
        analyserLowR.getFloatTimeDomainData(timeDomainDataLowR);
        analyserMidL.getFloatTimeDomainData(timeDomainDataMidL);
        analyserMidR.getFloatTimeDomainData(timeDomainDataMidR);
        analyserHighL.getFloatTimeDomainData(timeDomainDataHighL);
        analyserHighR.getFloatTimeDomainData(timeDomainDataHighR);
    }
    
    // Update band states with smoothed FFT data
    if (smoothedData && audioContext) {
        const binFrequencies = computeBinFrequencies();
        if (binFrequencies.length > 0) {
            updateBandStates(smoothedData, binFrequencies);
        }
    }
}

/**
 * Draw the spectrum with two layers: Live bars (MAX) and Average curve (AVERAGE)
 * Uses pixel-based loop for "Vision 4X" bar chart aesthetic
 * @param {Float32Array} smoothed - Smoothed FFT data array (not used directly, kept for compatibility)
 * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 */
function drawSpectrum(smoothed, ctx, width, height) {
    if (!smoothedData || smoothedData.length === 0 || !averageData || averageData.length === 0 || !audioContext || !analyserLeft) {
        console.warn('drawSpectrum: No data available', {
            hasSmoothedData: !!smoothedData,
            hasAverageData: !!averageData,
            hasAudioContext: !!audioContext,
            hasAnalyserLeft: !!analyserLeft
        });
        return;
    }
    
    // Calculate active draw area
    const activeLeft = MARGIN_LEFT;
    const activeTop = MARGIN_TOP;
    const activeRight = width - MARGIN_RIGHT;
    const activeBottom = height - MARGIN_BOTTOM;
    const activeWidth = activeRight - activeLeft;
    const activeHeight = activeBottom - activeTop;
    
    // Save context and set up clipping for active draw area
    ctx.save();
    ctx.beginPath();
    ctx.rect(activeLeft, activeTop, activeWidth, activeHeight);
    ctx.clip();
    
    // Fill background of active draw area
    ctx.fillStyle = '#030712'; // gray-950
    ctx.fillRect(activeLeft, activeTop, activeWidth, activeHeight);
    
    const fftSize = analyserLeft.fftSize;
    
    // Array to store average curve points
    const averagePoints = [];
    
    // ===== PIXEL-BASED LOOP =====
    // Iterate from MARGIN_LEFT to width - MARGIN_RIGHT (one iteration per pixel column)
    for (let x = activeLeft; x < activeRight; x++) {
        // Calculate frequency range for this pixel
        const startFreq = xToFrequency(x, width);
        const endFreq = xToFrequency(x + 1, width);
        
        // Convert frequency range to FFT bin indices
        const binStart = getBinIndex(startFreq, fftSize);
        const binEnd = getBinIndex(endFreq, fftSize);
        
        // ===== LAYER 1: Live Data (MAX amplitude - "Vision 4X" bars) =====
        // Find MAX amplitude in the bin range for this pixel
        let maxDb = -Infinity;
        for (let binIdx = binStart; binIdx <= binEnd && binIdx < smoothedData.length; binIdx++) {
            const dbValue = smoothedData[binIdx];
            if (isFinite(dbValue) && dbValue > maxDb) {
                maxDb = dbValue;
            }
        }
        
        // Draw vertical 1px wide line from bottom up to max amplitude
        if (isFinite(maxDb)) {
            const y = dbToY(maxDb, height);
            const clampedY = Math.max(activeTop, Math.min(activeBottom, y));
            const barHeight = activeBottom - clampedY;
            
            if (barHeight > 0) {
                // Use gradient color based on amplitude
                const normalized = Math.max(0, Math.min(1, (maxDb - MIN_DB) / (MAX_DB - MIN_DB)));
                const hue = 180; // Cyan
                const saturation = 100;
                const lightness = 20 + (normalized * 80);
                const alpha = 0.3 + (normalized * 0.7);
                
                ctx.fillStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
                ctx.fillRect(x, clampedY, 1, barHeight);
            }
        }
        
        // ===== LAYER 2: Average Data (AVERAGE amplitude - smooth curve) =====
        // Find AVERAGE amplitude in the bin range for this pixel (simple arithmetic mean)
        let sumDb = 0;
        let count = 0;
        for (let binIdx = binStart; binIdx <= binEnd && binIdx < averageData.length; binIdx++) {
            const dbValue = averageData[binIdx];
            if (isFinite(dbValue)) {
                sumDb += dbValue;
                count++;
            }
        }
        
        // Calculate average dB value
        if (count > 0) {
            const avgDb = sumDb / count;
            const y = dbToY(avgDb, height);
            const clampedY = Math.max(activeTop, Math.min(activeBottom, y));
            averagePoints.push({ x: x, y: clampedY });
        }
    }
    
    // Draw smooth stroked line connecting averaged points (Layer 2)
    if (averagePoints.length > 0) {
        ctx.beginPath();
        ctx.moveTo(averagePoints[0].x, averagePoints[0].y);
        for (let i = 1; i < averagePoints.length; i++) {
            ctx.lineTo(averagePoints[i].x, averagePoints[i].y);
        }
        ctx.strokeStyle = '#67e8f9'; // cyan-300 - bright and visible
        ctx.lineWidth = 2;
        ctx.stroke();
    }
    
    // Restore context (removes clipping)
    ctx.restore();
}

/**
 * Draw frequency markers (vertical lines and labels)
 * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 */
function drawFrequencyMarkers(ctx, width, height) {
    const frequencies = [100, 1000, 10000]; // 100 Hz, 1 kHz, 10 kHz
    
    // Calculate active draw area boundaries
    const activeTop = MARGIN_TOP;
    const activeBottom = height - MARGIN_BOTTOM;
    const labelY = height - MARGIN_BOTTOM + 15; // Position labels in the bottom margin area
    
    // Set up styling for grid lines (subtle, low opacity)
    ctx.strokeStyle = 'rgba(107, 114, 128, 0.3)'; // gray-500 with low opacity
    ctx.lineWidth = 1;
    
    // Set up styling for labels
    ctx.font = '11px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#9ca3af'; // gray-400
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    for (const freq of frequencies) {
        const x = frequencyToX(freq, width);
        
        // Draw vertical grid line extending only across the active draw area
        ctx.beginPath();
        ctx.moveTo(x, activeTop);
        ctx.lineTo(x, activeBottom);
        ctx.stroke();
        
        // Format label
        let label;
        if (freq >= 1000) {
            label = `${freq / 1000} kHz`;
        } else {
            label = `${freq} Hz`;
        }
        
        // Draw label in the bottom margin area
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
    
    // Calculate active draw area boundaries
    const activeLeft = MARGIN_LEFT;
    const activeRight = width - MARGIN_RIGHT;
    const labelX = 8; // Position labels in the left margin area
    
    // Set up styling for grid lines (subtle, low opacity)
    ctx.strokeStyle = 'rgba(75, 85, 99, 0.3)'; // gray-600 with low opacity
    ctx.lineWidth = 0.5;
    
    // Set up styling for labels
    ctx.font = '11px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#9ca3af'; // gray-400
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    for (const db of dbValues) {
        const y = dbToY(db, height);
        
        // Draw horizontal grid line extending only across the active draw area
        ctx.beginPath();
        ctx.moveTo(activeLeft, y);
        ctx.lineTo(activeRight, y);
        ctx.stroke();
        
        // Format label
        const label = `${db} dB`;
        
        // Draw label text in the left margin area
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
                hasAnalyserLeft: !!analyserLeft,
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
    
    // Draw multi-band vector scopes with phase correlation
    const dpr = window.devicePixelRatio || 1;
    
    // Sub band scope
    if (timeDomainDataSubL && timeDomainDataSubR && scopeSubCanvas && scopeSubCtx) {
        const correlation = calculateCorrelation(timeDomainDataSubL, timeDomainDataSubR);
        const { color } = getPhaseColor(correlation, 'sub');
        
        // Apply glowing border using the color
        scopeSubCanvas.style.boxShadow = `0 0 20px ${color}`;
        
        // Draw scope
        const cssWidth = scopeSubCanvas.width / dpr;
        const cssHeight = scopeSubCanvas.height / dpr;
        drawScope(scopeSubCtx, timeDomainDataSubL, timeDomainDataSubR, cssWidth, cssHeight, color);
    }
    
    // Low band scope
    if (timeDomainDataLowL && timeDomainDataLowR && scopeLowCanvas && scopeLowCtx) {
        const correlation = calculateCorrelation(timeDomainDataLowL, timeDomainDataLowR);
        const { color } = getPhaseColor(correlation, 'low');
        
        // Apply glowing border using the color
        scopeLowCanvas.style.boxShadow = `0 0 20px ${color}`;
        
        // Draw scope
        const cssWidth = scopeLowCanvas.width / dpr;
        const cssHeight = scopeLowCanvas.height / dpr;
        drawScope(scopeLowCtx, timeDomainDataLowL, timeDomainDataLowR, cssWidth, cssHeight, color);
    }
    
    // Mid band scope
    if (timeDomainDataMidL && timeDomainDataMidR && scopeMidCanvas && scopeMidCtx) {
        const correlation = calculateCorrelation(timeDomainDataMidL, timeDomainDataMidR);
        const { color } = getPhaseColor(correlation, 'mid');
        
        // Apply glowing border using the color
        scopeMidCanvas.style.boxShadow = `0 0 20px ${color}`;
        
        // Draw scope
        const cssWidth = scopeMidCanvas.width / dpr;
        const cssHeight = scopeMidCanvas.height / dpr;
        drawScope(scopeMidCtx, timeDomainDataMidL, timeDomainDataMidR, cssWidth, cssHeight, color);
    }
    
    // High band scope
    if (timeDomainDataHighL && timeDomainDataHighR && scopeHighCanvas && scopeHighCtx) {
        const correlation = calculateCorrelation(timeDomainDataHighL, timeDomainDataHighR);
        const { color } = getPhaseColor(correlation, 'high');
        
        // Apply glowing border using the color
        scopeHighCanvas.style.boxShadow = `0 0 20px ${color}`;
        
        // Draw scope
        const cssWidth = scopeHighCanvas.width / dpr;
        const cssHeight = scopeHighCanvas.height / dpr;
        drawScope(scopeHighCtx, timeDomainDataHighL, timeDomainDataHighR, cssWidth, cssHeight, color);
    }
    
    // Draw oscilloscope (axis is now drawn internally)
    drawOscilloscopeWrapper();
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
            hasAnalyserLeft: !!analyserLeft,
            hasAnalyserRight: !!analyserRight,
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
    if (!isAnimating && analyserLeft) {
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
    console.log('Analysers available:', { left: !!analyserLeft, right: !!analyserRight });
    console.log('Is animating:', isAnimating);
    
    // Resume AudioContext if suspended - CRITICAL for audio to flow
    if (audioContext && audioContext.state === 'suspended') {
        console.log('Resuming suspended AudioContext...');
        audioContext.resume().then(() => {
            console.log('AudioContext resumed successfully, state:', audioContext.state);
            
            // Start animation loop after context is resumed
            if (analyserLeft && !isAnimating) {
                console.log('Starting animation loop...');
                startAnimationLoop();
            }
        }).catch(err => {
            console.error('Failed to resume AudioContext:', err);
        });
    } else {
        // Start animation loop if analyser is available
        if (analyserLeft && !isAnimating) {
            console.log('Starting animation loop...');
            startAnimationLoop();
        } else {
            console.warn('Cannot start animation:', {
                hasAnalyserLeft: !!analyserLeft,
                hasAnalyserRight: !!analyserRight,
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
    
    // Map slider value (0-100) to alpha for averageData (0.05-0.5)
    // 0% = very slow average (alpha = 0.05, shows long-term average shape)
    // 100% = faster average (alpha = 0.5, more responsive but still averaged)
    // Lower alpha = slower update = longer-term average
    // Higher alpha = faster update = shorter-term average
    averageDataAlpha = 0.05 + (sliderValue / 100) * 0.45;
    
    console.log(`Average smoothing updated: ${Math.round(sliderValue)}% -> alpha = ${averageDataAlpha.toFixed(3)}`);
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

// Settings menu toggle
const settingsTrigger = document.getElementById('settings-trigger');
const settingsMenu = document.getElementById('settings-menu');

/**
 * Toggle settings menu visibility
 */
function toggleSettingsMenu() {
    if (settingsMenu) {
        settingsMenu.classList.toggle('hidden');
    }
}

// Event listeners
if (settingsTrigger) {
    settingsTrigger.addEventListener('click', toggleSettingsMenu);
}

// Close settings menu when clicking outside
document.addEventListener('click', (event) => {
    if (settingsMenu && settingsTrigger && !settingsMenu.contains(event.target) && !settingsTrigger.contains(event.target)) {
        settingsMenu.classList.add('hidden');
    }
});

playPauseBtn.addEventListener('click', handlePlayPause);
audioSourceSelect.addEventListener('change', handleAudioSourceChange);
smoothingSlider.addEventListener('input', handleSmoothingChange);
viewLengthSelect.addEventListener('change', handleViewLengthChange);
if (decaySpeedSlider) {
    decaySpeedSlider.addEventListener('input', handleDecaySpeedChange);
}
if (fftSizeSelect) {
    fftSizeSelect.addEventListener('change', (e) => {
        const newSize = parseInt(e.target.value, 10);
        if (isFinite(newSize) && newSize > 0) {
            updateFFTSize(newSize);
        } else {
            console.warn('Invalid FFT size value:', e.target.value);
        }
    });
}

// Mono scope checkbox - no event listener needed
// The checkbox state is checked in updateWaveform() each frame, so changes take effect automatically
if (monoScopeCheck) {
    console.log('Mono scope checkbox initialized');
}

// Initialize alpha from slider's initial value
handleSmoothingChange();

// Initialize decay speed from slider's initial value
handleDecaySpeedChange();

// Initialize canvas size
resizeCanvas();
resizeVectorScopeCanvas();
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

// Oscilloscope axis is now drawn internally in drawOscilloscope

// Initialize multi-band vector scope canvases
const scopeCanvases = [
    { canvas: scopeLowCanvas, ctx: scopeLowCtx, label: 'Low' },
    { canvas: scopeMidCanvas, ctx: scopeMidCtx, label: 'Mid' },
    { canvas: scopeHighCanvas, ctx: scopeHighCtx, label: 'High' }
];

scopeCanvases.forEach(({ canvas, ctx, label }) => {
    if (canvas && ctx) {
        console.log(`Vector scope ${label} canvas initialized:`, {
            width: canvas.width,
            height: canvas.height,
            hasContext: !!ctx
        });
        // Draw initial background
        const dpr = window.devicePixelRatio || 1;
        ctx.fillStyle = '#030712'; // gray-950
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ffffff';
        ctx.font = '14px system-ui';
        ctx.textAlign = 'center';
        const cssWidth = canvas.width / dpr;
        const cssHeight = canvas.height / dpr;
        ctx.fillText(`${label} Scope ready - Click Play to start`, cssWidth / 2, cssHeight / 2);
    }
});

// Add window resize event listener with debouncing
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        resizeCanvas();
        resizeVectorScopeCanvas();
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

// Vector scope doesn't need mouse event handlers (no tooltips)

