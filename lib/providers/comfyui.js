import { findOutputFile, applySceneToWorkflow, parseMappingOverride, parseWorkflowJson, toPromptGraph } from '../comfy/workflow.js';
import { dimensionsFor, frameCount, readError } from '../util.js';

export const EXAMPLE_WORKFLOWS = [
    { id: 'ltx-23-t2v', label: 'LTX-2.3 text-to-video (8GB)', file: 'ltx-2.3-t2v.api.json' },
    { id: 'wan-t2v', label: 'Wan 2.2 14B text-to-video', file: 'wan-t2v.api.json' },
    { id: 'wan-i2v', label: 'Wan 2.2 image-to-video', file: 'wan-i2v.api.json' },
    { id: 'portrait-ipadapter', label: 'Portrait IP-Adapter still', file: 'portrait-ipadapter.api.json' },
];

/** Plain note from ComfyUI system_stats. An 8GB card is pointed at LTX-2.3. */
export function comfyHardwareNote(stats) {
    const devices = Array.isArray(stats?.devices) ? stats.devices : [];
    const vram = devices.reduce((max, device) => Math.max(max, Number(device?.vram_total) || 0), 0);
    const gb = vram / (1024 ** 3);
    if (!vram) {
        return 'ComfyUI responded. On an 8GB card such as an RTX 3060 Ti, load LTX-2.3. Wan 2.2 14B does not fit. A Wan 2.2 5B GGUF with offload can, slowly.';
    }
    if (gb <= 10) {
        return `ComfyUI responded. This GPU reports about ${gb.toFixed(1)} GB. Load LTX-2.3, or a Wan 2.2 5B GGUF with offload. Wan 2.2 14B does not fit an 8GB card.`;
    }
    return `ComfyUI responded. This GPU reports about ${Math.round(gb)} GB.`;
}

export function exampleWorkflowUrl(fileName) {
    return new URL(`../../workflows/${fileName}`, import.meta.url);
}

export async function loadExampleWorkflow(id, fetchImpl = globalThis.fetch) {
    const example = EXAMPLE_WORKFLOWS.find((item) => item.id === id) || EXAMPLE_WORKFLOWS[0];
    const response = await fetchImpl(exampleWorkflowUrl(example.file));
    if (!response.ok) throw new Error(`Could not load the example workflow (${response.status}).`);
    const text = await response.text();
    return { id: example.id, name: example.label, text, workflow: parseWorkflowJson(text) };
}

function trimBase(url) {
    return String(url || '').trim().replace(/\/+$/, '');
}

