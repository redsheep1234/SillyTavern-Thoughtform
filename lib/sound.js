/** Mood beds and ducking. User files win. Otherwise a short local tone stands in for a paid music API. */

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
