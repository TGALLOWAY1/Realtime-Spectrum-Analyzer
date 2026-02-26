const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const CHORD_TEMPLATES = [
    { quality: 'maj', intervals: [0, 4, 7], suffix: '' },
    { quality: 'min', intervals: [0, 3, 7], suffix: 'm' },
    { quality: 'dim', intervals: [0, 3, 6], suffix: 'dim' },
    { quality: 'aug', intervals: [0, 4, 8], suffix: 'aug' },
    { quality: 'sus2', intervals: [0, 2, 7], suffix: 'sus2' },
    { quality: 'sus4', intervals: [0, 5, 7], suffix: 'sus4' },
    { quality: '7', intervals: [0, 4, 7, 10], suffix: '7' },
    { quality: 'maj7', intervals: [0, 4, 7, 11], suffix: 'maj7' },
    { quality: 'min7', intervals: [0, 3, 7, 10], suffix: 'm7' },
    { quality: 'hdim7', intervals: [0, 3, 6, 10], suffix: 'm7b5' }
];

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/**
 * @param {number[]} vector
 * @returns {number[]}
 */
function normalize(vector) {
    const sum = vector.reduce((acc, value) => acc + Math.max(0, value), 0);
    if (sum === 0) {
        return vector.map(() => 0);
    }
    return vector.map((value) => Math.max(0, value) / sum);
}

/**
 * @param {number[]} profile
 * @param {number} shift
 * @returns {number[]}
 */
function rotate(profile, shift) {
    const out = new Array(12);
    for (let i = 0; i < 12; i++) {
        out[i] = profile[(i + shift) % 12];
    }
    return out;
}

/**
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function correlation(a, b) {
    let meanA = 0;
    let meanB = 0;
    for (let i = 0; i < a.length; i++) {
        meanA += a[i];
        meanB += b[i];
    }
    meanA /= a.length;
    meanB /= b.length;

    let numerator = 0;
    let denomA = 0;
    let denomB = 0;

    for (let i = 0; i < a.length; i++) {
        const da = a[i] - meanA;
        const db = b[i] - meanB;
        numerator += da * db;
        denomA += da * da;
        denomB += db * db;
    }

    if (denomA === 0 || denomB === 0) {
        return 0;
    }

    return numerator / Math.sqrt(denomA * denomB);
}

/**
 * @param {number[]} chroma
 * @returns {{rootPitchClass: number, quality: string, label: string, confidence: number, scores: Record<string, number>}}
 */
export function scoreChordTemplates(chroma) {
    const normalized = normalize(chroma);
    let best = null;
    let secondBest = null;
    const scores = {};

    for (let root = 0; root < 12; root++) {
        for (let t = 0; t < CHORD_TEMPLATES.length; t++) {
            const template = CHORD_TEMPLATES[t];

            let match = 0;
            let penalty = 0;
            const pitchClassSet = new Set();

            for (let i = 0; i < template.intervals.length; i++) {
                const pitchClass = (root + template.intervals[i]) % 12;
                pitchClassSet.add(pitchClass);
                match += normalized[pitchClass];
            }

            for (let pc = 0; pc < 12; pc++) {
                if (!pitchClassSet.has(pc)) {
                    penalty += normalized[pc] * 0.35;
                }
            }

            const score = match - penalty;
            const label = `${NOTE_NAMES[root]}${template.suffix}`;
            scores[label] = score;

            const candidate = {
                rootPitchClass: root,
                quality: template.quality,
                label,
                score
            };

            if (!best || candidate.score > best.score) {
                secondBest = best;
                best = candidate;
            } else if (!secondBest || candidate.score > secondBest.score) {
                secondBest = candidate;
            }
        }
    }

    if (!best) {
        return {
            rootPitchClass: 0,
            quality: 'maj',
            label: 'C',
            confidence: 0,
            scores
        };
    }

    const margin = secondBest ? Math.max(0, best.score - secondBest.score) : Math.max(0, best.score);
    const confidence = Math.max(0, Math.min(1, margin / 0.2 + Math.max(0, best.score)));

    return {
        rootPitchClass: best.rootPitchClass,
        quality: best.quality,
        label: best.label,
        confidence,
        scores
    };
}

/**
 * @param {number[][]} chromaFrames
 * @param {number[]} frameTimesSec
 * @param {{windowMs?: number, hopMs?: number}} [options]
 * @returns {{chords: import('./types.js').ChordEvent[], windowScores: Array<Record<string, number>>}}
 */
