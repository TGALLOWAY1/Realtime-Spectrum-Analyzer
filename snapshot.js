/**
 * snapshot.js — Snapshot capture, serialization, and comparison utilities
 *
 * Architecture:
 *   - createSnapshot(): captures current FFT + insight state into a snapshot object
 *   - serializeSnapshot() / deserializeSnapshot(): JSON ↔ typed-array conversion
 *   - computeDelta(): frequency-bin-level dB difference between live and reference
 *   - computeBandDelta(): per-band energy difference summary
 *   - SnapshotStore: localStorage-backed CRUD for named snapshots
 *
 * No DOM access — the caller handles all UI rendering and user interactions.
 */


// ============================================================
// Snapshot Creation
// ============================================================

/**
 * Generate a unique ID for a snapshot.
 * @returns {string}
 */
function generateId() {
    return `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a snapshot object from current analyzer state.
 *
 * @param {Object} params
 * @param {Float32Array} params.averageData - Long-term averaged FFT data (dB)
 * @param {Float32Array} params.smoothedData - Fast-smoothed FFT data (dB)
 * @param {number} params.fftSize - Current FFT size
 * @param {number} params.sampleRate - Audio context sample rate
 * @param {Object} params.insightState - Current insight metrics
 * @param {string} [params.label] - Optional user label
 * @param {string} [params.audioSource] - Name of the audio source
 * @returns {Object} Snapshot object
 */
export function createSnapshot({
    averageData,
    smoothedData,
    fftSize,
    sampleRate,
    insightState,
    label = '',
    audioSource = '',
}) {
    if (!averageData || averageData.length === 0) {
        throw new Error('Cannot create snapshot: no FFT data available');
    }

    const id = generateId();
    const timestamp = Date.now();

    // Deep-copy the typed arrays so the snapshot is independent of live state
    const avgCopy = new Float32Array(averageData);
    const smoothCopy = smoothedData ? new Float32Array(smoothedData) : null;

    // Deep-copy insight state
    const insights = insightState ? {
        bandEnergies: (insightState.bandEnergies || []).map(b => ({ ...b })),
        centroid: insightState.centroid ? { ...insightState.centroid } : null,
        peaks: (insightState.peaks || []).map(p => ({ ...p })),
        tonalDescriptor: insightState.tonalDescriptor || '—',
    } : null;

    return {
        id,
        timestamp,
        label: label || formatTimestamp(timestamp),
        audioSource,
        fftSize,
        sampleRate,
        averageData: avgCopy,
        smoothedData: smoothCopy,
        insights,
    };
}


// ============================================================
// Serialization (for localStorage)
// ============================================================

/**
 * Serialize a snapshot to a plain JSON-safe object.
 * Converts Float32Arrays to regular arrays for JSON.stringify().
 *
 * @param {Object} snapshot
 * @returns {Object} JSON-safe object
 */
export function serializeSnapshot(snapshot) {
    return {
        ...snapshot,
        averageData: Array.from(snapshot.averageData),
        smoothedData: snapshot.smoothedData ? Array.from(snapshot.smoothedData) : null,
    };
}

/**
 * Deserialize a plain object back into a snapshot with typed arrays.
 *
 * @param {Object} obj - Parsed JSON object
 * @returns {Object} Snapshot with Float32Arrays restored
 */
export function deserializeSnapshot(obj) {
    return {
        ...obj,
        averageData: new Float32Array(obj.averageData),
        smoothedData: obj.smoothedData ? new Float32Array(obj.smoothedData) : null,
    };
}


// ============================================================
// Delta / Comparison Computation
// ============================================================

/**
 * Compute per-bin dB delta between live data and a reference snapshot.
 * Positive = live is louder, Negative = reference was louder.
 *
 * @param {Float32Array} liveData - Current averaged FFT data (dB)
 * @param {Float32Array} referenceData - Snapshot averaged FFT data (dB)
 * @returns {Float32Array} Per-bin delta in dB (same length as liveData)
 */
export function computeDelta(liveData, referenceData) {
    if (!liveData || !referenceData) return null;

    const length = Math.min(liveData.length, referenceData.length);
    const delta = new Float32Array(length);

    for (let i = 0; i < length; i++) {
        const live = liveData[i];
        const ref = referenceData[i];

        if (isFinite(live) && isFinite(ref)) {
            delta[i] = live - ref;
        } else {
            delta[i] = 0;
        }
    }

    return delta;
}

/**
 * Compute per-band energy delta between live and reference.
 *
 * @param {Array} liveBands - Band energies from computeBandEnergies() (live)
 * @param {Array} refBands - Band energies from snapshot insights
 * @returns {Array<{name: string, label: string, color: string, liveDelta: number, deltaLabel: string}>}
 */
export function computeBandDelta(liveBands, refBands) {
    if (!liveBands || !refBands) return [];

    return liveBands.map((live, i) => {
        const ref = refBands[i];
        if (!ref) return { ...live, liveDelta: 0, deltaLabel: '—' };

        const liveDb = isFinite(live.energyDb) ? live.energyDb : -100;
        const refDb = isFinite(ref.energyDb) ? ref.energyDb : -100;
        const delta = liveDb - refDb;

        let deltaLabel;
        if (Math.abs(delta) < 1) {
            deltaLabel = '≈';
        } else if (delta > 0) {
            deltaLabel = `+${delta.toFixed(1)}`;
        } else {
            deltaLabel = delta.toFixed(1);
        }

        return {
            name: live.name,
            label: live.label,
            color: live.color,
            liveDelta: delta,
            deltaLabel,
        };
    });
}

/**
 * Compute a summary comparison between live and reference insights.
 *
 * @param {Object} liveInsights - Current insightState
 * @param {Object} refInsights - Snapshot insights
 * @returns {Object} Summary comparison
 */
export function computeInsightDelta(liveInsights, refInsights) {
    if (!liveInsights || !refInsights) return null;

    const result = {};

    // Centroid comparison
    if (liveInsights.centroid && refInsights.centroid) {
        const liveCentroid = liveInsights.centroid.centroidHz || 0;
        const refCentroid = refInsights.centroid.centroidHz || 0;
        const centroidDelta = liveCentroid - refCentroid;

        let centroidLabel;
        if (Math.abs(centroidDelta) < 50) {
            centroidLabel = 'Similar brightness';
        } else if (centroidDelta > 0) {
            centroidLabel = `Brighter (+${Math.round(centroidDelta)} Hz)`;
        } else {
            centroidLabel = `Darker (${Math.round(centroidDelta)} Hz)`;
        }

        result.centroid = {
            liveCentroidHz: liveCentroid,
            refCentroidHz: refCentroid,
            deltaHz: centroidDelta,
            label: centroidLabel,
        };
    }

    // Tonal descriptor comparison
    result.liveTonal = liveInsights.tonalDescriptor || '—';
    result.refTonal = refInsights.tonalDescriptor || '—';

    // Band deltas
    result.bandDeltas = computeBandDelta(
        liveInsights.bandEnergies,
        refInsights.bandEnergies
    );

    return result;
}


// ============================================================
// Snapshot Store (localStorage-backed)
// ============================================================

const STORAGE_KEY = 'spectrum_analyzer_snapshots';
const MAX_SNAPSHOTS = 20;

/**
 * Load all saved snapshots from localStorage.
 * @returns {Array<Object>} Array of snapshot objects (deserialized)
 */
export function loadSnapshots() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return parsed.map(deserializeSnapshot);
    } catch (err) {
        console.warn('Failed to load snapshots from localStorage:', err);
        return [];
    }
}

/**
 * Save a snapshot to localStorage (prepends to list).
 * Enforces MAX_SNAPSHOTS limit by removing oldest.
 *
 * @param {Object} snapshot - Snapshot object to save
 * @returns {boolean} True if saved successfully
 */
export function saveSnapshot(snapshot) {
    try {
        const existing = loadSnapshotsRaw();
        const serialized = serializeSnapshot(snapshot);

        existing.unshift(serialized);

        // Enforce limit
        while (existing.length > MAX_SNAPSHOTS) {
            existing.pop();
        }

        localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
        return true;
    } catch (err) {
        console.warn('Failed to save snapshot to localStorage:', err);
        return false;
    }
}

/**
 * Delete a snapshot by ID.
 * @param {string} id - Snapshot ID to delete
 * @returns {boolean} True if deleted successfully
 */
export function deleteSnapshot(id) {
    try {
        const existing = loadSnapshotsRaw();
        const filtered = existing.filter(s => s.id !== id);

        if (filtered.length === existing.length) return false; // not found

        localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
        return true;
    } catch (err) {
        console.warn('Failed to delete snapshot:', err);
        return false;
    }
}

/**
 * Rename a snapshot by ID.
 * @param {string} id
 * @param {string} newLabel
 * @returns {boolean}
 */
export function renameSnapshot(id, newLabel) {
    try {
        const existing = loadSnapshotsRaw();
        const found = existing.find(s => s.id === id);
        if (!found) return false;

        found.label = newLabel;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
        return true;
    } catch (err) {
        console.warn('Failed to rename snapshot:', err);
        return false;
    }
}

/**
 * Internal: Load raw (serialized) snapshots without deserializing typed arrays.
 * @returns {Array}
 */
function loadSnapshotsRaw() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}


// ============================================================
// Utility helpers
// ============================================================

/**
 * Format a timestamp to a short readable string.
 * @param {number} ts - Unix timestamp in ms
 * @returns {string}
 */
function formatTimestamp(ts) {
    const d = new Date(ts);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    const s = d.getSeconds().toString().padStart(2, '0');
    return `Snap ${h}:${m}:${s}`;
}
