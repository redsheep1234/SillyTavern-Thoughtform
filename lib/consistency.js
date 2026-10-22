import { isImageReference } from './providers/image.js';

/**
 * How a scene's reference board becomes provider inputs.
 * Multi-reference is only sent to models that document it. Everyone else gets one first frame.
 * A mock text card and any non-image string stay out of a paid video request.
 */

export function keyframeForVideo({ providerId, keyframe, keyframeMock } = {}) {
    if (!isImageReference(keyframe)) {
        return { imageDataUrl: '', dropped: keyframe ? 'text' : '' };
    }
    if (keyframeMock && providerId !== 'mock') {
        return { imageDataUrl: '', dropped: 'mock' };
    }
    return { imageDataUrl: keyframe, dropped: '' };
}

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
    keyframeMock = false,
    chainFrame = '',
    manualStill = '',
} = {}) {
    const refs = references.filter(isImageReference);
    const chain = isImageReference(chainFrame) ? chainFrame : '';
    const manual = isImageReference(manualStill) ? manualStill : '';
    const still = keyframeForVideo({ providerId, keyframe, keyframeMock });
    const pinned = chain || (mode === 'keyframe' ? still.imageDataUrl : '');
    if (pinned) {
        return {
            imageDataUrl: pinned,
            referenceImages: [],
            note: 'The first frame is pinned, so extra references stay in the written prompt.',
        };
    }
    const dropNote = !chain && mode === 'keyframe' && still.dropped === 'mock'
        ? 'The keyframe is a mock text card of the prompt, so this video uses the written prompt and does not send that card as the image.'
        : (!chain && mode === 'keyframe' && still.dropped === 'text'
            ? 'The saved keyframe was text, not an image, so it was not sent.'
            : '');
    const cap = multiReferenceCap(providerId, modelId);
    if (cap > 0) {
        const all = [];
        for (const url of [manual, ...refs]) {
            if (url && !all.includes(url)) all.push(url);
            if (all.length >= cap) break;
        }
        const board = all.length ? 'Sending the reference board with this model.' : '';
        return {
            imageDataUrl: '',
            referenceImages: all,
            note: [dropNote, board].filter(Boolean).join(' '),
        };
    }
    const first = manual || refs[0] || '';
    const single = first ? 'This model takes one image. Using the primary reference as the first frame.' : '';
    return {
        imageDataUrl: first,
        referenceImages: [],
        note: [dropNote, single].filter(Boolean).join(' '),
    };
}
