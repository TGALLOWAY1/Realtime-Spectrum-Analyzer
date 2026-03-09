/**
 * insights.js — Pure computation functions for spectral analysis metrics
 *
 * All functions are stateless and deterministic:
 *   input: FFT data arrays + audio parameters
 *   output: computed metric values
 *
 * No DOM access, no side effects, no Web Audio API references.
 */

// ============================================================
// 6-Band Energy Summary
// ============================================================

/**
 * Standard mixing band definitions (6 bands)
 * These match common EQ and mixing terminology.
 */
export const MIXING_BANDS = [
    { name: 'Sub',       label: 'Sub',       min: 20,    max: 60,    color: '#6366f1' }, // indigo-500
    { name: 'Bass',      label: 'Bass',      min: 60,    max: 250,   color: '#3b82f6' }, // blue-500
    { name: 'Low Mids',  label: 'Low Mid',   min: 250,   max: 1000,  color: '#14b8a6' }, // teal-500
    { name: 'Mids',      label: 'Mid',       min: 1000,  max: 4000,  color: '#eab308' }, // yellow-500
    { name: 'High Mids', label: 'Hi Mid',    min: 4000,  max: 8000,  color: '#f97316' }, // orange-500
    { name: 'Air',       label: 'Air',       min: 8000,  max: 20000, color: '#ef4444' }, // red-500
];

/**
 * Compute RMS energy per mixing band from FFT dB data.
 *
 * @param {Float32Array} fftData - FFT magnitude data in dB (from getFloatFrequencyData)
 * @param {number} sampleRate - Audio context sample rate (e.g. 48000)
 * @param {number} fftSize - FFT size (e.g. 4096)
 * @returns {Array<{name: string, label: string, color: string, energyDb: number, energyNorm: number}>}
 */
export function computeBandEnergies(fftData, sampleRate, fftSize) {
    if (!fftData || fftData.length === 0 || !sampleRate || !fftSize) {
        return MIXING_BANDS.map(b => ({ ...b, energyDb: -Infinity, energyNorm: 0 }));
    }

    const binCount = fftSize / 2;
    const freqPerBin = sampleRate / fftSize;

    return MIXING_BANDS.map(band => {
        const startBin = Math.max(0, Math.floor(band.min / freqPerBin));
        const endBin = Math.min(binCount - 1, Math.ceil(band.max / freqPerBin));

        let sumLinearPower = 0;
        let count = 0;

        for (let i = startBin; i <= endBin; i++) {
            const db = fftData[i];
            if (isFinite(db)) {
                // Convert dB to linear power: 10^(dB/10)
                sumLinearPower += Math.pow(10, db / 10);
                count++;
            }
        }

        let energyDb = -Infinity;
        if (count > 0 && sumLinearPower > 0) {
            // RMS energy in dB = 10 * log10(mean linear power)
            energyDb = 10 * Math.log10(sumLinearPower / count);
        }

        // Normalize to 0–1 range for bar display
        // Map from [-100 dB, 0 dB] → [0, 1]
        const energyNorm = Math.max(0, Math.min(1, (energyDb + 100) / 100));

        return {
            name: band.name,
            label: band.label,
            color: band.color,
            min: band.min,
            max: band.max,
            energyDb,
            energyNorm,
        };
    });
}


// ============================================================
// Spectral Centroid (Brightness)
// ============================================================

/**
 * Compute the spectral centroid — the "center of mass" of the spectrum.
 * Higher centroid = brighter sound.
 *
 * Formula: centroid = Σ(f_i * |X_i|²) / Σ(|X_i|²)
 * where f_i is the frequency of bin i and |X_i|² is the linear power.
 *
 * @param {Float32Array} fftData - FFT magnitude data in dB
 * @param {number} sampleRate - Audio context sample rate
 * @param {number} fftSize - FFT size
 * @returns {{ centroidHz: number, centroidNorm: number, brightnessLabel: string }}
 */
