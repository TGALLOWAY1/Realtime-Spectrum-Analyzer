/**
 * @param {number[]} chroma
 * @returns {number}
 */
function chromaEntropy(chroma) {
    let sum = 0;
    for (let i = 0; i < chroma.length; i++) {
        sum += Math.max(0, chroma[i]);
    }

    if (sum === 0) {
        return 1;
    }

    let entropy = 0;
    for (let i = 0; i < chroma.length; i++) {
        const p = Math.max(0, chroma[i]) / sum;
        if (p > 0) {
            entropy += -p * Math.log2(p);
        }
    }

    return entropy / Math.log2(12);
}

/**
 * @param {import('./types.js').ChordEvent[]} chords
 * @returns {number}
 */
function chordErraticness(chords) {
    if (chords.length <= 1) {
        return 0;
    }

    let changes = 0;
    let totalTransitions = 0;

    for (let i = 1; i < chords.length; i++) {
        totalTransitions += 1;
        const prev = chords[i - 1];
        const cur = chords[i];
        if (prev.label !== cur.label) {
            changes += 1;
        }
    }

    return totalTransitions > 0 ? changes / totalTransitions : 0;
}

/**
 * @param {{keyEstimate?: import('./types.js').KeyEstimate, chords: import('./types.js').ChordEvent[], chromaFrames: number[][], atonalThreshold: number}} params
 * @returns {{atonalScore: number, isAtonal: boolean, factors: {keyInstability: number, chordMismatch: number, chordErraticness: number, chromaEntropy: number}}}
 */
export function scoreAtonality(params) {
    const keyInstability = params.keyEstimate ? 1 - params.keyEstimate.confidence : 1;

    let chordMismatch = 1;
    if (params.chords.length > 0) {
        let confidenceSum = 0;
        for (let i = 0; i < params.chords.length; i++) {
            confidenceSum += params.chords[i].confidence;
        }
        chordMismatch = 1 - confidenceSum / params.chords.length;
    }

    const erraticness = chordErraticness(params.chords);

    let entropy = 1;
    if (params.chromaFrames.length > 0) {
        let entropySum = 0;
        for (let i = 0; i < params.chromaFrames.length; i++) {
            entropySum += chromaEntropy(params.chromaFrames[i]);
        }
        entropy = entropySum / params.chromaFrames.length;
    }

    const atonalScore = Math.max(
        0,
        Math.min(
            1,
            keyInstability * 0.35 +
                chordMismatch * 0.3 +
                erraticness * 0.15 +
                entropy * 0.2
        )
    );

    return {
        atonalScore,
        isAtonal: atonalScore >= params.atonalThreshold,
        factors: {
            keyInstability,
            chordMismatch,
            chordErraticness: erraticness,
            chromaEntropy: entropy
        }
    };
}
