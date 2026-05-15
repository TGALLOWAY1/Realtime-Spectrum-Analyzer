/**
 * spectrogram.js — Scrolling spectrogram (time × frequency heatmap)
 *
 * Architecture:
 *   - SpectrogramBuffer: bounded ring buffer storing FFT snapshots
 *   - Color mapping: dB → RGB via a perceptually pleasant palette
 *   - drawSpectrogram(): renders the buffer onto a Canvas2D context
 *   - drawMetricOverlay(): optional centroid / level traces on top
 *
 * No DOM manipulation — the caller owns the canvas and context.
 */

// ============================================================
// Color Map (dB → RGB)
// ============================================================

/**
 * Map a dB value to an RGBA color using a perceptual "inferno-like" palette.
 * Designed for dark backgrounds: silence → black, loud → white/yellow.
 *
 * @param {number} db - Value in dB (typically -100 to 0)
 * @param {number} minDb - Floor dB (maps to black)
 * @param {number} maxDb - Ceiling dB (maps to brightest color)
 * @returns {{ r: number, g: number, b: number, a: number }} RGBA 0-255
 */
export function dbToColor(db, minDb = -100, maxDb = 0) {
    if (!isFinite(db) || db <= minDb) {
        return { r: 0, g: 0, b: 0, a: 255 }; // silence → black
    }

    // Normalize to 0-1
    const t = Math.max(0, Math.min(1, (db - minDb) / (maxDb - minDb)));

    // 5-stop gradient: black → dark blue → teal → orange → white
    let r, g, b;
    if (t < 0.25) {
        const s = t / 0.25;
        r = 0;
        g = 0;
        b = Math.round(s * 80); // black → dark blue
    } else if (t < 0.5) {
        const s = (t - 0.25) / 0.25;
        r = 0;
        g = Math.round(s * 180);
        b = Math.round(80 + s * 40); // dark blue → teal
    } else if (t < 0.75) {
        const s = (t - 0.5) / 0.25;
        r = Math.round(s * 255);
        g = Math.round(180 + s * 40);
        b = Math.round(120 - s * 120); // teal → orange/yellow
    } else {
        const s = (t - 0.75) / 0.25;
        r = 255;
        g = Math.round(220 + s * 35);
        b = Math.round(s * 200); // orange → white
    }

    return {
        r: Math.max(0, Math.min(255, r)),
        g: Math.max(0, Math.min(255, g)),
        b: Math.max(0, Math.min(255, b)),
        a: 255,
    };
}

// ============================================================
// Spectrogram Ring Buffer
// ============================================================

/**
 * Bounded ring buffer for FFT frame history.
 *
 * Stores `maxFrames` columns of `binsPerFrame` floats (dB values).
 * Newest frame is always at writeIndex - 1; oldest scrolls off the left.
 */
export class SpectrogramBuffer {
    /**
     * @param {number} maxFrames - Maximum number of time columns to store
     * @param {number} binsPerFrame - Number of frequency bins per column
     */
    constructor(maxFrames = 512, binsPerFrame = 0) {
        this.maxFrames = maxFrames;
        this.binsPerFrame = binsPerFrame;
        this.frames = []; // array of Float32Array (each is one FFT snapshot)
        this.writeIndex = 0;
        this.filled = false; // true once buffer has wrapped at least once
    }

    /**
     * Reinitialize the buffer when FFT size changes.
     * @param {number} binsPerFrame
     */
    setBinsPerFrame(binsPerFrame) {
        if (binsPerFrame !== this.binsPerFrame) {
            this.binsPerFrame = binsPerFrame;
            this.frames = [];
            this.writeIndex = 0;
            this.filled = false;
        }
    }

