import { pollUntil } from '../poll.js';
import { fetchJson } from '../transport.js';
import { generateComfy } from './comfyui.js';

export const IMAGE_MODELS = [
    { id: 'mock', label: 'Mock still (no cost)', usd: 0 },
    { id: 'fal-ai/flux-pro/kontext/multi', label: 'Flux Kontext multi (fal)', usd: 0.04 },
    { id: 'google/gemini-2.5-flash-image', label: 'Gemini image (OpenRouter)', usd: null },
    { id: 'comfy', label: 'ComfyUI still workflow', usd: 0 },
];

export function findImageModel(id) {
    return IMAGE_MODELS.find((model) => model.id === id) || IMAGE_MODELS[0];
}

export function stillCost(count, modelId) {
    const model = findImageModel(modelId);
    const total = Math.max(0, Number(count) || 0);
    if (model.usd == null) {
        return { usd: null, label: 'Check provider', note: `${total} still${total === 1 ? '' : 's'}. Confirm the price on that host.` };
    }
    const usd = model.usd * total;
    const label = usd === 0 ? '$0.00' : `~$${usd.toFixed(2)}`;
    const note = model.usd === 0
        ? `${total} still${total === 1 ? '' : 's'} at no hosted cost.`
        : `${total} still${total === 1 ? '' : 's'} at about $${model.usd.toFixed(2)} each.`;
    return { usd, label, note };
}

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export function buildKontextBody(request) {
    const urls = (request.referenceImages || []).filter(Boolean).slice(0, 4);
    return {
        prompt: request.prompt,
        image_urls: urls,
        safety_tolerance: request.disableSafetyChecker ? 6 : 5,
        output_format: 'jpeg',
    };
}

function mockStill(request) {
    const label = String(request.label || 'Reference');
    if (typeof document === 'undefined') return TINY_PNG;
    const canvas = document.createElement('canvas');
    canvas.width = 360;
    canvas.height = 480;
    const context = canvas.getContext('2d');
    context.fillStyle = '#241c14';
    context.fillRect(0, 0, 360, 480);
    context.fillStyle = '#e0b15a';
    context.fillRect(0, 0, 360, 8);
    context.font = '22px sans-serif';
    context.fillText(label.slice(0, 28), 16, 48);
    context.fillStyle = '#f3ead8';
    context.font = '15px sans-serif';
    const words = String(request.prompt || '').split(/\s+/);
    let line = '';
    let y = 88;
    for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (context.measureText(next).width > 320) {
            context.fillText(line, 16, y);
            line = word;
            y += 22;
            if (y > 450) break;
        } else {
            line = next;
        }
    }
    if (line && y <= 450) context.fillText(line, 16, y);
    return canvas.toDataURL('image/jpeg', 0.82);
}

async function blobToDataUrl(blob) {
    if (typeof FileReader === 'undefined') {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        const type = blob.type || 'image/png';
        return `data:${type};base64,${btoa(binary)}`;
    }
    const { blobToDataUrl: read } = await import('../library.js');
    return read(blob);
}

