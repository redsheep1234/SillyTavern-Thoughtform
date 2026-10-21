/** Per-chat project: versions, continuity, and the next episode. */

export function emptyProject(chatKey) {
    return {
        id: chatKey || 'chat',
        title: 'Episode 1',
        episode: 1,
        versions: [],
        continuity: {
            outfits: [],
            places: [],
            lastFrame: '',
            note: '',
        },
    };
}

export function ensureProject(stored, chatKey) {
    if (stored?.versions && stored?.continuity) return stored;
    return emptyProject(chatKey);
}

export function snapshotVersion(project, { scenes, note, file }) {
    const version = {
        id: `v${project.versions.length + 1}`,
        at: new Date().toISOString(),
        note: note || '',
        file: file || '',
        episode: project.episode || 1,
        scenes: (scenes || []).map(slimScene),
    };
    return {
        ...project,
        versions: [...project.versions, version].slice(-12),
        continuity: continuityFrom(scenes, project.continuity),
    };
}

export function nextEpisode(project) {
    const episode = (project.episode || 1) + 1;
    return {
        ...project,
        episode,
        title: `Episode ${episode}`,
    };
}

export function continuityFrom(scenes, previous = {}) {
    const outfits = [];
    const places = [];
    for (const scene of scenes || []) {
        for (const member of scene.cast || []) {
            if (!member.outfitId && !member.outfitName) continue;
            outfits.push({ name: member.name, outfitId: member.outfitId || '', outfitName: member.outfitName || '' });
        }
        for (const place of scene.placeCast || []) places.push({ kind: place.kind, name: place.name, key: place.key });
    }
    const last = [...(scenes || [])].reverse().find((scene) => scene.keyframeDataUrl);
    return {
        outfits: dedupe(outfits, (item) => item.name),
        places: dedupe(places, (item) => item.key || item.name),
        lastFrame: last?.keyframeDataUrl && last.keyframeDataUrl.length < 180000 ? last.keyframeDataUrl : (previous.lastFrame || ''),
        note: previous.note || '',
    };
}

export function continuityPrompt(continuity) {
    if (!continuity) return '';
    const outfits = (continuity.outfits || []).map((item) => `${item.name} still wears ${item.outfitName || 'the previous outfit'}`);
    const places = (continuity.places || []).map((item) => `${item.kind} ${item.name}`);
    return [
        outfits.length ? `Carry outfits forward: ${outfits.join('; ')}.` : '',
        places.length ? `Recurring places and props: ${places.join('; ')}.` : '',
        continuity.lastFrame ? 'A still of the previous episode’s last frame is available to chain.' : '',
    ].filter(Boolean).join('\n');
}

function slimScene(scene) {
    const copy = { ...scene };
    delete copy.keyframeDataUrl;
    delete copy.memberStills;
    return copy;
}

function dedupe(items, key) {
    const seen = new Set();
    const next = [];
    for (const item of items) {
        const id = key(item);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        next.push(item);
    }
    return next.slice(-24);
}