    /**
     * Push a new FFT frame (dB values) into the buffer.
     * @param {Float32Array} fftData - dB values for each frequency bin
     */
    push(fftData) {
        if (!fftData || fftData.length === 0) return;

        // Lazy-init binsPerFrame from first push
        if (this.binsPerFrame === 0) {
            this.binsPerFrame = fftData.length;
        }

        // Allocate or reuse the slot
        if (this.frames.length < this.maxFrames) {
            // Still growing — allocate new
            this.frames.push(new Float32Array(fftData));
        } else {
            // Buffer full — overwrite oldest
            this.frames[this.writeIndex].set(fftData);
        }

        this.writeIndex = (this.writeIndex + 1) % this.maxFrames;
        if (this.frames.length >= this.maxFrames) {
            this.filled = true;
        }
    }

    /**
     * Get the number of frames currently stored.
     * @returns {number}
     */
    get length() {
        return this.frames.length;
    }

    /**
     * Read the frame at a given age (0 = newest, length-1 = oldest).
     * @param {number} age - How many frames back (0 = most recent)
     * @returns {Float32Array|null}
     */
    getFrame(age) {
        const count = this.frames.length;
        if (age < 0 || age >= count) return null;

        // writeIndex points to the NEXT slot to write
        // newest = writeIndex - 1, oldest = writeIndex (when full)
        const idx = (this.writeIndex - 1 - age + count * 2) % count;
        return this.frames[idx];
    }
}


// ============================================================
// Metric History Ring Buffer (for centroid / level traces)
// ============================================================

/**
 * Simple ring buffer for scalar metric values (e.g. centroid Hz, RMS level).
 */
export class MetricHistory {
    /**
     * @param {number} maxLength - Maximum number of samples to store
     */
    constructor(maxLength = 512) {
        this.maxLength = maxLength;
        this.data = new Float32Array(maxLength);
        this.writeIndex = 0;
        this.count = 0;
    }

    /** Push a new value. */
    push(value) {
        this.data[this.writeIndex] = isFinite(value) ? value : 0;
        this.writeIndex = (this.writeIndex + 1) % this.maxLength;
        if (this.count < this.maxLength) this.count++;
    }

    /**
     * Get value at a given age (0 = newest).
     * @param {number} age
     * @returns {number}
     */
    get(age) {
        if (age < 0 || age >= this.count) return 0;
        const idx = (this.writeIndex - 1 - age + this.maxLength * 2) % this.maxLength;
        return this.data[idx];
    }
}


// ============================================================
// Spectrogram Renderer
// ============================================================

/**
 * Draw the spectrogram heatmap onto a canvas.
 *
 * Time flows left-to-right (oldest on the left, newest on the right).
 * Frequency is mapped bottom-to-top on a logarithmic scale (20 Hz – 20 kHz).
 *
 * @param {CanvasRenderingContext2D} ctx - Destination canvas context
 * @param {SpectrogramBuffer} buffer - FFT frame history
 * @param {number} width - Canvas CSS width in pixels
 * @param {number} height - Canvas CSS height in pixels
 * @param {number} sampleRate - Audio sample rate (for frequency mapping)
 * @param {number} fftSize - FFT size (for frequency mapping)
 * @param {Object} [options]
 * @param {number} [options.minDb=-100] - Floor dB for color map
 * @param {number} [options.maxDb=-20] - Ceiling dB for color map
 * @param {number} [options.minFreq=20] - Minimum display frequency (Hz)
 * @param {number} [options.maxFreq=20000] - Maximum display frequency (Hz)
 */