function falHeaders(key) {
    return { Authorization: `Key ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' };
}

async function generateFalStill(request) {
    if (!request.settings?.falKey) throw new Error('Add a fal.ai key under Extensions → Scene Video.');
    const body = buildKontextBody({ ...request, disableSafetyChecker: request.settings.disableSafetyChecker });
    if (!body.image_urls.length) throw new Error('Flux Kontext needs the avatar or another reference image.');
    const mode = request.corsMode || request.settings.corsMode || 'auto';
    const headers = falHeaders(request.settings.falKey);
    const fetchOptions = { fetchImpl: request.fetchImpl, mode, signal: request.signal, headers };
    const queued = await fetchJson('https://queue.fal.run/fal-ai/flux-pro/kontext/multi', {
        ...fetchOptions,
        method: 'POST',
        body: JSON.stringify(body),
    });
    const immediate = queued?.images?.[0]?.url;
    if (immediate) {
        const blob = await (await fetch(immediate)).blob();
        return blobToDataUrl(blob);
    }
    if (!queued.status_url || !queued.response_url) throw new Error('fal.ai did not return a still job.');
    const imageUrl = await pollUntil({
        signal: request.signal,
        sleep: request.sleep,
        onProgress: request.onProgress,
        tick: async () => {
            const status = await fetchJson(queued.status_url, { ...fetchOptions, method: 'GET' });
            const state = String(status.status || '').toUpperCase();
            if (state === 'COMPLETED') {
                const result = await fetchJson(queued.response_url, { ...fetchOptions, method: 'GET' });
                const url = result?.images?.[0]?.url;
                if (!url) return { failed: true, message: 'fal.ai finished without an image.' };
                return { done: true, value: url };
            }
            if (state === 'FAILED' || status.error) return { failed: true, message: status.error || 'fal.ai failed.' };
            return { message: state || 'Working' };
        },
    });
    const response = await fetchJson(imageUrl, { ...fetchOptions, method: 'GET' }).catch(() => null);
    if (response) return response;
    const download = await (request.fetchImpl || fetch)(imageUrl, { signal: request.signal });
    if (!download.ok) throw new Error('Could not download the still.');
    return blobToDataUrl(await download.blob());
}

function imageFromOpenRouter(payload) {
    const message = payload?.choices?.[0]?.message;
    const images = message?.images || [];
    for (const image of images) {
        const url = image?.image_url?.url || image?.url;
        if (url) return url;
    }
    const parts = Array.isArray(message?.content) ? message.content : [];
    for (const part of parts) {
        const url = part?.image_url?.url || part?.url;
        if (url) return url;
    }
    return '';
}

async function generateOpenRouterStill(request) {
    if (!request.settings?.openrouterKey) throw new Error('Add an OpenRouter key under Extensions → Scene Video.');
    const model = request.modelId && request.modelId !== 'mock' && request.modelId !== 'comfy'
        ? request.modelId
        : 'google/gemini-2.5-flash-image';
    const content = [{ type: 'text', text: request.prompt }];
    for (const url of (request.referenceImages || []).filter(Boolean).slice(0, 4)) {
        content.push({ type: 'image_url', image_url: { url } });
    }
    const mode = request.corsMode || request.settings.corsMode || 'auto';
    const payload = await fetchJson('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${request.settings.openrouterKey}`,
            'Content-Type': 'application/json',
            'X-Title': 'SillyTavern Scene Video',
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content }],
            modalities: ['image', 'text'],
        }),
        mode,
        signal: request.signal,
        fetchImpl: request.fetchImpl,
    });
    const url = imageFromOpenRouter(payload);
    if (!url) throw new Error('OpenRouter returned no image. The model may have refused the still.');
    if (url.startsWith('data:')) return url;
    const response = await (request.fetchImpl || fetch)(url, { signal: request.signal });
    if (!response.ok) throw new Error('Could not download the OpenRouter still.');
    return blobToDataUrl(await response.blob());
}

async function generateComfyStill(request) {
    const blob = await generateComfy({
        ...request,
        imageDataUrl: request.referenceImages?.find(Boolean) || request.imageDataUrl || '',
        duration: 1,
        fps: 1,
    });
    if (!String(blob.type || '').startsWith('image/')) {
        throw new Error('ComfyUI returned a video. Load the portrait IP-Adapter example, or any API workflow that ends in SaveImage, before generating stills.');
    }
    return blobToDataUrl(blob);
}

export async function generateReferenceImage(request) {
    const modelId = request.modelId || request.settings?.imageModel || 'mock';
    if (modelId === 'mock') return mockStill(request);
    if (modelId === 'comfy') return generateComfyStill(request);
    if (modelId.startsWith('fal-ai/')) return generateFalStill(request);
    return generateOpenRouterStill({ ...request, modelId });
}

export { imageFromOpenRouter };
