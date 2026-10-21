import { pollUntil } from '../poll.js';
import { downloadBinary, fetchJson } from '../transport.js';
import { frameCount, snapDuration } from '../util.js';

export const FAL_MODELS = [
    {
        id: 'fal-ai/wan/v2.2-a14b/text-to-video',
        label: 'Wan 2.2 A14B',
        kind: 'frames',
        resolutions: ['480p', '580p', '720p'],
        aspects: ['16:9', '9:16', '1:1'],
        safety: 'checker',
        audio: false,
    },
    {
        id: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video',
        i2v: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
        label: 'Kling 2.5 Turbo Pro',
        durations: [5, 10],
        aspects: ['16:9', '9:16', '1:1'],
        safety: 'checker',
        audio: false,
    },
    {
        id: 'fal-ai/kling-video/v3/standard/text-to-video',
        i2v: 'fal-ai/kling-video/v3/standard/image-to-video',
        label: 'Kling v3 Standard',
        durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        aspects: ['16:9', '9:16', '1:1'],
        safety: null,
        audio: true,
    },
    {
        id: 'fal-ai/minimax/hailuo-02/standard/text-to-video',
        i2v: 'fal-ai/minimax/hailuo-02/standard/image-to-video',
        label: 'Hailuo 02 Standard',
        durations: [6, 10],
        aspects: ['16:9'],
        safety: null,
        audio: false,
    },
    {
        id: 'fal-ai/veo3.1',
        i2v: 'fal-ai/veo3.1/image-to-video',
        label: 'Veo 3.1',
        durations: [4, 6, 8],
        durationSuffix: 's',
        aspects: ['16:9', '9:16'],
        resolutions: ['720p', '1080p', '4k'],
        safety: 'tolerance',
        audio: true,
    },
];

export function findFalModel(id) {
    return FAL_MODELS.find((model) => model.id === id || model.i2v === id) || null;
}

export function buildFalBody(modelId, request) {
    const known = findFalModel(modelId);
    const model = known || {
        id: modelId,
        durations: null,
        aspects: null,
        resolutions: null,
        safety: 'checker',
        audio: false,
    };
    const useImage = Boolean(request.imageDataUrl);
    const endpoint = useImage && known?.i2v ? known.i2v : modelId;
    const seconds = snapDuration(request.duration, model.durations);
    const aspect = model.aspects?.includes(request.aspectRatio) ? request.aspectRatio : (model.aspects?.[0] || request.aspectRatio || '16:9');
    const body = {
        prompt: request.prompt,
    };
    if (request.negativePrompt) body.negative_prompt = request.negativePrompt;
    if (model.kind === 'frames') {
        body.resolution = model.resolutions?.includes(request.resolution) ? request.resolution : '720p';
        body.aspect_ratio = aspect;
        body.num_frames = frameCount(seconds, request.fps || 16);
        body.frames_per_second = request.fps || 16;
        body.num_inference_steps = request.steps || 27;
    } else if (model.durationSuffix) {
        body.duration = `${seconds}${model.durationSuffix}`;
        body.aspect_ratio = aspect;
        if (model.resolutions) {
            body.resolution = model.resolutions.includes(request.resolution) ? request.resolution : model.resolutions[0];
        }
    } else {
        body.duration = String(seconds);
        body.aspect_ratio = aspect;
    }
    if (model.audio && request.generateAudio != null) body.generate_audio = Boolean(request.generateAudio);
    if (model.safety === 'checker') body.enable_safety_checker = !request.disableSafetyChecker;
    if (model.safety === 'tolerance') body.safety_tolerance = request.disableSafetyChecker ? '6' : '4';
    if (useImage) body.image_url = request.imageDataUrl;
    const refs = (request.referenceImages || []).filter(Boolean).slice(0, 4);
    if (refs.length && /kling-video\/(?:v3|o3)/.test(endpoint)) {
        body.elements = [{ frontal_image_url: refs[0], reference_image_urls: refs.slice(1) }];
    }
    if (request.seed !== '' && request.seed != null && Number.isFinite(Number(request.seed))) body.seed = Number(request.seed);
    return { endpoint, body, seconds };
}

function authHeaders(key) {
    return {
        Authorization: `Key ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
    };
}

export async function generateFal(request) {
    if (!request.settings?.falKey) throw new Error('Add a fal.ai key in Scene Video settings.');
    const modelId = request.modelId || request.settings.falModel;
    const { endpoint, body } = buildFalBody(modelId, request);
    const mode = request.corsMode || request.settings.corsMode || 'auto';
    const headers = authHeaders(request.settings.falKey);
    const fetchOptions = { fetchImpl: request.fetchImpl, mode, signal: request.signal, headers };
    request.onProgress?.({ message: `Submitting ${endpoint}` });
    const queued = await fetchJson(`https://queue.fal.run/${endpoint}`, {
        ...fetchOptions,
        method: 'POST',
        body: JSON.stringify(body),
    });
    const immediate = queued?.video?.url || queued?.output?.url;
    if (immediate) return downloadBinary(immediate, { ...fetchOptions, headers: {} });
    const statusUrl = queued.status_url;
    const responseUrl = queued.response_url;
    request.onQueued?.({
        provider: 'fal',
        id: queued.request_id || '',
        statusUrl,
        responseUrl,
        label: String(request.prompt || '').slice(0, 80),
    });
    const cancelUrl = queued.cancel_url;
    if (!statusUrl || !responseUrl) throw new Error('fal.ai did not return status and response URLs.');
    request.registerCancel?.(async () => {
        if (!cancelUrl) return;
        try {
            await fetchJson(cancelUrl, { ...fetchOptions, method: 'PUT', body: '{}' });
        } catch {
            /* The local cancel still stops polling. */
        }
    });
    const videoUrl = await pollUntil({
        signal: request.signal,
        sleep: request.sleep,
        onProgress: request.onProgress,
        tick: async () => {
            const status = await fetchJson(statusUrl, { ...fetchOptions, method: 'GET' });
            const state = String(status.status || '').toUpperCase();
            if (state === 'COMPLETED') {
                const result = await fetchJson(responseUrl, { ...fetchOptions, method: 'GET' });
                if (result?.error) return { failed: true, message: String(result.error) };
                const url = result?.video?.url || result?.output?.url;
                if (!url) return { failed: true, message: 'fal.ai completed without a video URL.' };
                return { done: true, value: url, message: 'Downloading clip' };
            }
            if (state === 'FAILED' || status.error) return { failed: true, message: status.error || 'fal.ai failed.' };
            const position = status.queue_position != null ? ` · queue ${status.queue_position}` : '';
            return { message: `${state || 'WORKING'}${position}` };
        },
    });
    return downloadBinary(videoUrl, { ...fetchOptions, method: 'GET', headers: {} });
}
