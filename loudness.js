/**
 * K-weighted loudness approximation, inspired by ITU-R BS.1770 / EBU R128.
 *
 * This module is deliberately a lightweight approximation suitable for live UI:
 *  - K-weighting is implemented as a high-pass (~38 Hz) + high-shelf (1681 Hz, +4 dB)
 *    biquad chain. Real BS.1770 K-weighting uses two precise biquad stages with
 *    fixed coefficients; the BiquadFilterNode types here are a close approximation.
 *  - We compute momentary (400 ms), short-term (3 s), and integrated loudness
 *    from a rolling block buffer. We do NOT implement -10 LU relative or
 *    -70 LUFS absolute gating — values are time-weighted means.
 *  - LUFS calibration constant -0.691 dB is applied per BS.1770.
 *
 * Call sites should describe the values as "approximate LUFS" in any context
 * where absolute mastering accuracy is implied.
 */

const MOMENTARY_WINDOW_S = 0.4;
const SHORT_TERM_WINDOW_S = 3.0;
const LRA_HISTORY_S = 30;

/**
 * Construct a K-weighting biquad chain. Returns { input, output } GainNodes
 * so the caller can splice it into an audio graph: source -> input ... output -> analyser.
 */
export function createKWeightingChain(audioContext) {
    const hp = audioContext.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 38;
    hp.Q.value = 0.5;

    const shelf = audioContext.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 1681;
    shelf.gain.value = 4.0;

    const input = audioContext.createGain();
    const output = audioContext.createGain();
    input.connect(hp);
    hp.connect(shelf);
    shelf.connect(output);
    return { input, output };
}

export function meanSquareToLufs(meanSquare) {
    if (meanSquare <= 1e-12 || !isFinite(meanSquare)) return -Infinity;
    return -0.691 + 10 * Math.log10(meanSquare);
}

/**
 * Tracks K-weighted mean-square energy blocks for rolling-window LUFS.
 * Push one block per measurement interval with the block's mean-square energy
 * and its duration in seconds.
 */
export class LoudnessTracker {
    constructor() {
        this.blocks = [];
        this.totalDuration = 0;
        this.totalEnergy = 0;
        this.shortTermHistory = [];
    }

    pushBlock(meanSquare, durationS, nowS = null) {
        if (!isFinite(meanSquare) || meanSquare < 0) meanSquare = 0;
        if (durationS <= 0) return;
        const t = nowS !== null ? nowS : this.totalDuration;
        this.blocks.push({ ms: meanSquare, t, dt: durationS });
        this.totalDuration = Math.max(this.totalDuration, t + durationS);
        this.totalEnergy += meanSquare * durationS;
        const stCutoff = this.totalDuration - SHORT_TERM_WINDOW_S;
        while (this.blocks.length > 1 && this.blocks[0].t + this.blocks[0].dt < stCutoff) {
            this.blocks.shift();
        }
        const st = this.shortTermLufs();
        if (isFinite(st)) {
            this.shortTermHistory.push({ t: this.totalDuration, lufs: st });
            const lraCutoff = this.totalDuration - LRA_HISTORY_S;
            while (this.shortTermHistory.length && this.shortTermHistory[0].t < lraCutoff) {
                this.shortTermHistory.shift();
            }
        }
    }

    windowMeanSquare(windowS) {
        if (this.blocks.length === 0) return 0;
        const cutoff = this.totalDuration - windowS;
        let energy = 0;
        let duration = 0;
        for (let i = this.blocks.length - 1; i >= 0; i--) {
            const b = this.blocks[i];
            if (b.t + b.dt <= cutoff) break;
            const start = Math.max(b.t, cutoff);
            const dt = Math.max(0, (b.t + b.dt) - start);
            energy += b.ms * dt;
            duration += dt;
        }
        return duration > 0 ? energy / duration : 0;
    }

    momentaryLufs() {
        return meanSquareToLufs(this.windowMeanSquare(MOMENTARY_WINDOW_S));
    }

    shortTermLufs() {
        return meanSquareToLufs(this.windowMeanSquare(SHORT_TERM_WINDOW_S));
    }

    integratedLufs() {
        if (this.totalDuration <= 0) return -Infinity;
        return meanSquareToLufs(this.totalEnergy / this.totalDuration);
    }

    /**
     * Loudness range (LU): 95th-percentile minus 10th-percentile of short-term
     * loudness samples over the last LRA_HISTORY_S seconds.
     */
    loudnessRange() {
        const vals = this.shortTermHistory.map((s) => s.lufs).filter(isFinite);
        if (vals.length < 4) return 0;
        const sorted = vals.slice().sort((a, b) => a - b);
        const lo = sorted[Math.floor(sorted.length * 0.1)];
        const hi = sorted[Math.floor(sorted.length * 0.95)];
        return Math.max(0, hi - lo);
    }

    reset() {
        this.blocks = [];
        this.totalDuration = 0;
        this.totalEnergy = 0;
        this.shortTermHistory = [];
    }
}

/**
 * Bounded ring-style time-series buffer for plotting.
 * Pairs of {t, value} entries; oldest entries dropped when capacity exceeded.
 */
export class RollingHistory {
    constructor(capacity = 600) {
        this.capacity = capacity;
        this.samples = [];
    }
    push(t, value) {
        this.samples.push({ t, value });
        if (this.samples.length > this.capacity) this.samples.shift();
    }
    trimOlderThan(t) {
        while (this.samples.length && this.samples[0].t < t) this.samples.shift();
    }
    reset() {
        this.samples = [];
    }
    get length() {
        return this.samples.length;
    }
}

export const METER_STANDARDS = [
    { id: 'k20', label: 'K-20', target: -20 },
    { id: 'k14', label: 'K-14', target: -14 },
    { id: 'ebu', label: 'EBU R128', target: -23 },
    { id: 'atsc', label: 'ATSC A/85', target: -24 },
];
