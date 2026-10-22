import { pollUntil } from '../poll.js';
import { USD_PER_AUD } from '../simple.js';
import { missingKey } from '../debug.js';
import { fetchJson } from '../transport.js';
import { generateComfy } from './comfyui.js';

export const GEMINI_IMAGE_ID = 'google/gemini-2.5-flash-image';

export const IMAGE_MODELS = [
    { id: 'mock', label: 'Mock still (no cost)', short: 'Mock (free)', usd: 0, key: '', keyName: '' },
    { id: 'fal-ai/flux-pro/kontext/multi', label: 'Flux Kontext multi (fal)', short: 'Flux Kontext', usd: 0.04, key: 'falKey', keyName: 'fal.ai' },
    { id: GEMINI_IMAGE_ID, label: 'Gemini image (OpenRouter)', short: 'Gemini image', usd: 0.039, key: 'openrouterKey', keyName: 'OpenRouter' },
    { id: 'comfy', label: 'ComfyUI still workflow', short: 'ComfyUI', usd: 0, key: '', keyName: '' },
];

export function findImageModel(id) {
    return IMAGE_MODELS.find((model) => model.id === id) || IMAGE_MODELS[0];
}

/** The key this picture model needs, when that key is still empty. */
export function missingImageKey(settings) {
    const model = findImageModel(settings?.imageModel);
    if (!model.key) return null;
    if (String(settings?.[model.key] || '').trim()) return null;
    return {
        setting: model.key,
        text: `${model.short} needs a ${model.keyName} key.`,
    };
}

export function stillCost(count, modelId) {
    const model = findImageModel(modelId);
    const total = Math.max(0, Number(count) || 0);
    if (model.usd == null) {
        return { usd: null, label: 'Check provider', note: `${total} still${total === 1 ? '' : 's'}. Confirm the price on that host.` };
    }
    const usd = model.usd * total;
    const aud = usd / USD_PER_AUD;
    const quote = `${total} image${total === 1 ? '' : 's'} ≈ US$${usd.toFixed(2)} / A$${aud.toFixed(2)}`;
    const note = model.usd === 0
        ? `${total} still${total === 1 ? '' : 's'} at no hosted cost.`
        : `${total} still${total === 1 ? '' : 's'} at about US$${model.usd.toFixed(3)} each.`;
    return { usd, label: quote, quote, note };
}

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export function buildKontextBody(request) {
    const urls = (request.referenceImages || []).filter(Boolean).slice(0, 4);
    const body = {
        prompt: request.prompt,
        image_urls: urls,
        safety_tolerance: request.disableSafetyChecker ? 6 : 5,
        output_format: 'jpeg',
    };
    if (request.seed !== '' && request.seed != null && Number.isFinite(Number(request.seed))) {
        body.seed = Number(request.seed);
    }
    return body;
}

function mockStill(request) {
    const label = String(request.label || 'Reference');
    if (typeof document === 'undefined') return TINY_PNG;
    const wide = request.aspectRatio === '16:9' || request.aspectRatio === '4:3';
    const canvas = document.createElement('canvas');
    canvas.width = wide ? 480 : 360;
    canvas.height = wide ? 270 : 480;
    const context = canvas.getContext('2d');
    context.fillStyle = '#241c14';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#e0b15a';
    context.fillRect(0, 0, canvas.width, 8);
    context.font = '22px sans-serif';
    context.fillText(label.slice(0, 28), 16, 48);
    if (request.seed) {
        context.font = '14px sans-serif';
        context.fillText(`variation ${request.seed}`, 16, 70);
    }
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
    if (!String(request.settings?.falKey || '').trim()) throw missingKey('fal', 'still', 'No fal.ai key yet.');
    const body = buildKontextBody({ ...request, disableSafetyChecker: request.settings.disableSafetyChecker });
    if (!body.image_urls.length) throw new Error('Flux Kontext needs the avatar or another reference image.');
    const mode = request.corsMode || request.settings.corsMode || 'auto';
    const headers = falHeaders(request.settings.falKey);
    const fetchOptions = { fetchImpl: request.fetchImpl, mode, signal: request.signal, headers, provider: 'fal', step: 'still' };
    const queued = await fetchJson('https://queue.fal.run/fal-ai/flux-pro/kontext/multi', {
        ...fetchOptions,
        method: 'POST',
        body: JSON.stringify(body),
    });
    const immediate = queued?.images?.[0]?.url;
    if (isImageReference(immediate)) return readImageUrl(immediate, request);
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
                const url = result?.images?.[0]?.url || result?.image?.url;
                if (!isImageReference(url)) return { failed: true, message: 'fal.ai finished without an image.' };
                return { done: true, value: url };
            }
            if (state === 'FAILED' || status.error) return { failed: true, message: status.error || 'fal.ai failed.' };
            return { message: state || 'Working' };
        },
    });
    if (!isImageReference(imageUrl)) throw new Error('fal.ai finished without an image. Nothing was requested again.');
    return readImageUrl(imageUrl, request);
}