function wsUrl(base, clientId) {
    const url = new URL(base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/ws`;
    url.search = `?clientId=${encodeURIComponent(clientId)}`;
    return url.toString();
}

async function comfyJson(base, path, options) {
    const root = trimBase(base);
    const response = await options.fetchImpl(`${root}${path}`, {
        method: options.method || 'GET',
        headers: options.headers,
        body: options.body,
        signal: options.signal,
    });
    if (!response.ok) throw new Error(await readError(response));
    const type = response.headers?.get?.('content-type') || '';
    if (type.includes('json') || options.expectJson) return response.json();
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function dataUrlToBlob(dataUrl) {
    const match = String(dataUrl).match(/^data:([^;,]+)?(;base64)?,(.*)$/);
    if (!match) throw new Error('The reference image is not a data URL.');
    const mime = match[1] || 'image/png';
    const bytes = match[2]
        ? Uint8Array.from(atob(match[3]), (char) => char.charCodeAt(0))
        : new TextEncoder().encode(decodeURIComponent(match[3]));
    return new Blob([bytes], { type: mime });
}

async function uploadInitImage(base, dataUrl, options) {
    const blob = dataUrlToBlob(dataUrl);
    const form = new FormData();
    form.append('image', blob, 'scene-video-init.png');
    form.append('overwrite', 'true');
    const response = await options.fetchImpl(`${trimBase(base)}/upload/image`, {
        method: 'POST',
        body: form,
        signal: options.signal,
    });
    if (!response.ok) {
        throw new Error(`${await readError(response)} ComfyUI must be started with --enable-cors-header * so the browser can upload the still.`);
    }
    const info = await response.json();
    if (!info?.name) throw new Error('ComfyUI did not return an uploaded filename.');
    return info.name;
}

export async function checkComfy(request) {
    const base = trimBase(request.settings?.comfyUrl);
    if (!base) throw new Error('Set the ComfyUI URL.');
    return comfyJson(base, '/system_stats', {
        fetchImpl: request.fetchImpl || globalThis.fetch,
        signal: request.signal,
        expectJson: true,
    });
}

export async function generateComfy(request) {
    const base = trimBase(request.settings?.comfyUrl);
    if (!base) throw new Error('Set the ComfyUI URL.');
    const raw = request.workflowText || request.settings?.comfyWorkflow;
    if (!raw?.trim()) throw new Error('Import a ComfyUI API workflow, or load one of the examples and point the model files at your install.');
    const workflow = parseWorkflowJson(raw);
    const override = parseMappingOverride(request.settings?.comfyMapping);
    const [width, height] = dimensionsFor(request.resolution || '720p', request.aspectRatio || '16:9');
    let imageName = '';
    if (request.imageDataUrl) {
        request.onProgress?.({ message: 'Uploading reference still' });
        imageName = await uploadInitImage(base, request.imageDataUrl, {
            fetchImpl: request.fetchImpl || globalThis.fetch,
            signal: request.signal,
        });
    }
    const applied = applySceneToWorkflow(workflow, {
        prompt: request.prompt,
        negativePrompt: request.negativePrompt,
        seed: request.seed === '' || request.seed == null ? Math.floor(Math.random() * 1e9) : Number(request.seed),
        width,
        height,
        frames: frameCount(request.duration, request.fps || 16),
        fps: Number(request.fps) || 16,
        steps: Number(request.steps) || 20,
        imageName,
        loraName: request.loraName || '',
        loraStrength: request.loraStrength,
    }, override);
    for (const warning of applied.warnings) request.onProgress?.({ message: warning });
    const clientId = globalThis.crypto?.randomUUID?.() || `scene-${Date.now()}`;
    const fetchImpl = request.fetchImpl || globalThis.fetch;
    let ws;
    let wsMessage = '';
    try {
        if (typeof WebSocket === 'function') {
            ws = new WebSocket(wsUrl(base, clientId));
            ws.onmessage = (event) => {
                try {
                    const payload = JSON.parse(event.data);
                    if (payload.type === 'progress' && payload.data?.max) {
                        const pct = Math.round((payload.data.value / payload.data.max) * 100);
                        wsMessage = `Sampling ${pct}%`;
                    } else if (payload.type === 'executing' && payload.data?.node) {
                        wsMessage = `Node ${payload.data.node}`;
                    } else if (payload.type === 'execution_error') {
                        wsMessage = payload.data?.exception_message || 'ComfyUI execution error';
                    }
                } catch {
                    /* Binary preview frames are ignored. */
                }
            };
        }
    } catch {
        ws = null;
    }
    request.onProgress?.({ message: 'Queuing workflow' });
    const queued = await comfyJson(base, '/prompt', {
        fetchImpl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: toPromptGraph(applied.workflow), client_id: clientId }),
        signal: request.signal,
        expectJson: true,
    });
    if (queued?.node_errors && Object.keys(queued.node_errors).length) {
        throw new Error(`ComfyUI rejected the workflow: ${JSON.stringify(queued.node_errors).slice(0, 700)}`);
    }
    const promptId = queued?.prompt_id;
    if (!promptId) throw new Error('ComfyUI did not return a prompt_id.');
    request.onQueued?.({
        provider: 'comfyui',
        id: promptId,
        statusUrl: `${base}/history/${promptId}`,
        label: String(request.prompt || '').slice(0, 80),
    });
    request.registerCancel?.(async () => {
        try {
            await fetchImpl(`${base}/interrupt`, { method: 'POST', signal: request.signal });
        } catch { /* already going away */ }
        try {
            await fetchImpl(`${base}/queue`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ delete: [promptId] }),
            });
        } catch { /* queue delete is best-effort */ }
    });
    const file = await waitForFile({
        base,
        promptId,
        fetchImpl,
        signal: request.signal,
        sleep: request.sleep,
        onProgress: (info) => request.onProgress?.({ message: wsMessage || info.message || 'Running' }),
    });
    try { ws?.close(); } catch { /* socket already closed */ }
    const view = new URL(`${base}/view`);
    view.searchParams.set('filename', file.filename);
    view.searchParams.set('subfolder', file.subfolder || '');
    view.searchParams.set('type', file.type || 'output');
    const response = await fetchImpl(view, { signal: request.signal });
    if (!response.ok) {
        throw new Error(`${await readError(response)} If this is a CORS error, restart ComfyUI with --enable-cors-header *. The SillyTavern proxy cannot fetch /view because it drops query strings.`);
    }
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    return new Blob([buffer], { type: blob.type || 'video/mp4' });
}

async function waitForFile(options) {
    const { pollUntil } = await import('../poll.js');
    return pollUntil({
        signal: options.signal,
        sleep: options.sleep,
        intervalMs: 2000,
        onProgress: options.onProgress,
        tick: async () => {
            const history = await comfyJson(options.base, `/history/${options.promptId}`, {
                fetchImpl: options.fetchImpl,
                signal: options.signal,
                expectJson: true,
            });
            const entry = history?.[options.promptId] || history;
            const status = entry?.status?.status_str;
            if (status === 'error') {
                return { failed: true, message: entry?.status?.messages?.map((item) => JSON.stringify(item)).join(' ') || 'ComfyUI reported an error.' };
            }
            const file = findOutputFile(entry);
            if (file) return { done: true, value: file, message: 'Downloading clip' };
            return { message: status || 'Running on ComfyUI' };
        },
    });
}
