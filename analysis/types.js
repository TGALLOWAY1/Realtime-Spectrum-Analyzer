export const DEFAULT_ANALYSIS_OPTIONS = Object.freeze({
    doHPSS: false,
    extractMelody: true,
    extractHarmony: true,
    inferChords: true,
    detectAtonal: true,
    timeResolutionMs: 30,
    minNoteDurationMs: 80,
    atonalThreshold: 0.65
});

/**
 * @typedef {Object} AnalysisOptions
 * @property {boolean} doHPSS
 * @property {boolean} extractMelody
 * @property {boolean} extractHarmony
 * @property {boolean} inferChords
 * @property {boolean} detectAtonal
 * @property {number} timeResolutionMs
 * @property {number} minNoteDurationMs
 * @property {number} [atonalThreshold]
 */

/**
 * @typedef {Object} AnalysisJobInput
 * @property {Float32Array} audioBuffer
 * @property {number} sampleRate
 * @property {Partial<AnalysisOptions>} [options]
 */

/**
 * @typedef {Object} NoteEvent
 * @property {number} pitchMidi
 * @property {number} startSec
 * @property {number} durationSec
 * @property {number} [velocity]
 * @property {number} confidence
 */

/**
 * @typedef {Object} ChordEvent
 * @property {number} [rootPitchClass]
 * @property {number} [rootMidi]
 * @property {string} quality
 * @property {number} startSec
 * @property {number} durationSec
 * @property {number} confidence
 * @property {string} label
 */

/**
 * @typedef {Object} KeyEstimate
 * @property {number} tonicPitchClass
 * @property {'major'|'minor'} mode
 * @property {number} confidence
 * @property {string} label
 */

/**
 * @typedef {Object} AnalysisDebugInfo
 * @property {number[]} [frameTimesSec]
 * @property {number[][]} [chroma]
 * @property {Array<Record<string, number>>} [chordWindowScores]
 * @property {string[]} [warnings]
 * @property {{inputSamples: number, normalizedSamples: number, usedHPSS: boolean}} [preprocess]
 */

/**
 * @typedef {Object} AnalysisResult
 * @property {NoteEvent[]} notes
 * @property {NoteEvent[]} melodyNotes
 * @property {NoteEvent[]} harmonyNotes
 * @property {ChordEvent[]} chords
 * @property {KeyEstimate | undefined} keyEstimate
 * @property {number} atonalScore
 * @property {boolean} isAtonal
 * @property {AnalysisDebugInfo | undefined} debug
 */

/**
 * @param {Partial<AnalysisOptions> | undefined} options
 * @returns {AnalysisOptions}
 */
export function mergeAnalysisOptions(options) {
    return {
        ...DEFAULT_ANALYSIS_OPTIONS,
        ...(options || {})
    };
}

/**
 * @returns {AnalysisResult}
 */
export function createEmptyAnalysisResult() {
    return {
        notes: [],
        melodyNotes: [],
        harmonyNotes: [],
        chords: [],
        keyEstimate: undefined,
        atonalScore: 1,
        isAtonal: true,
        debug: {
            warnings: []
        }
    };
}
