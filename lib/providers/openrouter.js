import { pollUntil } from '../poll.js';
import { downloadBinary, fetchJson } from '../transport.js';
import { absoluteUrl, snapDuration } from '../util.js';

const GROK_SECONDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

/**
 * Static catalog so presets snap before the user refreshes.
 * Live rows from GET /api/v1/videos/models replace durations, resolutions, and prices.
 * Sora is omitted: that API was shut down. These Veo slugs are OpenRouter's, not the Gemini API preview.
 */
export const OPENROUTER_VIDEO_MODELS = [
    { id: 'x-ai/grok-imagine-video-1.5-lite', label: 'Grok Imagine Video 1.5 Lite', durations: GROK_SECONDS, resolutions: ['480p', '720p', '1080p'], aspects: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
    { id: 'x-ai/grok-imagine-video-1.5', label: 'Grok Imagine Video 1.5', durations: GROK_SECONDS, resolutions: ['480p', '720p', '1080p'], aspects: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
    { id: 'alibaba/wan-3.0', label: 'Wan 3.0', resolutions: ['480p', '720p', '1080p'], aspects: ['16:9', '9:16', '1:1'] },
    { id: 'alibaba/wan-3.0-prime', label: 'Wan 3.0 Prime', resolutions: ['720p', '1080p'], aspects: ['16:9', '9:16', '1:1'] },
    { id: 'alibaba/wan-2.7', label: 'Wan 2.7', resolutions: ['720p', '1080p'], aspects: ['16:9', '9:16', '1:1'] },
    { id: 'kwaivgi/kling-v3.0-std', label: 'Kling 3.0 Standard', resolutions: ['720p', '1080p'], aspects: ['16:9', '9:16', '1:1'] },
    { id: 'kwaivgi/kling-v3.0-pro', label: 'Kling 3.0 Pro', resolutions: ['720p', '1080p'], aspects: ['16:9', '9:16', '1:1'] },
    { id: 'bytedance/seedance-2.0', label: 'Seedance 2.0', resolutions: ['480p', '720p', '1080p'], aspects: ['16:9', '9:16', '1:1'] },
    { id: 'bytedance/seedance-2.0-fast', label: 'Seedance 2.0 Fast', resolutions: ['480p', '720p', '1080p'], aspects: ['16:9', '9:16', '1:1'] },
    { id: 'bytedance/seedance-1-5-pro', label: 'Seedance 1.5 Pro', resolutions: ['480p', '720p', '1080p'], aspects: ['16:9', '9:16', '1:1'] },
    { id: 'google/veo-3.1', label: 'Veo 3.1 (OpenRouter)', durations: [4, 6, 8], resolutions: ['720p', '1080p'], aspects: ['16:9', '9:16', '1:1'] },
    { id: 'google/veo-3.1-fast', label: 'Veo 3.1 Fast (OpenRouter)', durations: [4, 6, 8], resolutions: ['720p', '1080p'], aspects: ['16:9', '9:16'] },
    { id: 'minimax/hailuo-3', label: 'Hailuo 3', resolutions: ['720p', '1080p'], aspects: ['16:9', '9:16'] },
];

const ORIGIN = 'https://openrouter.ai';

export function buildOpenRouterVideoBody(modelId, request, modelInfo) {
    const fallback = OPENROUTER_VIDEO_MODELS.find((model) => model.id === modelId);
    const durations = modelInfo?.supported_durations || fallback?.durations;
    const resolutions = modelInfo?.supported_resolutions || fallback?.resolutions;
    const aspects = modelInfo?.supported_aspect_ratios || fallback?.aspects;
    const body = {
        model: modelId,
        prompt: request.prompt,
        duration: snapDuration(request.duration, durations),
        aspect_ratio: aspects?.includes(request.aspectRatio) ? request.aspectRatio : (aspects?.[0] || request.aspectRatio || '16:9'),
    };
    if (resolutions?.length) {
        body.resolution = resolutions.includes(request.resolution) ? request.resolution : resolutions[0];
    }
    if (request.generateAudio != null) body.generate_audio = Boolean(request.generateAudio);
    if (request.seed !== '' && request.seed != null && Number.isFinite(Number(request.seed))) body.seed = Number(request.seed);
    if (request.imageDataUrl) {
        body.frame_images = [{
            type: 'image_url',
            image_url: { url: request.imageDataUrl },
            frame_type: 'first_frame',
        }];
    } else if (request.referenceImages?.length && /seedance/i.test(modelId)) {
        body.input_references = request.referenceImages.filter(Boolean).slice(0, 4).map((url) => ({
            type: 'image_url',
            image_url: { url },
        }));
    }
    return body;
}

function headersFor(key) {
    return {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Title': 'SillyTavern Thoughtform',
    };
}

export async function listOpenRouterVideoModels(request) {
    const key = request.settings?.openrouterKey;
    if (!key) throw new Error('Add an OpenRouter key first.');
    const mode = request.corsMode || request.settings.corsMode || 'auto';
    const data = await fetchJson(`${ORIGIN}/api/v1/videos/models`, {
        method: 'GET',
        headers: headersFor(key),
        mode,
        signal: request.signal,
        fetchImpl: request.fetchImpl,
    });
    return Array.isArray(data?.data) ? data.data : [];
}

export async function generateOpenRouterVideo(request) {
    const key = request.settings?.openrouterKey;
    if (!key) throw new Error('Add an OpenRouter key in Thoughtform settings.');
    const modelId = request.modelId || request.settings.openrouterVideoModel;
    const body = buildOpenRouterVideoBody(modelId, request, request.modelInfo);
    const mode = request.corsMode || request.settings.corsMode || 'auto';
    const headers = headersFor(key);
    const fetchOptions = { fetchImpl: request.fetchImpl, mode, signal: request.signal, headers };
    request.onProgress?.({ message: `Submitting ${modelId}` });
    const queued = await fetchJson(`${ORIGIN}/api/v1/videos`, {
        ...fetchOptions,
        method: 'POST',
        body: JSON.stringify(body),
    });
    const pollingUrl = absoluteUrl(queued.polling_url || (queued.id ? `/api/v1/videos/${queued.id}` : ''), ORIGIN);
    if (!pollingUrl) throw new Error('OpenRouter did not return a polling URL.');
    request.onQueued?.({
        provider: 'openrouter',
        id: queued.id || '',
        statusUrl: pollingUrl,
        label: String(request.prompt || '').slice(0, 80),
    });
    const videoUrl = await pollUntil({
        signal: request.signal,
        intervalMs: 4000,
        sleep: request.sleep,
        onProgress: request.onProgress,
        tick: async () => {
            const status = await fetchJson(pollingUrl, { ...fetchOptions, method: 'GET' });
            const state = String(status.status || '').toLowerCase();
            if (state === 'completed') {
                const signed = Array.isArray(status.urls) ? status.urls.find((item) => typeof item === 'string') : '';
                const unsigned = absoluteUrl(status.unsigned_urls?.[0] || '', ORIGIN);
                return { done: true, value: { signed, unsigned }, message: 'Downloading clip' };
            }
            if (state === 'failed' || state === 'cancelled' || state === 'canceled' || state === 'expired') {
                return { failed: true, message: status.error || `OpenRouter ${state}.` };
            }
            return { message: state || 'pending' };
        },
    });
    if (videoUrl.signed) {
        try {
            return await downloadBinary(videoUrl.signed, { ...fetchOptions, method: 'GET', headers: {} });
        } catch {
            /* Fall through to the authenticated content URL. */
        }
    }
    if (!videoUrl.unsigned) throw new Error('OpenRouter completed without a download URL.');
    return downloadBinary(videoUrl.unsigned, { ...fetchOptions, method: 'GET' });
}
