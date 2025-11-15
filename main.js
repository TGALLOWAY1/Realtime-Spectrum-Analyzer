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

// EMA smoothing alpha value (0-1, where lower = more smoothing, higher = less smoothing)
// Default: 0.5 (moderate smoothing)
let emaAlpha = 0.5;
let emaInitialized = false;

// Frequency mapping constants
const MIN_FREQ = 20;    // 20 Hz
const MAX_FREQ = 20000; // 20 kHz

// dB mapping constants
// Web Audio API getFloatFrequencyData returns dB values from -Infinity to 0 dB (full scale)
// Some implementations may return slightly positive values, so we allow up to +6 dB for headroom
const MIN_DB = -100;    // Minimum dB value (silence threshold)
const MAX_DB = 0;        // Maximum dB value (full scale, 0 dB = maximum digital level)

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
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        
        // Calculate frequency bin count (fftSize / 2)
        frequencyBinCount = analyser.frequencyBinCount;
        
        // Allocate FFT data arrays
        fftData = new Float32Array(frequencyBinCount);
        smoothedData = new Float32Array(frequencyBinCount);
        
        // Initialize smoothed data array (will be populated on first update)
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

// Event listeners
playPauseBtn.addEventListener('click', handlePlayPause);
audioSourceSelect.addEventListener('change', handleAudioSourceChange);
smoothingSlider.addEventListener('input', handleSmoothingChange);

// Initialize alpha from slider's initial value
handleSmoothingChange();

// Initialize canvas size
resizeCanvas();

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

// Add window resize event listener with debouncing
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        resizeCanvas();
    }, 100); // Debounce resize events
});

// Initialize with the default selected audio file
const defaultPath = audioSourceSelect.value;
if (defaultPath) {
    setupTestAudio(defaultPath);
}

