import { computeStftFrames } from './stft.js';

const MIN_NOTE_MIDI = 36;
const MAX_NOTE_MIDI = 96;

/**
 * @param {number} frequencyHz
 * @returns {number}
 */
function frequencyToMidi(frequencyHz) {
    return Math.round(69 + 12 * Math.log2(frequencyHz / 440));
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/**
 * @param {Float32Array} spectrum
 * @param {Float32Array} binFrequenciesHz
 * @returns {{chroma: number[], midiEnergy: Float32Array}}
 */
function spectrumToChromaAndMidiEnergy(spectrum, binFrequenciesHz) {
    const chroma = new Array(12).fill(0);
    const midiEnergy = new Float32Array(128);

    for (let bin = 1; bin < spectrum.length; bin++) {
        const frequency = binFrequenciesHz[bin];
        if (frequency < 27.5 || frequency > 5000) {
            continue;
        }

        const midi = frequencyToMidi(frequency);
        if (midi < MIN_NOTE_MIDI || midi > MAX_NOTE_MIDI) {
            continue;
        }

        const energy = spectrum[bin];
        const pitchClass = ((midi % 12) + 12) % 12;

        chroma[pitchClass] += energy;
        midiEnergy[midi] += energy;
    }

    let chromaPeak = 0;
    for (let i = 0; i < chroma.length; i++) {
        if (chroma[i] > chromaPeak) {
            chromaPeak = chroma[i];
        }
    }

    if (chromaPeak > 0) {
        for (let i = 0; i < chroma.length; i++) {
            chroma[i] /= chromaPeak;
        }
    }

    return { chroma, midiEnergy };
}

/**
 * @param {Float32Array[]} midiEnergyFrames
 * @param {number[]} frameTimesSec
 * @param {{timeResolutionMs: number, minNoteDurationMs: number}} options
 * @returns {import('./types.js').NoteEvent[]}
 */
function trackNoteEvents(midiEnergyFrames, frameTimesSec, options) {
    const notes = [];
    const active = new Map();
    const frameDurationSec = options.timeResolutionMs / 1000;
    const minDurationSec = options.minNoteDurationMs / 1000;

    for (let frameIndex = 0; frameIndex < midiEnergyFrames.length; frameIndex++) {
        const frameEnergy = midiEnergyFrames[frameIndex];

        let framePeak = 0;
        for (let midi = MIN_NOTE_MIDI; midi <= MAX_NOTE_MIDI; midi++) {
            if (frameEnergy[midi] > framePeak) {
                framePeak = frameEnergy[midi];
            }
        }

        const threshold = framePeak * 0.45;
        const activeNow = new Set();

        for (let midi = MIN_NOTE_MIDI; midi <= MAX_NOTE_MIDI; midi++) {
            const energy = frameEnergy[midi];
            if (energy < threshold || framePeak === 0) {
                continue;
            }

            const confidence = clamp(energy / framePeak, 0, 1);
            activeNow.add(midi);

            const existing = active.get(midi);
            if (!existing) {
                active.set(midi, {
                    pitchMidi: midi,
                    startSec: frameTimesSec[frameIndex],
                    durationSec: frameDurationSec,
                    confidenceSum: confidence,
                    frameCount: 1
                });
            } else {
                existing.durationSec += frameDurationSec;
                existing.confidenceSum += confidence;
                existing.frameCount += 1;
            }
        }

        const toFinalize = [];
        for (const [midi] of active) {
            if (!activeNow.has(midi)) {
                toFinalize.push(midi);
            }
        }

        for (let i = 0; i < toFinalize.length; i++) {
            const midi = toFinalize[i];
            const event = active.get(midi);
            if (!event) {
                continue;
            }

            if (event.durationSec >= minDurationSec) {
                notes.push({
                    pitchMidi: event.pitchMidi,
                    startSec: event.startSec,
                    durationSec: event.durationSec,
                    confidence: clamp(event.confidenceSum / event.frameCount, 0, 1),
                    velocity: Math.round(50 + 70 * clamp(event.confidenceSum / event.frameCount, 0, 1))
                });
            }

            active.delete(midi);
        }
    }

    for (const [, event] of active) {
        if (event.durationSec >= minDurationSec) {
            notes.push({
                pitchMidi: event.pitchMidi,
                startSec: event.startSec,
                durationSec: event.durationSec,
                confidence: clamp(event.confidenceSum / event.frameCount, 0, 1),
                velocity: Math.round(50 + 70 * clamp(event.confidenceSum / event.frameCount, 0, 1))
            });
        }
    }

    notes.sort((a, b) => a.startSec - b.startSec || a.pitchMidi - b.pitchMidi);
    return notes;
}

/**
 * @param {Float32Array} audioBuffer
 * @param {number} sampleRate
 * @param {{timeResolutionMs: number, minNoteDurationMs: number}} options
 * @returns {{notes: import('./types.js').NoteEvent[], chroma: number[][], frameTimesSec: number[]}}
 */
export function transcribeV1(audioBuffer, sampleRate, options) {
    const frameSize = 2048;
    const hopSize = Math.max(128, Math.round((sampleRate * options.timeResolutionMs) / 1000));

    const { spectra, frameTimesSec, binFrequenciesHz } = computeStftFrames(audioBuffer, {
        sampleRate,
        frameSize,
        hopSize
    });

    const chroma = [];
    const midiEnergyFrames = [];

    for (let frame = 0; frame < spectra.length; frame++) {
        const converted = spectrumToChromaAndMidiEnergy(spectra[frame], binFrequenciesHz);
        chroma.push(converted.chroma);
        midiEnergyFrames.push(converted.midiEnergy);
    }

    const notes = trackNoteEvents(midiEnergyFrames, frameTimesSec, options);

    return {
        notes,
        chroma,
        frameTimesSec
    };
}