export function computeSpectralCentroid(fftData, sampleRate, fftSize) {
    if (!fftData || fftData.length === 0 || !sampleRate || !fftSize) {
        return { centroidHz: 0, centroidNorm: 0, brightnessLabel: '—' };
    }

    const binCount = fftSize / 2;
    const freqPerBin = sampleRate / fftSize;

    let weightedSum = 0;
    let totalPower = 0;

    // Only consider bins in the audible range (20 Hz – 20 kHz)
    const minBin = Math.max(1, Math.floor(20 / freqPerBin));
    const maxBin = Math.min(binCount - 1, Math.ceil(20000 / freqPerBin));

    for (let i = minBin; i <= maxBin; i++) {
        const db = fftData[i];
        if (!isFinite(db)) continue;

        // Convert dB to linear power
        const linearPower = Math.pow(10, db / 10);
        const freq = i * freqPerBin;

        weightedSum += freq * linearPower;
        totalPower += linearPower;
    }

    if (totalPower === 0) {
        return { centroidHz: 0, centroidNorm: 0, brightnessLabel: '—' };
    }

    const centroidHz = weightedSum / totalPower;

    // Normalize centroid to 0–1 using a log scale over audible range
    // log10(20) ≈ 1.3, log10(20000) ≈ 4.3 → range ≈ 3.0
    const logMin = Math.log10(20);
    const logMax = Math.log10(20000);
    const logCentroid = Math.log10(Math.max(20, centroidHz));
    const centroidNorm = Math.max(0, Math.min(1, (logCentroid - logMin) / (logMax - logMin)));

    // Derive a human-readable brightness label
    let brightnessLabel;
    if (centroidHz < 500) {
        brightnessLabel = 'Dark';
    } else if (centroidHz < 1500) {
        brightnessLabel = 'Warm';
    } else if (centroidHz < 3000) {
        brightnessLabel = 'Neutral';
    } else if (centroidHz < 6000) {
        brightnessLabel = 'Bright';
    } else {
        brightnessLabel = 'Very Bright';
    }

    return { centroidHz, centroidNorm, brightnessLabel };
}


// ============================================================
// Peak / Resonance Detection
// ============================================================

/**
 * Detect the top N spectral peaks from FFT data.
 * A peak is a local maximum that stands above its neighbors by `minProminence` dB.
 *
 * @param {Float32Array} fftData - FFT magnitude data in dB
 * @param {number} sampleRate - Audio context sample rate
 * @param {number} fftSize - FFT size
 * @param {Object} [options]
 * @param {number} [options.maxPeaks=5] - Maximum number of peaks to return
 * @param {number} [options.minProminence=6] - Minimum dB above neighbors to qualify as peak
 * @param {number} [options.minDb=-80] - Minimum absolute dB threshold for a peak
 * @param {number} [options.neighborhoodBins=4] - Number of bins on each side for local max test
 * @returns {Array<{ freq: number, db: number, binIndex: number, label: string }>}
 */
export function detectPeaks(fftData, sampleRate, fftSize, options = {}) {
    const {
        maxPeaks = 5,
        minProminence = 6,
        minDb = -80,
        neighborhoodBins = 4,
    } = options;

    if (!fftData || fftData.length === 0 || !sampleRate || !fftSize) {
        return [];
    }

    const binCount = fftSize / 2;
    const freqPerBin = sampleRate / fftSize;

    // Only search audible range
    const minBin = Math.max(neighborhoodBins, Math.floor(20 / freqPerBin));
    const maxBin = Math.min(binCount - 1 - neighborhoodBins, Math.ceil(20000 / freqPerBin));

    const candidates = [];

    for (let i = minBin; i <= maxBin; i++) {
        const db = fftData[i];
        if (!isFinite(db) || db < minDb) continue;

        // Check if this bin is a local maximum within the neighborhood
        let isMax = true;
        let minNeighborDb = db;

        for (let j = 1; j <= neighborhoodBins; j++) {
            const leftDb = fftData[i - j];
            const rightDb = fftData[i + j];

            if (isFinite(leftDb) && leftDb > db) { isMax = false; break; }
            if (isFinite(rightDb) && rightDb > db) { isMax = false; break; }

            if (isFinite(leftDb)) minNeighborDb = Math.min(minNeighborDb, leftDb);
            if (isFinite(rightDb)) minNeighborDb = Math.min(minNeighborDb, rightDb);
        }

        if (!isMax) continue;

        // Check prominence (how much this peak stands above its neighbors)
        const prominence = db - minNeighborDb;
        if (prominence < minProminence) continue;

        const freq = i * freqPerBin;
        candidates.push({ freq, db, binIndex: i, prominence });
    }

    // Sort by dB (loudest first), take top N
    candidates.sort((a, b) => b.db - a.db);
    const topPeaks = candidates.slice(0, maxPeaks);

    // Add formatted label for each peak
    return topPeaks.map(peak => ({
        freq: peak.freq,
        db: peak.db,
        binIndex: peak.binIndex,
        label: formatFrequency(peak.freq),
    }));
}


