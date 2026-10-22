import { pollUntil } from '../poll.js';
import { downloadBinary, fetchJson } from '../transport.js';
import { frameCount, snapDuration } from '../util.js';

export const REPLICATE_MODELS = [
    {
        id: 'wan-video/wan-2.2-t2v-fast',
        label: 'Wan 2.2 fast',
        kind: 'wan-fast',
        resolutions: ['480p', '720p'],
        safety: 'disable',
    },
    {
        id: 'kwaivgi/kling-v2.5-turbo-pro',
        label: 'Kling 2.5 Turbo Pro',
        durations: [5, 10],
        aspects: ['16:9', '9:16', '1:1'],
        imageField: 'start_image',
        safety: null,
    },
    {
        id: 'google/veo-3.1-fast',
        label: 'Veo 3.1 Fast',
        durations: [4, 6, 8],
        aspects: ['16:9', '9:16'],
        resolutions: ['720p', '1080p'],
        imageField: 'image',
        safety: null,
    },
    {
        id: 'google/veo-3.1',
        label: 'Veo 3.1',
        durations: [4, 6, 8],
        aspects: ['16:9', '9:16'],
        resolutions: ['720p', '1080p'],
        imageField: 'image',
        safety: null,
    },
];

export function findReplicateModel(id) {
    return REPLICATE_MODELS.find((model) => model.id === id) || null;
}

export function buildReplicateInput(modelId, request) {
    const known = findReplicateModel(modelId);
    const seconds = snapDuration(request.duration, known?.durations);
    if (known?.kind === 'wan-fast') {
        const input = {
            prompt: request.prompt,
            go_fast: true,
            num_frames: frameCount(seconds, request.fps || 16),
            resolution: known.resolutions.includes(request.resolution) ? request.resolution : '480p',
            aspect_ratio: request.aspectRatio || '16:9',
            frames_per_second: request.fps || 16,
        };
        if (request.disableSafetyChecker) input.disable_safety_checker = true;
        if (request.seed !== '' && request.seed != null && Number.isFinite(Number(request.seed))) input.seed = Number(request.seed);
        return input;
    }
    const input = {
        prompt: request.prompt,
        duration: seconds,
        aspect_ratio: request.aspectRatio || '16:9',
    };
    if (request.negativePrompt) input.negative_prompt = request.negativePrompt;
    if (known?.resolutions) {
        input.resolution = known.resolutions.includes(request.resolution) ? request.resolution : known.resolutions[0];
    } else if (!known && request.resolution) {
        input.resolution = request.resolution;
    }
    if (request.imageDataUrl) input[known?.imageField || 'start_image'] = request.imageDataUrl;
    if (request.seed !== '' && request.seed != null && Number.isFinite(Number(request.seed))) input.seed = Number(request.seed);
    if (!known && request.disableSafetyChecker) input.disable_safety_checker = true;
    return input;
}

function authHeaders(key) {
    return {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
    };
}

export async function generateReplicate(request) {
    if (!request.settings?.replicateKey) throw new Error('Add a Replicate API token in Thoughtform settings.');
    const modelId = request.modelId || request.settings.replicateModel;
    const input = buildReplicateInput(modelId, request);
    const mode = request.corsMode || request.settings.corsMode || 'auto';
    const headers = authHeaders(request.settings.replicateKey);
    const fetchOptions = { fetchImpl: request.fetchImpl, mode, signal: request.signal, headers };
    const versionSplit = String(modelId).split(':');
    const isOfficial = versionSplit.length === 1;
    const url = isOfficial
        ? `https://api.replicate.com/v1/models/${modelId}/predictions`
        : 'https://api.replicate.com/v1/predictions';
    const payload = isOfficial ? { input } : { version: modelId, input };
    request.onProgress?.({ message: `Submitting ${modelId}` });
    const prediction = await fetchJson(url, {
        ...fetchOptions,
        method: 'POST',
        body: JSON.stringify(payload),
    });
    if (prediction?.error) throw new Error(String(prediction.error));
    const getUrl = prediction?.urls?.get || (prediction?.id ? `https://api.replicate.com/v1/predictions/${prediction.id}` : '');
    const cancelUrl = prediction?.urls?.cancel;
    if (!getUrl) throw new Error('Replicate did not return a prediction URL.');
    request.onQueued?.({
        provider: 'replicate',
        id: prediction.id || '',
        statusUrl: getUrl,
        label: String(request.prompt || '').slice(0, 80),
    });
    request.registerCancel?.(async () => {
        if (!cancelUrl) return;
        try {
            await fetchJson(cancelUrl, { ...fetchOptions, method: 'POST', body: '{}' });
        } catch {
            /* Polling stops either way. */
        }
    });
    const videoUrl = await pollUntil({
        signal: request.signal,
        sleep: request.sleep,
        onProgress: request.onProgress,
        tick: async () => {
            const status = await fetchJson(getUrl, { ...fetchOptions, method: 'GET' });
            const state = String(status.status || '').toLowerCase();
            if (state === 'succeeded') {
                const output = Array.isArray(status.output) ? status.output[0] : status.output;
                if (!output || typeof output !== 'string') return { failed: true, message: 'Replicate finished without a video URL.' };
                return { done: true, value: output, message: 'Downloading clip' };
            }
            if (state === 'failed' || state === 'canceled' || state === 'cancelled') {
                return { failed: true, message: status.error || `Replicate ${state}.` };
            }
            return { message: state || 'starting' };
        },
    });
    return downloadBinary(videoUrl, { ...fetchOptions, method: 'GET', headers: {} });
}
