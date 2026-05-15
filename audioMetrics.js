/**
 * Pure audio metric utilities. All functions stateless, no DOM access.
 * Inputs are Float32Array time-domain samples in approximately [-1, 1].
 *
 * These are deliberately lightweight approximations sized for real-time UI;
 * they are not certified ITU/EBU implementations.
 */

export function rms(buffer) {
    if (!buffer || buffer.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
        sum += buffer[i] * buffer[i];
    }
    return Math.sqrt(sum / buffer.length);
}

export function peak(buffer) {
    if (!buffer || buffer.length === 0) return 0;
    let max = 0;
    for (let i = 0; i < buffer.length; i++) {
        const a = Math.abs(buffer[i]);
        if (a > max) max = a;
    }
    return max;
}

/**
 * 4x oversampled peak approximation via linear interpolation between samples.
 * Cheap stand-in for ITU-R BS.1770 true peak (which uses 4x polyphase upsampling).
 */
export function truePeak(buffer) {
    if (!buffer || buffer.length === 0) return 0;
    let max = 0;
    const n = buffer.length;
    for (let i = 0; i < n - 1; i++) {
        const a = buffer[i];
        const b = buffer[i + 1];
        const delta = b - a;
        const a0 = Math.abs(a);
        const a1 = Math.abs(a + 0.25 * delta);
        const a2 = Math.abs(a + 0.5 * delta);
        const a3 = Math.abs(a + 0.75 * delta);
        const local = Math.max(a0, a1, a2, a3);
        if (local > max) max = local;
    }
    const tail = Math.abs(buffer[n - 1]);
    if (tail > max) max = tail;
    return max;
}

export function linearToDb(linear) {
    if (linear <= 0) return -Infinity;
    return 20 * Math.log10(linear);
}

export function clamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Crest factor in dB = 20·log10(peak / rms). Returns 0 for silent input.
 */
export function crestFactorDb(buffer) {
    const p = peak(buffer);
    const r = rms(buffer);
    if (r <= 1e-9) return 0;
    return linearToDb(p / r);
}

/**
 * Zero-lag Pearson correlation between two buffers of equal length.
 * +1 = identical, 0 = uncorrelated, -1 = phase-inverted. Returns 0 for silence.
 */
export function correlation(left, right) {
    const n = Math.min(left.length, right.length);
    if (n === 0) return 0;
    let sumL = 0, sumR = 0, sumLR = 0, sumL2 = 0, sumR2 = 0;
    for (let i = 0; i < n; i++) {
        const L = left[i];
        const R = right[i];
        sumL += L;
        sumR += R;
        sumLR += L * R;
        sumL2 += L * L;
        sumR2 += R * R;
    }
    const meanL = sumL / n;
    const meanR = sumR / n;
    const cov = sumLR / n - meanL * meanR;
    const varL = sumL2 / n - meanL * meanL;
    const varR = sumR2 / n - meanR * meanR;
    const denom = Math.sqrt(Math.max(varL, 0) * Math.max(varR, 0));
    if (denom <= 1e-12) return 0;
    return clamp(cov / denom, -1, 1);
}

/**
 * L/R balance in [-1, 1] from RMS energies.
 * -1 = full left, 0 = centered, +1 = full right.
 */
export function balance(leftRms, rightRms) {
    const total = leftRms + rightRms;
    if (total <= 1e-12) return 0;
    return clamp((rightRms - leftRms) / total, -1, 1);
}

/**
 * Mid/Side energy ratio. Returns side_rms / mid_rms.
 * 0 = pure mono, ~1 = balanced, >1 = side-heavy / out of mono.
 */
export function midSideWidth(left, right) {
    const n = Math.min(left.length, right.length);
    if (n === 0) return 0;
    let midSq = 0, sideSq = 0;
    for (let i = 0; i < n; i++) {
        const M = (left[i] + right[i]) * 0.5;
        const S = (left[i] - right[i]) * 0.5;
        midSq += M * M;
        sideSq += S * S;
    }
    const midRms = Math.sqrt(midSq / n);
    const sideRms = Math.sqrt(sideSq / n);
    if (midRms <= 1e-9) return sideRms > 1e-9 ? 1.0 : 0;
    return sideRms / midRms;
}

/**
 * Interpret correlation + width into a stereo-field status string for the UI.
 */
export function classifyStereoField(corr, widthRatio, balanceVal) {
    if (Math.abs(balanceVal) > 0.4) return 'Left/Right Balance Skewed';
    if (corr < -0.1) return 'Mono Compatibility Issue';
    if (widthRatio < 0.05 && Math.abs(corr) > 0.97) return 'Mono / Very Narrow';
    return 'Stereo Field Looks Good';
}

/**
 * Fractional-octave smoothing of an FFT magnitude (dB) array.
 * For each output bin centered at f_c, averages neighbors within ±octFraction/2 octaves.
 * `octFraction` is the denominator: 3 = 1/3 oct, 12 = 1/12 oct. Falsy = no smoothing.
 *
 * @param {Float32Array} dbIn - input dB array of length fftSize/2
 * @param {Float32Array} dbOut - output dB array (must be allocated, same length as dbIn)
 * @param {number} sampleRate - audio sample rate
 * @param {number} fftSize - FFT size (full, not half)
 * @param {number} octFraction - 3, 6, 12, etc.
 */
export function fractionalOctaveSmoothDb(dbIn, dbOut, sampleRate, fftSize, octFraction) {
    const n = dbIn.length;
    if (!octFraction || octFraction <= 0) {
        for (let i = 0; i < n; i++) dbOut[i] = dbIn[i];
        return;
    }
    const binHz = sampleRate / fftSize;
    const halfBandwidth = Math.pow(2, 1 / (2 * octFraction));
    for (let i = 0; i < n; i++) {
        const fCenter = i * binHz;
        if (fCenter < binHz * 0.5) {
            dbOut[i] = dbIn[i];
            continue;
        }
        const fLow = fCenter / halfBandwidth;
        const fHigh = fCenter * halfBandwidth;
        const lo = Math.max(0, Math.floor(fLow / binHz));
        const hi = Math.min(n - 1, Math.ceil(fHigh / binHz));
        let acc = 0;
        let count = 0;
        for (let j = lo; j <= hi; j++) {
            const v = dbIn[j];
            if (isFinite(v)) {
                acc += v;
                count++;
            }
        }
        dbOut[i] = count > 0 ? acc / count : dbIn[i];
    }
}
