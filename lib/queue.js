/** Persisted render jobs. The API key is never stored; resume reads it from settings. */

const STORAGE_KEY = 'stsv-queue';

export function loadQueue(storage = globalThis.localStorage) {
    try {
        const raw = storage?.getItem?.(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function saveQueue(jobs, storage = globalThis.localStorage) {
    try {
        storage?.setItem?.(STORAGE_KEY, JSON.stringify(jobs.slice(-30)));
    } catch {
        /* Private mode can reject the write. The in-panel list still works. */
    }
}

export function upsertJob(jobs, job) {
    const next = jobs.filter((item) => item.id !== job.id);
    next.push({ ...job, updatedAt: new Date().toISOString() });
    return next.slice(-30);
}

export function resumableJobs(jobs) {
    return jobs.filter((job) => job?.statusUrl && (job.state === 'running' || job.state === 'queued'));
}

/**
 * Map a provider status payload to a small result.
 * @returns {{done?: boolean, failed?: boolean, url?: string, message?: string}}
 */
export function readJobUpdate(provider, payload) {
    const body = payload || {};
    if (provider === 'xai') {
        const status = String(body.status || '').toLowerCase();
        if (status === 'done' || status === 'completed') return { done: true, url: body.video?.url || '', message: 'Ready' };
        if (status === 'failed' || status === 'expired') return { failed: true, message: body.error || `xAI ${status}.` };
        return { message: status || 'pending' };
    }
    if (provider === 'fal') {
        const status = String(body.status || '').toUpperCase();
        if (status === 'COMPLETED') return { done: true, url: body.video?.url || body.response_url || '', message: 'Ready' };
        if (status === 'FAILED' || body.error) return { failed: true, message: body.error || 'fal.ai failed.' };
        return { message: status || 'WORKING' };
    }
    if (provider === 'openrouter') {
        const status = String(body.status || '').toLowerCase();
        if (status === 'completed') {
            const url = (Array.isArray(body.urls) ? body.urls.find((item) => typeof item === 'string') : '') || body.unsigned_urls?.[0] || '';
            return { done: true, url, message: 'Ready' };
        }
        if (['failed', 'cancelled', 'canceled', 'expired'].includes(status)) return { failed: true, message: body.error || `OpenRouter ${status}.` };
        return { message: status || 'pending' };
    }
    if (provider === 'replicate') {
        const status = String(body.status || '').toLowerCase();
        if (status === 'succeeded') return { done: true, url: typeof body.output === 'string' ? body.output : body.output?.[0] || '', message: 'Ready' };
        if (['failed', 'canceled'].includes(status)) return { failed: true, message: body.error || `Replicate ${status}.` };
        return { message: status || 'starting' };
    }
    if (provider === 'comfyui') {
        const entry = body?.[body.prompt_id] || body;
        if (entry?.status?.status_str === 'error') return { failed: true, message: 'ComfyUI reported an error.' };
        const outputs = entry?.outputs || {};
        const file = Object.values(outputs).flatMap((output) => [...(output?.videos || []), ...(output?.images || [])]).find((item) => item?.filename);
        if (file) return { done: true, url: file.filename, message: 'Ready' };
        return { message: entry?.status?.status_str || 'running' };
    }
    return { message: 'unknown provider' };
}

export async function pollJob(job, { fetchImpl, headers, sleep, signal, attempts = 30 } = {}) {
    if (!job?.statusUrl) throw new Error('This job has no status URL to resume.');
    let last = { message: 'pending' };
    for (let attempt = 0; attempt < attempts; attempt++) {
        if (signal?.aborted) {
            const error = new Error('Cancelled');
            error.name = 'AbortError';
            throw error;
        }
        const response = await fetchImpl(job.statusUrl, { method: 'GET', headers, signal });
        if (!response.ok) {
            const text = typeof response.text === 'function' ? await response.text() : '';
            throw new Error(text || `Resume failed (${response.status}).`);
        }
        const payload = await response.json();
        last = readJobUpdate(job.provider, payload);
        if (job.provider === 'fal' && last.done && !String(last.url).startsWith('http') && job.responseUrl) {
            const result = await fetchImpl(job.responseUrl, { method: 'GET', headers, signal });
            const body = await result.json();
            last = { done: true, url: body?.video?.url || body?.images?.[0]?.url || '', message: 'Ready' };
        }
        if (last.done || last.failed) return last;
        if (sleep) await sleep(0);
    }
    return last;
}