/** A real picture URL. Prose, markdown, and prompt text are not pictures. */
export function isImageReference(value) {
    const text = String(value || '').trim();
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(text)) return true;
    return /^https?:\/\/\S+$/i.test(text);
}

function pushImage(found, value) {
    const text = String(value || '').trim();
    if (isImageReference(text)) found.push(text);
}

/** A generated still that is not one of the pictures we sent. */
export function acceptNewStill(url, blocked = []) {
    const picture = String(url || '').trim();
    if (!picture) return '';
    const known = new Set((blocked || []).map((item) => String(item || '').trim()).filter(Boolean));
    return known.has(picture) ? '' : picture;
}

/**
 * Pull one image out of an OpenRouter chat or images payload.
 * A text reply is ignored. Callers must not send the request again.
 * When the reply starts with a picture we sent, that echo is dropped.
 */
export function imageFromOpenRouter(payload, references = []) {
    const found = [];
    const message = payload?.choices?.[0]?.message;
    const images = [...(message?.images || []), ...(Array.isArray(payload?.data) ? payload.data : [])];
    for (const image of images) {
        pushImage(found, image?.image_url?.url);
        pushImage(found, typeof image?.image_url === 'string' ? image.image_url : '');
        pushImage(found, image?.url);
        if (image?.b64_json) {
            const mime = String(image.media_type || 'image/png').split(';')[0];
            if (mime.startsWith('image/')) pushImage(found, `data:${mime};base64,${image.b64_json}`);
        }
    }
    const content = message?.content;
    if (Array.isArray(content)) {
        for (const part of content) {
            if (!part || part.type === 'text') continue;
            pushImage(found, part.image_url?.url);
            pushImage(found, typeof part.image_url === 'string' ? part.image_url : '');
            pushImage(found, typeof part.image === 'string' ? part.image : '');
            pushImage(found, part.url);
        }
    } else if (typeof content === 'string') {
        pushImage(found, content);
        const markdown = content.match(/!\[[^\]]*]\((data:image\/[a-z0-9.+-]+;base64,[^)\s]+|https?:\/\/[^)\s]+)\)/i);
        if (markdown) pushImage(found, markdown[1]);
    }
    const refs = new Set((references || []).map((item) => String(item || '').trim()).filter(Boolean));
    const novel = found.filter((url) => !refs.has(url));
    if (!novel.length) return '';
    const echoedFirst = Boolean(found.length && refs.has(found[0]));
    return echoedFirst ? novel[novel.length - 1] : novel[0];
}

async function generateOpenRouterStill(request) {
    if (!String(request.settings?.openrouterKey || '').trim()) throw missingKey('openrouter', 'still', 'No OpenRouter key yet.');
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
            'X-Title': 'SillyTavern Thoughtform',
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content }],
            modalities: ['image', 'text'],
            image_config: request.aspectRatio ? { aspect_ratio: request.aspectRatio } : undefined,
        }),
        mode,
        signal: request.signal,
        fetchImpl: request.fetchImpl,
        provider: 'openrouter',
        step: 'still',
    });
    const url = imageFromOpenRouter(payload, request.referenceImages);
    if (!url) throw new Error('OpenRouter replied with text and no image. The still was not saved. Nothing was requested again.');
    if (url.startsWith('data:image/')) return url;
    return readImageUrl(url, request);
}

async function readImageUrl(url, request) {
    const response = await (request.fetchImpl || fetch)(url, { signal: request.signal });
    if (!response.ok) throw new Error('Could not download the still. Nothing was requested again.');
    const blob = await response.blob();
    const type = String(blob.type || response.headers?.get?.('content-type') || '');
    if (!type.startsWith('image/')) throw new Error('The provider returned text instead of an image. Nothing was requested again.');
    return blobToDataUrl(blob);
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

