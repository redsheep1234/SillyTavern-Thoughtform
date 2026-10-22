import { pollUntil } from '../poll.js';
import { downloadBinary, fetchJson } from '../transport.js';

export const XAI_MODELS = [
    {
        id: 'grok-imagine-video-1.5-lite',
        label: 'Grok Imagine Video 1.5 Lite',
        resolutions: ['480p', '720p', '1080p'],
        aspects: ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9', '5:2'],
        note: 'Cheapest hosted default. 1080p is upscaled from 720p.',
    },
    {
        id: 'grok-imagine-video-1.5',
        label: 'Grok Imagine Video 1.5',
        resolutions: ['480p', '720p', '1080p'],
        aspects: ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9', '5:2'],
        note: 'Native 1080p.',
    },
];

const ORIGIN = 'https://api.x.ai';

export function findXaiModel(id) {
    return XAI_MODELS.find((model) => model.id === id) || null;
}

/**
 * xAI has no negative-prompt field. The avoid line is appended so the panel
 * setting is not dropped on the floor.
 */
export function buildXaiBody(modelId, request) {
    const known = findXaiModel(modelId);
    const resolutions = known?.resolutions || ['480p', '720p', '1080p'];
    const aspects = known?.aspects || ['16:9', '9:16', '1:1'];
    const duration = Math.min(15, Math.max(1, Math.round(Number(request.duration) || 5)));
    let prompt = String(request.prompt || '');
    if (request.negativePrompt) prompt = `${prompt}\nAvoid: ${request.negativePrompt}`;
    const body = {
        model: modelId,
        prompt,
        duration,
        resolution: resolutions.includes(request.resolution) ? request.resolution : '720p',
        aspect_ratio: aspects.includes(request.aspectRatio) ? request.aspectRatio : '16:9',
        generate_audio: Boolean(request.generateAudio),
    };
    const refs = (request.referenceImages || []).filter(Boolean);
    const lite = String(modelId).includes('lite');
    if (request.imageDataUrl) body.image = request.imageDataUrl;
    if (!lite && refs.length) {
        body.reference_images = refs.slice(0, 14).map((url) => ({ url }));
        const tags = body.reference_images.map((_, index) => `<IMAGE_${index}>`);
        if (!tags.every((tag) => body.prompt.includes(tag))) {
            body.prompt = `${body.prompt}\nCharacter references: ${tags.join(' ')}.`;
        }
    }
    return body;
}

function headersFor(key) {
    return {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
    };
}

export async function generateXai(request) {
    const key = request.settings?.xaiKey;
    if (!key) throw new Error('Add an xAI key under Extensions → Thoughtform.');
    const modelId = request.modelId || request.settings.xaiModel || XAI_MODELS[0].id;
    const body = buildXaiBody(modelId, request);
    const mode = request.corsMode || request.settings.corsMode || 'auto';
    const headers = headersFor(key);
    const fetchOptions = { fetchImpl: request.fetchImpl, mode, signal: request.signal, headers };
    request.onProgress?.({ message: `Submitting ${modelId}` });
    const queued = await fetchJson(`${ORIGIN}/v1/videos/generations`, {
        ...fetchOptions,
        method: 'POST',
        body: JSON.stringify(body),
    });
    const requestId = queued.request_id || queued.id;
    if (!requestId) throw new Error('xAI did not return a request id.');
    request.onQueued?.({
        provider: 'xai',
        id: requestId,
        statusUrl: `${ORIGIN}/v1/videos/${encodeURIComponent(requestId)}`,
        label: String(request.prompt || '').slice(0, 80),
    });
    const videoUrl = await pollUntil({
        signal: request.signal,
        intervalMs: 3000,
        sleep: request.sleep,
        onProgress: request.onProgress,
        tick: async () => {
            const status = await fetchJson(`${ORIGIN}/v1/videos/${encodeURIComponent(requestId)}`, {
                ...fetchOptions,
                method: 'GET',
            });
            const state = String(status.status || '').toLowerCase();
            if (state === 'done' || state === 'completed' || state === 'succeeded') {
                const url = status.video?.url || status.url;
                if (!url) return { failed: true, message: 'xAI finished without a video URL.' };
                return { done: true, value: url, message: 'Downloading clip' };
            }
            if (state === 'failed' || state === 'expired' || state === 'cancelled' || state === 'canceled') {
                const detail = status.error || status.message || status.detail;
                return { failed: true, message: detail ? `xAI ${state}: ${detail}` : `xAI ${state}.` };
            }
            return { message: state || 'pending' };
        },
    });
    return downloadBinary(videoUrl, { ...fetchOptions, method: 'GET', headers: {} });
}
