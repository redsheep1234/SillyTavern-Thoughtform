/**
 * One paid job at a time.
 * The first click holds the lock synchronously, before any await.
 * A nested step passes owned so it can change the phase without starting a second job.
 */
export function createJobLock() {
    const state = { running: false, phase: '', startedAt: 0 };
    return {
        state,
        hold(phase, { owned = false } = {}) {
            if (state.running && !owned) return false;
            if (!owned) {
                state.running = true;
                state.phase = phase === 'video' ? 'video' : 'keyframe';
                state.startedAt = Date.now();
            } else if (phase) {
                state.phase = phase === 'video' ? 'video' : 'keyframe';
            }
            return true;
        },
        release({ owned = false } = {}) {
            if (owned) return;
            state.running = false;
            state.phase = '';
            state.startedAt = 0;
        },
    };
}

export function jobButtonLabel(phase) {
    return phase === 'video' ? 'Generating video…' : 'Generating keyframe…';
}
