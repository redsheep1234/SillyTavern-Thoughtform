import { missingKey } from '../debug.js';
import { pollUntil } from '../poll.js';
import { downloadBinary, fetchJson, providerFetch } from '../transport.js';
import { readError, snapDuration } from '../util.js';

export const VENICE_API = 'https://api.venice.ai/api/v1';

/** Current chat model that can see a picture. Docs: models/text, 26 Oct 2026. */
export const VENICE_TEXT_MODEL = 'venice-uncensored-1-2';

/**
 * Wan 2.5 Preview is the video guide's worked example: 5s or 10s, 480p / 720p / 1080p,
 * with a paired image-to-video id. Still listed on the video models page.
 */
export const VENICE_MODELS = [
    {
        id: 'wan-2.5-preview-text-to-video',
        i2v: 'wan-2.5-preview-image-to-video',
        label: 'Wan 2.5 Preview',
        durations: [5, 10],
        resolutions: ['480p', '720p', '1080p'],
        aspects: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    },
];

export function findVeniceModel(id) {
    return VENICE_MODELS.find((model) => model.id === id || model.i2v === id) || null;
}

export function buildVeniceBody(modelId, request) {
    const known = findVeniceModel(modelId);
    const spec = known || {
        id: modelId || VENICE_MODELS[0].id,
        i2v: '',
        durations: VENICE_MODELS[0].durations,
        resolutions: VENICE_MODELS[0].resolutions,
        aspects: VENICE_MODELS[0].aspects,
    };
    const useImage = Boolean(request.imageDataUrl);
    const model = useImage ? (spec.i2v || spec.id) : spec.id;
    const seconds = snapDuration(request.duration, spec.durations);
    const aspect = spec.aspects.includes(request.aspectRatio) ? request.aspectRatio : spec.aspects[0];
    const resolution = spec.resolutions.includes(request.resolution) ? request.resolution : '720p';
    const body = {
        model,
        prompt: request.prompt,
        duration: `${seconds}s`,
        resolution,
        aspect_ratio: aspect,
    };
    if (request.negativePrompt) body.negative_prompt = request.negativePrompt;
    if (useImage) body.image_url = request.imageDataUrl;
    return { model, body, seconds };
}

function authHeaders(key) {
    return {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, video/mp4',
    };
}

function veniceError(response, detail, step) {
    const error = new Error(detail || `HTTP ${response.status}`);
    error.status = response.status;
    error.provider = 'venice';
    error.step = step;
    return error;
}

/** JSON status, or the MP4 when retrieve is finished and has no download link. */
async function venicePost(url, options) {
    const response = await providerFetch(url, options);
    const type = String(response.headers?.get?.('content-type') || '');
    if (!response.ok) throw veniceError(response, await readError(response), options.step || 'video');
    if (type.includes('video/')) {
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        return { kind: 'video', blob: new Blob([buffer], { type: 'video/mp4' }) };
    }
    return { kind: 'json', payload: await response.json() };
}

export async function generateVenice(request) {
    if (!String(request.settings?.veniceKey || '').trim()) throw missingKey('venice', 'video', 'No Venice key yet.');
    const modelId = request.modelId || request.settings.veniceModel || VENICE_MODELS[0].id;
    const { model, body } = buildVeniceBody(modelId, request);
    const mode = request.corsMode || request.settings.corsMode || 'auto';
    const headers = authHeaders(request.settings.veniceKey);
    const fetchOptions = { fetchImpl: request.fetchImpl, mode, signal: request.signal, headers, provider: 'venice', step: 'video' };
    request.onProgress?.({ message: `Submitting ${model}` });
    const queued = await fetchJson(`${VENICE_API}/video/queue`, {
        ...fetchOptions,
        method: 'POST',
        body: JSON.stringify(body),
    });
    const queueId = queued?.queue_id;
    if (!queueId) throw new Error('Venice did not return a video job.');
    const queuedModel = queued.model || model;
    const downloadUrl = String(queued.download_url || '').trim();
    request.onQueued?.({
        provider: 'venice',
        id: queueId,
        label: String(request.prompt || '').slice(0, 80),
    });
    const ready = await pollUntil({
        signal: request.signal,
        intervalMs: 5000,
        sleep: request.sleep,
        onProgress: request.onProgress,
        tick: async () => {
            const result = await venicePost(`${VENICE_API}/video/retrieve`, {
                ...fetchOptions,
                method: 'POST',
                body: JSON.stringify({ model: queuedModel, queue_id: queueId }),
            });
            if (result.kind === 'video') return { done: true, value: result.blob, message: 'Downloading clip' };
            const status = String(result.payload?.status || '').toUpperCase();
            if (status === 'COMPLETED') {
                if (!downloadUrl) return { failed: true, message: 'Venice finished without a video.' };
                return { done: true, value: { downloadUrl }, message: 'Downloading clip' };
            }
            if (status === 'PROCESSING') {
                return { message: 'PROCESSING' };
            }
            const detail = result.payload?.error || result.payload?.message;
            return { failed: true, message: detail ? `Venice: ${detail}` : 'Venice returned an unexpected status.' };
        },
    });
    if (ready instanceof Blob) return ready;
    if (ready?.downloadUrl) {
        return downloadBinary(ready.downloadUrl, {
            fetchImpl: request.fetchImpl,
            mode,
            signal: request.signal,
            method: 'GET',
            headers: {},
            provider: 'venice',
            step: 'video',
        });
    }
    throw new Error('Venice finished without a video.');
}