export function inferChordsFromChroma(chromaFrames, frameTimesSec, options = {}) {
    if (!chromaFrames.length || !frameTimesSec.length) {
        return { chords: [], windowScores: [] };
    }

    const frameStepSec = frameTimesSec.length > 1
        ? Math.max(0.02, frameTimesSec[1] - frameTimesSec[0])
        : 0.03;

    const windowSec = Math.max(0.25, (options.windowMs || 500) / 1000);
    const hopSec = Math.max(0.1, (options.hopMs || 250) / 1000);
    const totalDurationSec = frameTimesSec[frameTimesSec.length - 1] + frameStepSec;

    const windows = [];
    const windowScores = [];

    for (let startSec = 0; startSec < totalDurationSec; startSec += hopSec) {
        const endSec = Math.min(totalDurationSec, startSec + windowSec);
        const aggregated = new Array(12).fill(0);
        let count = 0;

        for (let frame = 0; frame < frameTimesSec.length; frame++) {
            const time = frameTimesSec[frame];
            if (time >= startSec && time < endSec) {
                const chroma = chromaFrames[frame];
                for (let pc = 0; pc < 12; pc++) {
                    aggregated[pc] += chroma[pc] || 0;
                }
                count += 1;
            }
        }

        if (!count) {
            continue;
        }

        for (let pc = 0; pc < 12; pc++) {
            aggregated[pc] /= count;
        }

        const scored = scoreChordTemplates(aggregated);
        windowScores.push(scored.scores);

        const previous = windows[windows.length - 1];
        const stabilizedLabel = previous && scored.confidence < 0.45 ? previous.label : scored.label;

        windows.push({
            startSec,
            endSec,
            rootPitchClass: scored.rootPitchClass,
            quality: scored.quality,
            label: stabilizedLabel,
            confidence: scored.confidence
        });
    }

    const merged = [];
    for (let i = 0; i < windows.length; i++) {
        const current = windows[i];
        const previous = merged[merged.length - 1];

        if (previous && previous.label === current.label) {
            previous.durationSec = current.endSec - previous.startSec;
            previous.confidence = Math.max(previous.confidence, current.confidence);
        } else {
            merged.push({
                rootPitchClass: current.rootPitchClass,
                quality: current.quality,
                startSec: current.startSec,
                durationSec: current.endSec - current.startSec,
                confidence: current.confidence,
                label: current.label
            });
        }
    }

    return {
        chords: merged,
        windowScores
    };
}

/**
 * @param {number[][]} chromaFrames
 * @returns {import('./types.js').KeyEstimate | undefined}
 */
export function estimateKeyFromChroma(chromaFrames) {
    if (!chromaFrames.length) {
        return undefined;
    }

    const aggregate = new Array(12).fill(0);
    for (let f = 0; f < chromaFrames.length; f++) {
        for (let pc = 0; pc < 12; pc++) {
            aggregate[pc] += chromaFrames[f][pc] || 0;
        }
    }

    const normalized = normalize(aggregate);

    let best = null;
    let second = null;

    for (let root = 0; root < 12; root++) {
        const majCorr = correlation(normalized, rotate(MAJOR_PROFILE, root));
        const minCorr = correlation(normalized, rotate(MINOR_PROFILE, root));

        const majorCandidate = {
            tonicPitchClass: root,
            mode: 'major',
            confidence: majCorr,
            label: `${NOTE_NAMES[root]} major`
        };

        const minorCandidate = {
            tonicPitchClass: root,
            mode: 'minor',
            confidence: minCorr,
            label: `${NOTE_NAMES[root]} minor`
        };

        const candidates = [majorCandidate, minorCandidate];
        for (let i = 0; i < candidates.length; i++) {
            const candidate = candidates[i];
            if (!best || candidate.confidence > best.confidence) {
                second = best;
                best = candidate;
            } else if (!second || candidate.confidence > second.confidence) {
                second = candidate;
            }
        }
    }

    if (!best) {
        return undefined;
    }

    const margin = second ? Math.max(0, best.confidence - second.confidence) : Math.max(0, best.confidence);
    return {
        tonicPitchClass: best.tonicPitchClass,
        mode: best.mode,
        confidence: Math.max(0, Math.min(1, (best.confidence + margin) / 1.2)),
        label: best.label
    };
}
