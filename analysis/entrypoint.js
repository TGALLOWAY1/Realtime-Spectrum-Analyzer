import { splitMelodyHarmony } from './melody_harmony_split.js';
import { preprocessAudio } from './preprocess.js';
import { transcribeV1 } from './transcription.js';
import {
    createEmptyAnalysisResult,
    mergeAnalysisOptions
} from './types.js';

/**
 * @param {unknown} input
 */
function validateAnalysisJobInput(input) {
    if (!input || typeof input !== 'object') {
        throw new TypeError('analyzeSampleToMidi input must be an object');
    }

    const typedInput = /** @type {{audioBuffer?: unknown, sampleRate?: unknown}} */ (input);

    if (!(typedInput.audioBuffer instanceof Float32Array)) {
        throw new TypeError('input.audioBuffer must be a Float32Array');
    }

    if (!Number.isFinite(typedInput.sampleRate) || typedInput.sampleRate <= 0) {
        throw new TypeError('input.sampleRate must be a positive number');
    }
}

/**
 * Offline analysis entrypoint for melody/harmony transcription and MIDI export.
 * DSP stages are intentionally incremental to avoid realtime regressions.
 *
 * @param {import('./types.js').AnalysisJobInput} input
 * @returns {Promise<import('./types.js').AnalysisResult>}
 */
export async function analyzeSampleToMidi(input) {
    validateAnalysisJobInput(input);

    const options = mergeAnalysisOptions(input.options);
    const result = createEmptyAnalysisResult();
    const preprocessResult = preprocessAudio(input.audioBuffer, {
        doHPSS: options.doHPSS
    });

    const transcription = transcribeV1(preprocessResult.normalizedBuffer, input.sampleRate, {
        timeResolutionMs: options.timeResolutionMs,
        minNoteDurationMs: options.minNoteDurationMs
    });

    result.notes = transcription.notes;

    const split = splitMelodyHarmony(transcription.notes, {
        timeResolutionMs: options.timeResolutionMs,
        extractMelody: options.extractMelody,
        extractHarmony: options.extractHarmony
    });

    result.melodyNotes = split.melodyNotes;
    result.harmonyNotes = split.harmonyNotes;

    if (result.debug?.warnings) {
        result.debug.warnings.push('Offline transcription pipeline skeleton active.');
        result.debug.warnings.push(...preprocessResult.warnings);
        result.debug.warnings.push('Chord inference and MIDI export are not implemented in this slice.');
    }

    if (result.debug) {
        result.debug.preprocess = {
            inputSamples: input.audioBuffer.length,
            normalizedSamples: preprocessResult.normalizedBuffer.length,
            usedHPSS: options.doHPSS
        };
        result.debug.frameTimesSec = transcription.frameTimesSec;
        result.debug.chroma = transcription.chroma;
    }

    return result;
}
