import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exportToMidi } from '../analysis/midi_export.js';

function toHex(uint8Array) {
    return Array.from(uint8Array, (value) => value.toString(16).padStart(2, '0')).join('');
}

test('exportToMidi matches golden bytes for deterministic fixture', () => {
    const result = {
        notes: [{ pitchMidi: 72, startSec: 0, durationSec: 0.5, confidence: 0.8, velocity: 96 }],
        melodyNotes: [{ pitchMidi: 72, startSec: 0, durationSec: 0.5, confidence: 0.8, velocity: 96 }],
        harmonyNotes: [],
        chords: [{ rootPitchClass: 0, quality: 'maj', startSec: 0, durationSec: 1.0, confidence: 0.9, label: 'C' }],
        keyEstimate: { tonicPitchClass: 0, mode: 'major', confidence: 0.8, label: 'C major' },
        atonalScore: 0.1,
        isAtonal: false,
        debug: undefined
    };

    const bytes = exportToMidi(result, {
        tempoBpm: 120,
        ppq: 480,
        includeMelody: true,
        includeChords: true,
        chordBaseOctave: 4
    });

    const expectedHex = readFileSync(new URL('./fixtures/simple_export.hex', import.meta.url), 'utf8').trim();

    assert.equal(toHex(bytes), expectedHex);
    assert.equal(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]), 'MThd');
});
