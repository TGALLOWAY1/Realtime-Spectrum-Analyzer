/**
 * @param {number} size
 * @returns {Float32Array}
 */
export function createHannWindow(size) {
    const window = new Float32Array(size);
    for (let i = 0; i < size; i++) {
        window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return window;
}

/**
 * In-place radix-2 Cooley-Tukey FFT.
 *
 * @param {Float32Array} real
 * @param {Float32Array} imag
 */
export function fftInPlace(real, imag) {
    const n = real.length;

    let j = 0;
    for (let i = 1; i < n; i++) {
        let bit = n >> 1;
        while (j & bit) {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;

        if (i < j) {
            const realTmp = real[i];
            real[i] = real[j];
            real[j] = realTmp;

            const imagTmp = imag[i];
            imag[i] = imag[j];
            imag[j] = imagTmp;
        }
    }

    for (let len = 2; len <= n; len <<= 1) {
        const angle = (-2 * Math.PI) / len;
        const wLenCos = Math.cos(angle);
        const wLenSin = Math.sin(angle);

        for (let i = 0; i < n; i += len) {
            let wCos = 1;
            let wSin = 0;

            for (let k = 0; k < len / 2; k++) {
                const uReal = real[i + k];
                const uImag = imag[i + k];
                const vReal = real[i + k + len / 2] * wCos - imag[i + k + len / 2] * wSin;
                const vImag = real[i + k + len / 2] * wSin + imag[i + k + len / 2] * wCos;

                real[i + k] = uReal + vReal;
                imag[i + k] = uImag + vImag;
                real[i + k + len / 2] = uReal - vReal;
                imag[i + k + len / 2] = uImag - vImag;

                const nextWCos = wCos * wLenCos - wSin * wLenSin;
                const nextWSin = wCos * wLenSin + wSin * wLenCos;
                wCos = nextWCos;
                wSin = nextWSin;
            }
        }
    }
}

/**
 * @param {Float32Array} audioBuffer
 * @param {{sampleRate: number, frameSize: number, hopSize: number}} config
 * @returns {{spectra: Float32Array[], frameTimesSec: number[], binFrequenciesHz: Float32Array}}
 */
export function computeStftFrames(audioBuffer, config) {
    const { sampleRate, frameSize, hopSize } = config;
    const window = createHannWindow(frameSize);
    const spectra = [];
    const frameTimesSec = [];

    const binCount = frameSize / 2;
    const binFrequenciesHz = new Float32Array(binCount);
    for (let i = 0; i < binCount; i++) {
        binFrequenciesHz[i] = (i * sampleRate) / frameSize;
    }

    for (let frameStart = 0; frameStart < audioBuffer.length; frameStart += hopSize) {
        const real = new Float32Array(frameSize);
        const imag = new Float32Array(frameSize);

        for (let i = 0; i < frameSize; i++) {
            const sample = frameStart + i < audioBuffer.length ? audioBuffer[frameStart + i] : 0;
            real[i] = sample * window[i];
        }

        fftInPlace(real, imag);

        const magnitudes = new Float32Array(binCount);
        for (let i = 0; i < binCount; i++) {
            magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
        }

        spectra.push(magnitudes);
        frameTimesSec.push(frameStart / sampleRate);

        if (frameStart + frameSize >= audioBuffer.length) {
            break;
        }
    }

    return {
        spectra,
        frameTimesSec,
        binFrequenciesHz
    };
}
