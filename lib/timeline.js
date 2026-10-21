export const SHOT_TYPES = [
    { id: 'wide', label: 'Wide' },
    { id: 'medium', label: 'Medium' },
    { id: 'close-up', label: 'Close-up' },
    { id: 'pov', label: 'POV' },
    { id: 'ots', label: 'Over the shoulder' },
];

export const CAMERA_MOVES = [
    { id: 'static', label: 'Static' },
    { id: 'pan', label: 'Pan' },
    { id: 'dolly', label: 'Dolly' },
    { id: 'orbit', label: 'Orbit' },
    { id: 'handheld', label: 'Handheld' },
];

export function shotTypeOf(scene) {
    return SHOT_TYPES.some((item) => item.id === scene?.shotType) ? scene.shotType : 'medium';
}

export function cameraMoveOf(scene) {
    return CAMERA_MOVES.some((item) => item.id === scene?.cameraMove) ? scene.cameraMove : 'static';
}

export function shotLine(scene) {
    const type = SHOT_TYPES.find((item) => item.id === shotTypeOf(scene));
    const move = CAMERA_MOVES.find((item) => item.id === cameraMoveOf(scene));
    return `${type.label} shot, ${move.label.toLowerCase()} camera.`;
}

export function trimmedDuration(scene) {
    const full = Math.max(0.5, Number(scene?.duration) || 5);
    const start = Math.min(full - 0.25, Math.max(0, Number(scene?.trimIn) || 0));
    const endRaw = scene?.trimOut == null || scene.trimOut === '' ? full : Number(scene.trimOut);
    const end = Math.max(start + 0.25, Math.min(full, Number.isFinite(endRaw) ? endRaw : full));
    return Math.round((end - start) * 1000) / 1000;
}

export function splitScene(scene, atSeconds) {
    const full = Math.max(1, Number(scene?.duration) || 5);
    const at = Math.min(full - 0.5, Math.max(0.5, Number(atSeconds) || full / 2));
    const left = { ...scene, duration: round(at), title: `${scene.title || 'Scene'} A`, continuity: scene.continuity || '' };
    const right = {
        ...scene,
        duration: round(full - at),
        title: `${scene.title || 'Scene'} B`,
        continuity: scene.continuity || 'Continue the previous shot.',
        castEdited: false,
    };
    for (const half of [left, right]) {
        delete half.keyframeDataUrl;
        delete half.keyframeApproved;
        delete half.keyframePrompt;
        delete half.memberStills;
    }
    return [left, right];
}

export function mergeScenes(left, right) {
    const merged = {
        ...left,
        title: left.title || right.title,
        prompt: [left.prompt, right.prompt].map((part) => String(part || '').trim()).filter(Boolean).join('\n'),
        dialogue: [left.dialogue, right.dialogue].map((part) => String(part || '').trim()).filter(Boolean).join('\n'),
        lines: [...(left.lines || []), ...(right.lines || [])],
        narration: [left.narration, right.narration].map((part) => String(part || '').trim()).filter(Boolean).join(' '),
        duration: round((Number(left.duration) || 0) + (Number(right.duration) || 0)) || 5,
        characters: [...new Set([...(left.characters || []), ...(right.characters || [])])],
        locations: [...new Set([...(left.locations || []), ...(right.locations || [])])],
        props: [...new Set([...(left.props || []), ...(right.props || [])])],
        castEdited: false,
        cast: left.cast || right.cast || [],
    };
    delete merged.keyframeDataUrl;
    delete merged.keyframeApproved;
    delete merged.keyframePrompt;
    delete merged.memberStills;
    return merged;
}

function round(value) {
    return Math.round(value * 1000) / 1000;
}
