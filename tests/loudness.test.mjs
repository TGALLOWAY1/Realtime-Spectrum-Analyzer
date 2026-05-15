import test from 'node:test';
import assert from 'node:assert/strict';
import {
    LoudnessTracker,
    RollingHistory,
    meanSquareToLufs,
    METER_STANDARDS,
} from '../loudness.js';

test('meanSquareToLufs: silence is -Infinity', () => {
    assert.equal(meanSquareToLufs(0), -Infinity);
});

test('meanSquareToLufs: unit-energy signal is around -0.69 LUFS', () => {
    const v = meanSquareToLufs(1);
    assert.ok(Math.abs(v - -0.691) < 1e-6, `got ${v}`);
});

test('LoudnessTracker: empty state returns -Infinity', () => {
    const t = new LoudnessTracker();
    assert.equal(t.momentaryLufs(), -Infinity);
    assert.equal(t.shortTermLufs(), -Infinity);
    assert.equal(t.integratedLufs(), -Infinity);
});

test('LoudnessTracker: pushBlock advances integrated', () => {
    const t = new LoudnessTracker();
    for (let i = 0; i < 50; i++) t.pushBlock(0.1, 0.1); // 5 s, steady energy
    const integ = t.integratedLufs();
    assert.ok(isFinite(integ), 'integrated should be finite');
    assert.ok(integ > -20 && integ < -5, `unexpected integrated LUFS ${integ}`);
});

test('LoudnessTracker: short-term reflects only recent blocks', () => {
    const t = new LoudnessTracker();
    for (let i = 0; i < 100; i++) t.pushBlock(0.001, 0.1); // 10 s low
    for (let i = 0; i < 30; i++)  t.pushBlock(0.5,   0.1); // 3 s loud
    const st = t.shortTermLufs();
    const integ = t.integratedLufs();
    assert.ok(st > integ + 3, `expected short-term ${st} clearly louder than integrated ${integ}`);
});

test('LoudnessTracker: reset clears all state', () => {
    const t = new LoudnessTracker();
    for (let i = 0; i < 50; i++) t.pushBlock(0.1, 0.1);
    t.reset();
    assert.equal(t.integratedLufs(), -Infinity);
});

test('LoudnessTracker: loudnessRange ~0 for steady signal', () => {
    const t = new LoudnessTracker();
    for (let i = 0; i < 200; i++) t.pushBlock(0.1, 0.1);
    const lra = t.loudnessRange();
    assert.ok(lra < 0.5, `expected very small LRA for steady signal, got ${lra}`);
});

test('LoudnessTracker: loudnessRange picks up large dynamics', () => {
    const t = new LoudnessTracker();
    for (let i = 0; i < 100; i++) t.pushBlock(0.001, 0.1);
    for (let i = 0; i < 100; i++) t.pushBlock(0.5, 0.1);
    const lra = t.loudnessRange();
    assert.ok(lra > 3, `expected LRA > 3 LU for dynamic signal, got ${lra}`);
});

test('RollingHistory: capacity enforcement', () => {
    const h = new RollingHistory(5);
    for (let i = 0; i < 10; i++) h.push(i, i);
    assert.equal(h.length, 5);
    assert.equal(h.samples[0].t, 5);
    assert.equal(h.samples[h.samples.length - 1].t, 9);
});

test('RollingHistory: trimOlderThan', () => {
    const h = new RollingHistory(100);
    for (let i = 0; i < 10; i++) h.push(i, i * 2);
    h.trimOlderThan(5);
    assert.equal(h.samples[0].t, 5);
});

test('METER_STANDARDS contains the 4 expected presets with sane targets', () => {
    const ids = METER_STANDARDS.map((s) => s.id).sort();
    assert.deepEqual(ids, ['atsc', 'ebu', 'k14', 'k20']);
    for (const s of METER_STANDARDS) {
        assert.ok(s.target <= -10 && s.target >= -25, `unexpected target ${s.target} for ${s.id}`);
    }
});
