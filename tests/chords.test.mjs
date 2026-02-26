import test from 'node:test';
import assert from 'node:assert/strict';
import { inferChordsFromChroma, scoreChordTemplates } from '../analysis/chords.js';

test('scoreChordTemplates identifies C major triad', () => {
    const chroma = [1.0, 0.05, 0.05, 0.1, 0.9, 0.05, 0.05, 0.95, 0.05, 0.05, 0.05, 0.05];
    const scored = scoreChordTemplates(chroma);

    assert.equal(scored.rootPitchClass, 0);
    assert.ok(scored.label.startsWith('C'));
    assert.ok(scored.confidence > 0.2);
});

test('inferChordsFromChroma merges adjacent identical windows', () => {
    const frameTimesSec = [];
    const chromaFrames = [];

    for (let i = 0; i < 16; i++) {
        frameTimesSec.push(i * 0.1);
        chromaFrames.push([1.0, 0, 0, 0, 0.9, 0, 0, 0.95, 0, 0, 0, 0]); // C-major dominant
    }

    const inferred = inferChordsFromChroma(chromaFrames, frameTimesSec, {
        windowMs: 400,
        hopMs: 200
    });

    assert.equal(inferred.chords.length, 1);
    assert.ok(inferred.chords[0].label.startsWith('C'));
    assert.ok(inferred.chords[0].durationSec > 1.0);
});
