/**
 * @typedef {Object} PreprocessResult
 * @property {Float32Array} monoBuffer
 * @property {Float32Array} normalizedBuffer
 * @property {Float32Array | undefined} harmonicBuffer
 * @property {Float32Array | undefined} percussiveBuffer
 * @property {string[]} warnings
 */

/**
 * Convert incoming PCM to mono. The current v1 contract already expects mono Float32Array,
 * but this helper centralizes the behavior for future channel-expansion support.
 *
 * @param {Float32Array} audioBuffer
 * @returns {Float32Array}
 */
export function toMono(audioBuffer) {
    return new Float32Array(audioBuffer);
}

/**
 * Peak-normalize a PCM buffer while avoiding divide-by-zero.
 *
 * @param {Float32Array} audioBuffer
 * @param {number} [targetPeak]
 * @returns {Float32Array}
 */
export function normalizePeak(audioBuffer, targetPeak = 0.98) {
    let peak = 0;

    for (let i = 0; i < audioBuffer.length; i++) {
        const absValue = Math.abs(audioBuffer[i]);
        if (absValue > peak) {
            peak = absValue;
        }
    }

    if (peak === 0) {
        return new Float32Array(audioBuffer);
    }

    const scale = targetPeak / peak;
    const normalized = new Float32Array(audioBuffer.length);

    for (let i = 0; i < audioBuffer.length; i++) {
        normalized[i] = audioBuffer[i] * scale;
    }

    return normalized;
}

/**
 * Placeholder HPSS adapter for future implementation.
 *
 * @param {Float32Array} normalizedBuffer
 * @returns {{harmonicBuffer: Float32Array, percussiveBuffer: Float32Array, warning: string}}
 */
function runHPSSStub(normalizedBuffer) {
    return {
        harmonicBuffer: new Float32Array(normalizedBuffer),
        percussiveBuffer: new Float32Array(normalizedBuffer.length),
        warning: 'HPSS requested but not implemented yet. Using normalized mono audio as harmonic source.'
    };
}

/**
 * @param {Float32Array} audioBuffer
 * @param {{doHPSS: boolean}} options
 * @returns {PreprocessResult}
 */
export function preprocessAudio(audioBuffer, options) {
    const warnings = [];
    const monoBuffer = toMono(audioBuffer);
    const normalizedBuffer = normalizePeak(monoBuffer);

    let harmonicBuffer;
    let percussiveBuffer;

    if (options.doHPSS) {
        const hpssResult = runHPSSStub(normalizedBuffer);
        harmonicBuffer = hpssResult.harmonicBuffer;
        percussiveBuffer = hpssResult.percussiveBuffer;
        warnings.push(hpssResult.warning);
    }

    return {
        monoBuffer,
        normalizedBuffer,
        harmonicBuffer,
        percussiveBuffer,
        warnings
    };
}