// ============================================================
// Tonal Descriptor
// ============================================================

/**
 * Derive a concise tonal descriptor from band energies and centroid.
 * Returns a short string like "Sub-heavy", "Mid-forward", "Bright", etc.
 *
 * @param {Array<{name: string, energyNorm: number}>} bandEnergies - From computeBandEnergies()
 * @param {{ centroidHz: number }} centroid - From computeSpectralCentroid()
 * @returns {string} Tonal descriptor
 */
export function deriveTonalDescriptor(bandEnergies, centroid) {
    if (!bandEnergies || bandEnergies.length === 0) return '—';

    // Find the band with the highest normalized energy
    let maxEnergy = -Infinity;
    let dominantBand = null;

    for (const band of bandEnergies) {
        if (band.energyNorm > maxEnergy) {
            maxEnergy = band.energyNorm;
            dominantBand = band;
        }
    }

    if (!dominantBand || maxEnergy <= 0) return 'Silent';

    // Check for specific tonal characteristics
    const subEnergy = bandEnergies.find(b => b.name === 'Sub')?.energyNorm || 0;
    const bassEnergy = bandEnergies.find(b => b.name === 'Bass')?.energyNorm || 0;
    const lowMidEnergy = bandEnergies.find(b => b.name === 'Low Mids')?.energyNorm || 0;
    const midEnergy = bandEnergies.find(b => b.name === 'Mids')?.energyNorm || 0;
    const hiMidEnergy = bandEnergies.find(b => b.name === 'High Mids')?.energyNorm || 0;
    const airEnergy = bandEnergies.find(b => b.name === 'Air')?.energyNorm || 0;

    const lowSum = subEnergy + bassEnergy;
    const midSum = lowMidEnergy + midEnergy;
    const highSum = hiMidEnergy + airEnergy;

    // Primary descriptor based on balance
    if (lowSum > midSum * 1.4 && lowSum > highSum * 1.4) {
        if (subEnergy > bassEnergy * 1.2) return 'Sub-heavy';
        return 'Bass-heavy';
    }

    if (midSum > lowSum * 1.2 && midSum > highSum * 1.2) {
        if (lowMidEnergy > midEnergy * 1.2) return 'Warm / Boxy';
        return 'Mid-forward';
    }

    if (highSum > lowSum * 1.2 && highSum > midSum * 1.2) {
        if (hiMidEnergy > airEnergy * 1.4) return 'Harsh / Present';
        return 'Bright / Airy';
    }

    // Relatively balanced — use centroid for secondary label
    if (centroid && centroid.centroidHz > 0) {
        if (centroid.centroidHz < 800) return 'Dark & Balanced';
        if (centroid.centroidHz > 4000) return 'Bright & Balanced';
        return 'Well Balanced';
    }

    return 'Balanced';
}


// ============================================================
// Utility helpers
// ============================================================

/**
 * Format a frequency value to a human-readable label.
 * @param {number} freq - Frequency in Hz
 * @returns {string} Formatted string (e.g. "1.2 kHz", "80 Hz")
 */
export function formatFrequency(freq) {
    if (freq >= 10000) {
        return `${(freq / 1000).toFixed(1)} kHz`;
    } else if (freq >= 1000) {
        return `${(freq / 1000).toFixed(2)} kHz`;
    } else {
        return `${Math.round(freq)} Hz`;
    }
}

/**
 * Format a dB value for display.
 * @param {number} db - Decibel value
 * @returns {string} Formatted string (e.g. "-24.3 dB")
 */
export function formatDb(db) {
    if (!isFinite(db)) return '—';
    return `${db.toFixed(1)} dB`;
}
