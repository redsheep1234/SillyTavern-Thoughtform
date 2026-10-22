import { pollUntil } from '../poll.js';
import { downloadBinary, fetchJson } from '../transport.js';
import { coerceVideoUrl, dimensionsFor, getByPath, parseStatusList, renderJsonTemplate, renderStringTemplate } from '../util.js';

export function customVariables(request) {
    const [width, height] = dimensionsFor(request.resolution || '720p', request.aspectRatio || '16:9');
    const seed = request.seed === '' || request.seed == null ? '' : Number(request.seed);
    return {
        prompt: request.prompt,
        negative_prompt: request.negativePrompt || '',
        duration: Number(request.duration) || 5,
        aspect_ratio: request.aspectRatio || '16:9',
        resolution: request.resolution || '720p',
        fps: Number(request.fps) || 16,
        steps: Number(request.steps) || 20,
        seed: Number.isFinite(seed) ? seed : '',
        width,
        height,
        image_url: request.imageDataUrl || '',
        disable_safety_checker: Boolean(request.disableSafetyChecker),
        api_key: request.settings?.custom?.apiKey || '',
    };
}

export function buildCustomRequest(request) {
    const custom = request.settings?.custom || {};
    if (!custom.submitUrl) throw new Error('Set a submit URL for the custom provider.');
    const vars = customVariables(request);
    const headers = custom.headers?.trim() ? renderJsonTemplate(custom.headers, vars) : { 'Content-Type': 'application/json' };
    if (headers == null || typeof headers !== 'object' || Array.isArray(headers)) {
        throw new Error('Custom headers must be a JSON object.');
    }
    const body = custom.body?.trim() ? renderJsonTemplate(custom.body, vars) : { prompt: request.prompt };
    return {
        url: renderStringTemplate(custom.submitUrl, vars),
        headers,
        body,
        vars,
    };
}

function headerList(headers) {
    const out = {};
    for (const [key, value] of Object.entries(headers || {})) {
        if (value != null && value !== '') out[key] = String(value);
    }
    if (!out['Content-Type'] && !out['content-type']) out['Content-Type'] = 'application/json';
    return out;
}

export async function generateCustom(request) {
    const custom = request.settings?.custom || {};
    const built = buildCustomRequest(request);
    const mode = request.corsMode || request.settings.corsMode || 'auto';
    const headers = headerList(built.headers);
    const fetchOptions = { fetchImpl: request.fetchImpl, mode, signal: request.signal, headers, provider: 'custom', step: 'video' };
    request.onProgress?.({ message: 'Submitting custom job' });
    const submitted = await fetchJson(built.url, {
        ...fetchOptions,
        method: 'POST',
        body: JSON.stringify(built.body),
    });
    const success = parseStatusList(custom.successStatuses);
    const failure = parseStatusList(custom.failureStatuses);
    const statusOf = (payload) => String(getByPath(payload, custom.statusPath || 'status') || '').toLowerCase();
    const videoOf = (payload) => coerceVideoUrl(getByPath(payload, custom.videoPath || 'output'));
    const immediate = videoOf(submitted);
    const immediateStatus = statusOf(submitted);
    if (immediate && (!immediateStatus || success.includes(immediateStatus))) {
        return downloadBinary(immediate, { ...fetchOptions, method: 'GET', headers: {} });
    }
    const id = getByPath(submitted, custom.idPath || 'id');
    if (id == null || id === '') throw new Error('The custom API response had no job id. Check the id path.');
    if (!custom.pollUrl) throw new Error('Set a poll URL template. {{id}} is replaced with the job id.');
    const vars = { ...built.vars, id, submit_url: built.url };
    const pollUrl = renderStringTemplate(custom.pollUrl, vars);
    if (custom.cancelUrl) {
        const cancelUrl = renderStringTemplate(custom.cancelUrl, vars);
        request.registerCancel?.(async () => {
            try {
                await fetchJson(cancelUrl, { ...fetchOptions, method: 'POST', body: '{}' });
            } catch {
                /* Polling stops either way. */
            }
        });
    }
    const videoUrl = await pollUntil({
        signal: request.signal,
        sleep: request.sleep,
        onProgress: request.onProgress,
        tick: async () => {
            const status = await fetchJson(pollUrl, { ...fetchOptions, method: 'GET' });
            const state = statusOf(status);
            const url = videoOf(status);
            if (success.includes(state) || (url && !failure.includes(state) && state === '')) {
                if (!url) return { failed: true, message: 'The job finished but the video path was empty.' };
                return { done: true, value: url, message: 'Downloading clip' };
            }
            if (failure.includes(state)) return { failed: true, message: status.error || status.message || `Custom provider ${state}.` };
            return { message: state || 'pending' };
        },
    });
    return downloadBinary(videoUrl, { ...fetchOptions, method: 'GET', headers: {} });
}