export function drawSpectrogram(ctx, buffer, width, height, sampleRate, fftSize, options = {}) {
    const {
        minDb = -100,
        maxDb = -20,
        minFreq = 20,
        maxFreq = 20000,
        pixelRatio = 1,
    } = options;

    // Margins matching the main spectrum chart
    const MARGIN_LEFT = 60;
    const MARGIN_BOTTOM = 30;
    const MARGIN_TOP = 20;
    const MARGIN_RIGHT = 20;

    const activeLeft = MARGIN_LEFT;
    const activeTop = MARGIN_TOP;
    const activeWidth = width - MARGIN_LEFT - MARGIN_RIGHT;
    const activeHeight = height - MARGIN_TOP - MARGIN_BOTTOM;
    const activeBottom = activeTop + activeHeight;

    if (activeWidth <= 0 || activeHeight <= 0) return;

    // Clear the full canvas
    ctx.fillStyle = '#030712'; // gray-950
    ctx.fillRect(0, 0, width, height);

    const frameCount = buffer.length;
    if (frameCount === 0 || buffer.binsPerFrame === 0) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '14px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('Spectrogram — Press Play to start', width / 2, height / 2);
        return;
    }

    const binCount = fftSize / 2;
    const freqPerBin = sampleRate / fftSize;
    const logMinFreq = Math.log10(minFreq);
    const logMaxFreq = Math.log10(maxFreq);
    const logFreqRange = logMaxFreq - logMinFreq;

    // putImageData ignores the canvas transform — it writes raw physical pixels.
    // So we generate the heatmap at physical pixel resolution and place it at
    // the physical-pixel offset that matches our CSS-pixel active area.
    const physW = Math.max(1, Math.round(activeWidth * pixelRatio));
    const physH = Math.max(1, Math.round(activeHeight * pixelRatio));
    const imgData = ctx.createImageData(physW, physH);
    const pixels = imgData.data;

    const columnsToShow = Math.min(frameCount, physW);

    for (let px = 0; px < physW; px++) {
        const age = columnsToShow - 1 - Math.floor((px / physW) * columnsToShow);
        const frame = buffer.getFrame(age);
        if (!frame) continue;

        for (let py = 0; py < physH; py++) {
            const yNorm = py / physH;
            const logFreq = logMaxFreq - yNorm * logFreqRange;
            const freq = Math.pow(10, logFreq);

            const bin = Math.round(freq / freqPerBin);
            const clampedBin = Math.max(0, Math.min(binCount - 1, bin));

            const db = frame[clampedBin];
            const color = dbToColor(db, minDb, maxDb);

            const offset = (py * physW + px) * 4;
            pixels[offset] = color.r;
            pixels[offset + 1] = color.g;
            pixels[offset + 2] = color.b;
            pixels[offset + 3] = color.a;
        }
    }

    // Temporarily reset the transform so putImageData lands at the intended
    // CSS-pixel position regardless of the current dpr scaling.
    const prev = ctx.getTransform();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(imgData, Math.round(activeLeft * pixelRatio), Math.round(activeTop * pixelRatio));
    ctx.setTransform(prev);

    // ===== Draw frequency axis labels (right side of spectrogram) =====
    const freqMarkers = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
    ctx.font = '10px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#9ca3af'; // gray-400
    ctx.strokeStyle = 'rgba(107, 114, 128, 0.2)'; // subtle grid
    ctx.lineWidth = 0.5;

    for (const freq of freqMarkers) {
        if (freq < minFreq || freq > maxFreq) continue;
        const logF = Math.log10(freq);
        const yNorm = (logMaxFreq - logF) / logFreqRange;
        const y = activeTop + yNorm * activeHeight;

        if (y < activeTop || y > activeBottom) continue;

        // Grid line
        ctx.beginPath();
        ctx.moveTo(activeLeft, y);
        ctx.lineTo(activeLeft + activeWidth, y);
        ctx.stroke();

        // Label in left margin
        let label;
        if (freq >= 1000) label = `${freq / 1000}k`;
        else label = `${freq}`;
        ctx.fillText(label, 8, y);
    }

    // ===== Draw time indicator (simple "now" marker on right edge) =====
    ctx.strokeStyle = 'rgba(103, 232, 249, 0.4)'; // cyan-300
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(activeLeft + activeWidth - 1, activeTop);
    ctx.lineTo(activeLeft + activeWidth - 1, activeBottom);
    ctx.stroke();
}


// ============================================================
// Metric Overlay Renderer
// ============================================================

