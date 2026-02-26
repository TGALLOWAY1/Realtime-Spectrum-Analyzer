const QUALITY_INTERVALS = {
    maj: [0, 4, 7],
    min: [0, 3, 7],
    dim: [0, 3, 6],
    aug: [0, 4, 8],
    sus2: [0, 2, 7],
    sus4: [0, 5, 7],
    '7': [0, 4, 7, 10],
    maj7: [0, 4, 7, 11],
    min7: [0, 3, 7, 10],
    hdim7: [0, 3, 6, 10]
};

/**
 * @param {number} value
 * @returns {number[]}
 */
function encodeVarLen(value) {
    let buffer = value & 0x7f;
    const bytes = [];

    while ((value >>= 7) > 0) {
        buffer <<= 8;
        buffer |= (value & 0x7f) | 0x80;
    }

    while (true) {
        bytes.push(buffer & 0xff);
        if (buffer & 0x80) {
            buffer >>= 8;
        } else {
            break;
        }
    }

    return bytes;
}

/**
 * @param {number} value
 * @returns {number[]}
 */
function toUint32(value) {
    return [
        (value >>> 24) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 8) & 0xff,
        value & 0xff
    ];
}

/**
 * @param {number} value
 * @returns {number[]}
 */
function toUint16(value) {
    return [(value >>> 8) & 0xff, value & 0xff];
}

/**
 * @param {Array<{tick: number, type: 'on'|'off', channel: number, pitch: number, velocity: number}>} events
 * @returns {Uint8Array}
 */
function encodeTrack(events) {
    events.sort((a, b) => {
        if (a.tick !== b.tick) {
            return a.tick - b.tick;
        }
        if (a.type !== b.type) {
            return a.type === 'off' ? -1 : 1;
        }
        return a.pitch - b.pitch;
    });

    let lastTick = 0;
    const body = [];

    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const delta = Math.max(0, event.tick - lastTick);
        body.push(...encodeVarLen(delta));

        const status = event.type === 'on' ? 0x90 | (event.channel & 0x0f) : 0x80 | (event.channel & 0x0f);
        body.push(status, event.pitch & 0x7f, event.velocity & 0x7f);
        lastTick = event.tick;
    }

    body.push(0x00, 0xff, 0x2f, 0x00);

    return new Uint8Array([
        0x4d, 0x54, 0x72, 0x6b,
        ...toUint32(body.length),
        ...body
    ]);
}

/**
 * @param {number} bpm
 * @returns {Uint8Array}
 */
function createTempoTrack(bpm) {
    const mpqn = Math.round(60000000 / bpm);
    const body = [
        0x00,
        0xff,
        0x51,
        0x03,
        (mpqn >>> 16) & 0xff,
        (mpqn >>> 8) & 0xff,
        mpqn & 0xff,
        0x00,
        0xff,
        0x2f,
        0x00
    ];

    return new Uint8Array([
        0x4d, 0x54, 0x72, 0x6b,
        ...toUint32(body.length),
        ...body
    ]);
}

/**
 * @param {number} sec
 * @param {number} bpm
 * @param {number} ppq
 * @returns {number}
 */
function secToTicks(sec, bpm, ppq) {
    return Math.max(0, Math.round(sec * (bpm * ppq) / 60));
}

/**
 * @param {import('./types.js').ChordEvent} chord
 * @param {{chordBaseOctave: number}} options
 * @returns {number[]}
 */
function chordToMidiPitches(chord, options) {
    if (typeof chord.rootPitchClass !== 'number') {
        return [];
    }

    const intervals = QUALITY_INTERVALS[chord.quality] || QUALITY_INTERVALS.maj;
    const rootMidi = options.chordBaseOctave * 12 + chord.rootPitchClass;

    return intervals.map((interval) => Math.max(0, Math.min(127, rootMidi + interval)));
}

/**
 * @param {import('./types.js').AnalysisResult} result
 * @param {{tempoBpm?: number, ppq?: number, includeMelody?: boolean, includeChords?: boolean, chordBaseOctave?: number}} [options]
 * @returns {Uint8Array}
 */
export function exportToMidi(result, options = {}) {
    const tempoBpm = options.tempoBpm || 120;
    const ppq = options.ppq || 480;
    const includeMelody = options.includeMelody !== false;
    const includeChords = options.includeChords !== false;
    const chordBaseOctave = options.chordBaseOctave || 4;

    const tracks = [createTempoTrack(tempoBpm)];

    if (includeChords) {
        const chordEvents = [];

        for (let i = 0; i < result.chords.length; i++) {
            const chord = result.chords[i];
            const pitches = chordToMidiPitches(chord, { chordBaseOctave });
            const startTick = secToTicks(chord.startSec, tempoBpm, ppq);
            const endTick = secToTicks(chord.startSec + chord.durationSec, tempoBpm, ppq);
            const velocity = Math.max(40, Math.min(110, Math.round(55 + (chord.confidence || 0.5) * 45)));

            for (let p = 0; p < pitches.length; p++) {
                chordEvents.push({ tick: startTick, type: 'on', channel: 0, pitch: pitches[p], velocity });
                chordEvents.push({ tick: Math.max(startTick + 1, endTick), type: 'off', channel: 0, pitch: pitches[p], velocity: 0 });
            }
        }

        tracks.push(encodeTrack(chordEvents));
    }

    if (includeMelody) {
        const melodyEvents = [];
        const source = result.melodyNotes.length ? result.melodyNotes : result.notes;

        for (let i = 0; i < source.length; i++) {
            const note = source[i];
            const pitch = Math.max(0, Math.min(127, Math.round(note.pitchMidi)));
            const startTick = secToTicks(note.startSec, tempoBpm, ppq);
            const endTick = secToTicks(note.startSec + note.durationSec, tempoBpm, ppq);
            const velocity = note.velocity
                ? Math.max(1, Math.min(127, note.velocity))
                : Math.max(40, Math.min(120, Math.round(50 + note.confidence * 70)));

            melodyEvents.push({ tick: startTick, type: 'on', channel: 1, pitch, velocity });
            melodyEvents.push({ tick: Math.max(startTick + 1, endTick), type: 'off', channel: 1, pitch, velocity: 0 });
        }

        tracks.push(encodeTrack(melodyEvents));
    }

    const header = [
        0x4d, 0x54, 0x68, 0x64,
        0x00, 0x00, 0x00, 0x06,
        ...toUint16(1),
        ...toUint16(tracks.length),
        ...toUint16(ppq)
    ];

    const totalLength = header.length + tracks.reduce((acc, track) => acc + track.length, 0);
    const out = new Uint8Array(totalLength);

    let offset = 0;
    out.set(header, offset);
    offset += header.length;

    for (let i = 0; i < tracks.length; i++) {
        out.set(tracks[i], offset);
        offset += tracks[i].length;
    }

    return out;
}
