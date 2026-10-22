import { abortError, readError } from './util.js';

export class ProxyDisabledError extends Error {
    constructor() {
        super('SillyTavern\'s built-in CORS proxy is off. Set enableCorsProxy: true in config.yaml, or start the server with --corsProxy, then restart.');
        this.name = 'ProxyDisabledError';
        this.code = 'PROXY_DISABLED';
    }
}

export function toProxyUrl(target) {
    if (typeof target !== 'string' || !/^https?:\/\//i.test(target)) {
        throw new Error('Only http and https URLs can be sent through the proxy.');
    }
    return `/proxy/${target}`;
}

/**
 * How many times a request may leave the browser.
 * A POST or PUT is a paid create. Auto mode sends it once. A status GET may try the proxy after a direct failure, because that read does not start a new job.
 */
export function transportAttempts(method = 'GET', mode = 'auto') {
    const verb = String(method || 'GET').toUpperCase();
    const writing = verb !== 'GET' && verb !== 'HEAD';
    if (mode === 'proxy') return ['proxy'];
    if (mode === 'direct') return ['direct'];
    if (writing) return ['direct'];
    return ['direct', 'proxy'];
}

/**
 * Browser fetch with an optional SillyTavern /proxy fallback.
 * mode: 'direct' | 'proxy' | 'auto'
 * The built-in proxy forwards JSON bodies and Authorization. It drops query strings.
 */
export async function providerFetch(url, options = {}) {
    const {
        method = 'GET',
        headers,
        body,
        signal,
        mode = 'auto',
        fetchImpl = globalThis.fetch,
    } = options;
    if (signal?.aborted) throw abortError();
    const attempts = transportAttempts(method, mode);
    const writing = !/^(GET|HEAD)$/i.test(method);
    let lastError = null;
    for (const attempt of attempts) {
        const target = attempt === 'proxy' ? toProxyUrl(url) : url;
        try {
            const response = await fetchImpl(target, {
                method,
                headers,
                body,
                signal,
                credentials: attempt === 'proxy' ? 'same-origin' : 'omit',
            });
            if (attempt === 'proxy' && response.status === 404) {
                const text = await response.clone().text();
                if (text.includes('CORS proxy is disabled')) throw new ProxyDisabledError();
            }
            return response;
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            lastError = error;
            if (error instanceof ProxyDisabledError) throw error;
            if (attempt === 'direct' && mode === 'auto' && attempts.includes('proxy')) continue;
            if (writing) {
                const wrapped = new Error(`${error?.message || 'The paid call did not finish.'} Nothing was requested again.`);
                wrapped.cause = error;
                throw wrapped;
            }
            throw error;
        }
    }
    throw lastError || new Error('Request failed');
}

export async function fetchJson(url, options = {}) {
    const response = await providerFetch(url, options);
    if (!response.ok) {
        throw new Error(await readError(response));
    }
    return response.json();
}

export async function downloadBinary(url, options = {}) {
    const response = await providerFetch(url, options);
    if (!response.ok) throw new Error(await readError(response));
    const blob = await response.blob();
    const type = blob.type || response.headers?.get?.('content-type') || 'video/mp4';
    const buffer = await blob.arrayBuffer();
    return new Blob([buffer], { type: type.split(';')[0] || 'video/mp4' });
}
