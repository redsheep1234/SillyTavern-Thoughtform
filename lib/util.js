/**
 * @param {number} ms
 * @param {AbortSignal} [signal]
 */
export function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(abortError());
        };
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
    });
}

export function abortError() {
    const error = new Error('Cancelled');
    error.name = 'AbortError';
    return error;
}

export function isAbortError(error) {
    return error?.name === 'AbortError' || error?.message === 'Cancelled';
}

/**
 * @param {object} obj
 * @param {string} path Dot path with optional [index] segments.
 */
export function getByPath(obj, path) {
    if (!path) return undefined;
    const parts = String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let current = obj;
    for (const part of parts) {
        if (current == null) return undefined;
        current = current[part];
    }
    return current;
}

/**
 * Parse a JSON template, then replace {{tokens}}.
 * A value that is only "{{token}}" keeps the raw type of the variable.
 * @param {string} template
 * @param {Record<string, any>} vars
 */
export function renderJsonTemplate(template, vars) {
    let parsed;
    try {
        parsed = JSON.parse(template);
    } catch (error) {
        throw new Error(`Request template is not valid JSON. ${error.message}`);
    }
    return substitute(parsed, vars);
}

function substitute(value, vars) {
    if (typeof value === 'string') {
        const exact = value.match(/^\{\{\s*([A-Za-z0-9_]+)\s*\}\}$/);
        if (exact && Object.hasOwn(vars, exact[1])) return vars[exact[1]];
        return value.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, key) => {
            const replacement = vars[key];
            return replacement == null ? '' : String(replacement);
        });
    }
    if (Array.isArray(value)) return value.map((item) => substitute(item, vars));
    if (value && typeof value === 'object') {
        const out = {};
        for (const [key, item] of Object.entries(value)) out[key] = substitute(item, vars);
        return out;
    }
    return value;
}

/** @param {string} template @param {Record<string, any>} vars */
export function renderStringTemplate(template, vars) {
    return String(template || '').replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, key) => {
        const replacement = vars[key];
        return replacement == null ? '' : String(replacement);
    });
}

export function coerceVideoUrl(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return coerceVideoUrl(value[0]);
    if (typeof value === 'object') return value.url || value.uri || value.href || '';
    return '';
}

export function errorText(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map((item) => item?.msg || errorText(item)).filter(Boolean).join('; ');
    if (typeof value === 'object') return value.message || value.detail || JSON.stringify(value);
    return String(value);
}

export async function readError(response) {
    const text = await response.text();
    if (!text) return `HTTP ${response.status}`;
    try {
        const json = JSON.parse(text);
        return errorText(json.detail) || errorText(json.error) || errorText(json.message) || text;
    } catch {
        return text.slice(0, 800);
    }
}

/**
 * @param {number} seconds
 * @param {Array<number|string>} allowed
 */
export function snapDuration(seconds, allowed) {
    const numeric = (allowed || [])
        .map((value) => Number(String(value).replace(/s$/i, '')))
        .filter((value) => Number.isFinite(value) && value > 0);
    if (!numeric.length) return Math.max(1, Math.round(Number(seconds) || 5));
    const target = Number(seconds) || numeric[0];
    return numeric.reduce((best, value) => (Math.abs(value - target) < Math.abs(best - target) ? value : best));
}

export function formatUsd(amount) {
    if (amount == null || Number.isNaN(amount)) return '';
    if (amount === 0) return '$0.00';
    if (amount < 0.01) return `$${amount.toFixed(4)}`;
    return `$${amount.toFixed(2)}`;
}

const DIMENSIONS = {
    '480p': { '16:9': [832, 480], '9:16': [480, 832], '1:1': [512, 512], '4:3': [640, 480], '3:4': [480, 640] },
    '720p': { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [720, 720], '4:3': [960, 720], '3:4': [720, 960] },
    '1080p': { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:3': [1440, 1080], '3:4': [1080, 1440] },
};

export function dimensionsFor(resolution, aspectRatio) {
    const row = DIMENSIONS[resolution] || DIMENSIONS['720p'];
    return row[aspectRatio] || row['16:9'];
}

/** Wan-style frame counts are 4n+1. */
export function frameCount(seconds, fps) {
    const raw = Math.max(5, Math.round(Number(seconds) * Number(fps)));
    const steps = Math.max(1, Math.round((raw - 1) / 4));
    return steps * 4 + 1;
}

export function safeFileName(name) {
    const cleaned = String(name || '').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
    return cleaned || 'thoughtform.mp4';
}

export function clipText(text, max) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (value.length <= max) return value;
    return `${value.slice(0, max - 1)}…`;
}

export function absoluteUrl(maybeRelative, origin) {
    if (!maybeRelative) return '';
    if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative;
    const base = origin || 'https://openrouter.ai';
    return new URL(maybeRelative, base).toString();
}

export function parseStatusList(text) {
    return String(text || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
}
