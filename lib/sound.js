/** Optional user tracks. Music is off unless the user turns it on and picks a file or a tag. Nothing here generates music. */

export function moodForTheme(themeId) {
    const map = {
        noir: 'low tense room tone, distant rain, no melody',
        'neon-night': 'soft night traffic and a distant hum',
        'golden-hour': 'warm air, quiet outdoor wash',
        documentary: 'light room tone, muffled street',
        'epic-fantasy': 'low wind over a wide place',
        ghibli: 'gentle outdoor air',
        slice: 'quiet indoor room tone',
    };
    return map[themeId] || 'soft room tone under the scene';
}

export function duckPlan(cues, bed = 0.35, ducked = 0.12) {
    return (cues || []).map((cue) => ({
        start: cue.start,
        end: cue.end,
        music: ducked,
        before: bed,
    }));
}

export function buildElevenSfxBody(prompt, seconds = 4) {
    return {
        text: String(prompt || 'soft room tone').slice(0, 400),
        duration_seconds: Math.min(22, Math.max(1, Number(seconds) || 4)),
        prompt_influence: 0.3,
    };
}

export function libraryClip(library, id) {
    return (library || []).find((item) => item.id === id) || null;
}

export function pickTrack(library, { id = '', tag = '' } = {}) {
    const rows = (library || []).filter((item) => item && item.url);
    if (id) return rows.find((item) => item.id === id) || null;
    const needle = String(tag || '').trim().toLowerCase();
    if (!needle) return null;
    return rows.find((item) => {
        const tags = Array.isArray(item.tags) ? item.tags : String(item.tags || item.tag || '').split(',');
        return tags.some((entry) => String(entry).trim().toLowerCase() === needle)
            || String(item.name || '').toLowerCase().includes(needle);
    }) || null;
}

/** Off by default. A missing file stays silent instead of calling a music model. */
export function musicForAnimatic({ enabled = false, library = [], trackId = '', tag = '' } = {}) {
    if (!enabled) return null;
    return pickTrack(library, { id: trackId, tag }) || pickTrack(library, { tag });
}
