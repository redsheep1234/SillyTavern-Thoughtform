/**
 * How a scene's reference board becomes provider inputs.
 * Multi-reference is only sent to models that document it. Everyone else gets one first frame.
 */

export function multiReferenceCap(providerId, modelId) {
    const model = String(modelId || '');
    if (providerId === 'xai' && model && !model.includes('lite')) return 14;
    if (providerId === 'openrouter' && /seedance/i.test(model)) return 4;
    if (providerId === 'fal' && /kling-video\/(?:v3|o3)/.test(model)) return 4;
    return 0;
}

export function planSceneImages({
    providerId,
    modelId,
    mode = 'direct',
    references = [],
    keyframe = '',
    chainFrame = '',
    manualStill = '',
} = {}) {
    const refs = references.filter(Boolean);
    const pinned = chainFrame || (mode === 'keyframe' ? keyframe : '') || '';
    if (pinned) {
        return {
            imageDataUrl: pinned,
            referenceImages: [],
            note: 'The first frame is pinned, so extra references stay in the written prompt.',
        };
    }
    const cap = multiReferenceCap(providerId, modelId);
    if (cap > 0) {
        const all = [];
        for (const url of [manualStill, ...refs]) {
            if (url && !all.includes(url)) all.push(url);
            if (all.length >= cap) break;
        }
        return {
            imageDataUrl: '',
            referenceImages: all,
            note: all.length ? 'Sending the reference board with this model.' : '',
        };
    }
    const first = manualStill || refs[0] || '';
    return {
        imageDataUrl: first,
        referenceImages: [],
        note: first ? 'This model takes one image. Using the primary reference as the first frame.' : '',
    };
}
