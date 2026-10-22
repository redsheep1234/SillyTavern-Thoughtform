/** Paths from SillyTavern POST /api/files/upload, and the scene fields chat metadata may keep. */

export function fileSrc(path) {
    const value = String(path || '').trim();
    if (!value) return '';
    if (/^(data:|blob:|https?:|\/)/i.test(value)) return value;
    return `/${value.replace(/^\/+/, '')}`;
}

export function messageIdForScene(scene, fallbackId = null) {
    const ids = (scene?.lines || [])
        .map((line) => line?.messageId)
        .filter((id) => id != null && id !== '');
    if (ids.length) return ids[ids.length - 1];
    return fallbackId ?? null;
}

/** Drop bulky data URLs once a stored file can bring the picture back after reload. */
export function sceneForChat(scene) {
    if (!scene || typeof scene !== 'object') return scene;
    const copy = { ...scene };
    if (copy.keyframeFile) delete copy.keyframeDataUrl;
    if (copy.memberStillFiles && typeof copy.memberStillFiles === 'object') {
        const stills = { ...(copy.memberStills || {}) };
        for (const key of Object.keys(copy.memberStillFiles)) {
            if (copy.memberStillFiles[key]) delete stills[key];
        }
        if (Object.keys(stills).length) copy.memberStills = stills;
        else delete copy.memberStills;
    }
    return copy;
}

export function restoreSceneMedia(scene) {
    if (!scene || typeof scene !== 'object') return scene;
    const next = { ...scene };
    if (!next.keyframeDataUrl && next.keyframeFile) next.keyframeDataUrl = fileSrc(next.keyframeFile);
    if (next.memberStillFiles && typeof next.memberStillFiles === 'object') {
        const stills = { ...(next.memberStills || {}) };
        for (const [key, path] of Object.entries(next.memberStillFiles)) {
            if (!stills[key] && path) stills[key] = fileSrc(path);
        }
        next.memberStills = stills;
    }
    return next;
}
