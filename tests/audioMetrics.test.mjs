import test from 'node:test';
import assert from 'node:assert/strict';
import {
    rms,
    peak,
    truePeak,
    crestFactorDb,
    correlation,
    balance,
    midSideWidth,
    linearToDb,
    classifyStereoField,
    fractionalOctaveSmoothDb,
} from '../audioMetrics.js';

const TAU = Math.PI * 2;
function sineWave(freqHz, sampleRate, n, amp = 1) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = amp * Math.sin((TAU * freqHz * i) / sampleRate);
    return out;
}

test('rms of silence is 0', () => {
    assert.equal(rms(new Float32Array(512)), 0);
});

test('rms of unit sine is ~1/sqrt(2)', () => {
    const buf = sineWave(440, 48000, 4096, 1);
    const r = rms(buf);
    assert.ok(Math.abs(r - Math.SQRT1_2) < 1e-2, `expected ~0.707, got ${r}`);
});

test('peak of unit sine is ~1', () => {
    const buf = sineWave(440, 48000, 4096, 1);
    assert.ok(peak(buf) > 0.99 && peak(buf) <= 1.001);
});

test('truePeak is >= peak', () => {
    const buf = sineWave(440, 48000, 4096, 0.8);
    const p = peak(buf);
    const tp = truePeak(buf);
    assert.ok(tp >= p - 1e-9, `truePeak ${tp} should be >= peak ${p}`);
});

test('crestFactorDb is 0 on silence', () => {
    assert.equal(crestFactorDb(new Float32Array(256)), 0);
});

test('crestFactorDb of sine is ~3 dB', () => {
    const buf = sineWave(440, 48000, 4096, 1);
    const cf = crestFactorDb(buf);
    assert.ok(Math.abs(cf - 3.01) < 0.5, `expected ~3.01 dB, got ${cf}`);
});

test('correlation: identical buffers = +1', () => {
    const buf = sineWave(440, 48000, 4096);
    const c = correlation(buf, buf);
    assert.ok(c > 0.999, `expected +1, got ${c}`);
});

test('correlation: phase-inverted buffers = -1', () => {
    const buf = sineWave(440, 48000, 4096);
    const inv = buf.map((v) => -v);
    const c = correlation(buf, inv);
    assert.ok(c < -0.999, `expected -1, got ${c}`);
});

test('correlation: silence returns 0 (no divide-by-zero)', () => {
    const buf = new Float32Array(512);
    assert.equal(correlation(buf, buf), 0);
});

test('balance: centered when L = R', () => {
    assert.equal(balance(0.5, 0.5), 0);
});

test('balance: -1 when only L, +1 when only R', () => {
    assert.equal(balance(1, 0), -1);
    assert.equal(balance(0, 1), 1);
});

test('midSideWidth: mono (L=R) returns ~0', () => {
    const buf = sineWave(440, 48000, 4096);
    const w = midSideWidth(buf, buf);
    assert.ok(w < 0.01, `expected ~0 for mono, got ${w}`);
});

test('midSideWidth: phase-inverted returns max width 1 (mid is zero, capped)', () => {
    const buf = sineWave(440, 48000, 4096);
    const inv = buf.map((v) => -v);
    const w = midSideWidth(buf, inv);
    assert.equal(w, 1.0);
});

test('linearToDb basic invariants', () => {
    assert.equal(linearToDb(1), 0);
    assert.ok(Math.abs(linearToDb(0.5) - (-6.02)) < 0.05);
    assert.equal(linearToDb(0), -Infinity);
});

test('classifyStereoField: balanced wide stereo = ok', () => {
    assert.equal(classifyStereoField(0.5, 0.4, 0.05), 'Stereo Field Looks Good');
});
test('classifyStereoField: negative correlation flagged', () => {
    assert.equal(classifyStereoField(-0.4, 0.6, 0), 'Mono Compatibility Issue');
});
test('classifyStereoField: severe imbalance flagged', () => {
    assert.equal(classifyStereoField(0.6, 0.4, -0.7), 'Left/Right Balance Skewed');
});

test('fractionalOctaveSmoothDb: octFraction=0 leaves data untouched', () => {
    const input = new Float32Array([-30, -25, -20, -15, -10, -15, -20]);
    const output = new Float32Array(input.length);
    fractionalOctaveSmoothDb(input, output, 48000, 4096, 0);
    for (let i = 0; i < input.length; i++) assert.equal(output[i], input[i]);
});

test('fractionalOctaveSmoothDb: smooths a spiky array (variance drops)', () => {
    const n = 2048;
    const input = new Float32Array(n);
    for (let i = 0; i < n; i++) input[i] = (i % 2 === 0 ? -10 : -50);
    const output = new Float32Array(n);
    fractionalOctaveSmoothDb(input, output, 48000, 4096, 3);
    let inputVar = 0;
    let outputVar = 0;
    const inMean = -30;
    let outSum = 0;
    for (let i = 200; i < n - 200; i++) outSum += output[i];
    const outMean = outSum / (n - 400);
    for (let i = 200; i < n - 200; i++) {
        inputVar += (input[i] - inMean) ** 2;
        outputVar += (output[i] - outMean) ** 2;
    }
    assert.ok(outputVar < inputVar * 0.5, `expected variance to drop, got input ${inputVar} -> output ${outputVar}`);
});
