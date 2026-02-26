/**
 * @param {number} startA
 * @param {number} durationA
 * @param {number} startB
 * @param {number} durationB
 * @returns {boolean}
 */
function overlaps(startA, durationA, startB, durationB) {
    const endA = startA + durationA;
    const endB = startB + durationB;
    return startA < endB && startB < endA;
}

/**
 * Simple framewise melody/harmony split:
 * - Melody candidate is the highest active pitch per frame.
 * - Notes repeatedly selected as top voice become melody notes.
 * - Remaining notes become harmony notes.
 *
 * @param {import('./types.js').NoteEvent[]} notes
 * @param {{timeResolutionMs: number, extractMelody: boolean, extractHarmony: boolean}} options
 * @returns {{melodyNotes: import('./types.js').NoteEvent[], harmonyNotes: import('./types.js').NoteEvent[]}}
 */
export function splitMelodyHarmony(notes, options) {
    if (!notes.length) {
        return { melodyNotes: [], harmonyNotes: [] };
    }

    const frameSec = Math.max(0.01, options.timeResolutionMs / 1000);
    let maxEndSec = 0;

    for (let i = 0; i < notes.length; i++) {
        const endSec = notes[i].startSec + notes[i].durationSec;
        if (endSec > maxEndSec) {
            maxEndSec = endSec;
        }
    }

    const stats = notes.map(() => ({ activeFrames: 0, topFrames: 0 }));

    for (let frameStart = 0; frameStart <= maxEndSec; frameStart += frameSec) {
        const frameNotes = [];

        for (let i = 0; i < notes.length; i++) {
            if (overlaps(notes[i].startSec, notes[i].durationSec, frameStart, frameSec)) {
                frameNotes.push(i);
                stats[i].activeFrames += 1;
            }
        }

        if (!frameNotes.length) {
            continue;
        }

        let melodyIndex = frameNotes[0];
        for (let i = 1; i < frameNotes.length; i++) {
            const candidateIndex = frameNotes[i];
            const candidate = notes[candidateIndex];
            const melody = notes[melodyIndex];
            if (candidate.pitchMidi > melody.pitchMidi ||
                (candidate.pitchMidi === melody.pitchMidi && candidate.confidence > melody.confidence)) {
                melodyIndex = candidateIndex;
            }
        }

        stats[melodyIndex].topFrames += 1;
    }

    const melodyNotes = [];
    const harmonyNotes = [];

    for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        const noteStats = stats[i];
        const topRatio = noteStats.activeFrames > 0
            ? noteStats.topFrames / noteStats.activeFrames
            : 0;

        const isMelody = topRatio >= 0.55 && note.pitchMidi >= 55;

        if (isMelody && options.extractMelody) {
            melodyNotes.push(note);
        } else if (options.extractHarmony) {
            harmonyNotes.push(note);
        }
    }

    return {
        melodyNotes,
        harmonyNotes
    };
}