/**
 * Draw centroid and level history traces on top of the spectrogram.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {MetricHistory} centroidHistory - Centroid frequency in Hz
 * @param {MetricHistory} levelHistory - Overall level in dB
 * @param {number} width - Canvas CSS width
 * @param {number} height - Canvas CSS height
 * @param {Object} [options]
 */
export function drawMetricOverlay(ctx, centroidHistory, levelHistory, width, height, options = {}) {
    const {
        minFreq = 20,
        maxFreq = 20000,
        minDb = -100,
        maxDb = 0,
    } = options;

    const MARGIN_LEFT = 60;
    const MARGIN_BOTTOM = 30;
    const MARGIN_TOP = 20;
    const MARGIN_RIGHT = 20;

    const activeLeft = MARGIN_LEFT;
    const activeTop = MARGIN_TOP;
    const activeWidth = width - MARGIN_LEFT - MARGIN_RIGHT;
    const activeHeight = height - MARGIN_TOP - MARGIN_BOTTOM;
    const activeBottom = activeTop + activeHeight;

    if (activeWidth <= 0 || activeHeight <= 0) return;

    const logMinFreq = Math.log10(minFreq);
    const logMaxFreq = Math.log10(maxFreq);
    const logFreqRange = logMaxFreq - logMinFreq;

    // ===== Centroid trace (violet) =====
    if (centroidHistory && centroidHistory.count > 1) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(activeLeft, activeTop, activeWidth, activeHeight);
        ctx.clip();

        ctx.strokeStyle = 'rgba(167, 139, 250, 0.8)'; // violet-400
        ctx.lineWidth = 1.5;
        ctx.beginPath();

        const pointCount = Math.min(centroidHistory.count, activeWidth);
        let started = false;

        for (let px = 0; px < activeWidth; px++) {
            const age = pointCount - 1 - Math.floor((px / activeWidth) * pointCount);
            const hz = centroidHistory.get(age);
            if (hz <= 0) continue;

            const logF = Math.log10(Math.max(minFreq, Math.min(maxFreq, hz)));
            const yNorm = (logMaxFreq - logF) / logFreqRange;
            const y = activeTop + yNorm * activeHeight;

            if (!started) {
                ctx.moveTo(activeLeft + px, y);
                started = true;
            } else {
                ctx.lineTo(activeLeft + px, y);
            }
        }
        ctx.stroke();

        // Label
        ctx.font = '9px system-ui';
        ctx.fillStyle = 'rgba(167, 139, 250, 0.7)';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText('centroid', activeLeft + activeWidth - 4, activeBottom - 4);

        ctx.restore();
    }

    // ===== Level trace (cyan, mapped to height for visibility) =====
    if (levelHistory && levelHistory.count > 1) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(activeLeft, activeTop, activeWidth, activeHeight);
        ctx.clip();

        ctx.strokeStyle = 'rgba(103, 232, 249, 0.5)'; // cyan-300
        ctx.lineWidth = 1;
        ctx.beginPath();

        const pointCount = Math.min(levelHistory.count, activeWidth);
        let started = false;

        for (let px = 0; px < activeWidth; px++) {
            const age = pointCount - 1 - Math.floor((px / activeWidth) * pointCount);
            const db = levelHistory.get(age);

            // Map dB to Y: -100 → bottom, 0 → top
            const norm = Math.max(0, Math.min(1, (db - minDb) / (maxDb - minDb)));
            const y = activeBottom - norm * activeHeight;

            if (!started) {
                ctx.moveTo(activeLeft + px, y);
                started = true;
            } else {
                ctx.lineTo(activeLeft + px, y);
            }
        }
        ctx.stroke();

        // Label
        ctx.font = '9px system-ui';
        ctx.fillStyle = 'rgba(103, 232, 249, 0.5)';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText('level', activeLeft + activeWidth - 4, activeTop + 4);

        ctx.restore();
    }
}
