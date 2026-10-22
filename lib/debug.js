/** In-memory debug log. Secrets are redacted before anything is stored or copied. */

const KEY_NAME = /key|token|secret|authorization|password/i;
const logs = [];
const MAX_LOGS = 80;

export function resetDebugLog() {
    logs.length = 0;
}

export function redactText(value) {
    return String(value ?? '')
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
        .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
        .replace(/(api[_-]?key|token|authorization|secret)(["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1$2[redacted]')
        .replace(/data:[^;]{1,40};base64,[A-Za-z0-9+/=]{16,}/g, '[data-url]');
}

export function redactSettings(settings) {
    let clone;
    try {
        clone = structuredClone(settings || {});
    } catch {
        return {};
    }
    const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        for (const [key, value] of Object.entries(node)) {
            if (typeof value === 'string' && KEY_NAME.test(key) && value) node[key] = '[redacted]';
            else if (typeof value === 'string' && value.startsWith('data:') && value.length > 64) node[key] = `[data-url ${value.length} chars]`;
            else if (value && typeof value === 'object') walk(value);
        }
    };
    walk(clone);
    if (clone.library?.records) {
        for (const record of Object.values(clone.library.records)) {
            if (!Array.isArray(record?.images)) continue;
            record.images = record.images.map((image) => ({
                ...image,
                dataUrl: image.dataUrl ? `[data-url ${image.dataUrl.length} chars]` : '',
            }));
        }
    }
    return clone;
}

const DETAIL_LIMIT = 180;

const PROVIDER_LABELS = {
    openrouter: 'OpenRouter',
    fal: 'fal.ai',
    xai: 'xAI',
    replicate: 'Replicate',
    openai: 'OpenAI',
    custom: 'The custom host',
    comfyui: 'ComfyUI',
};

export function missingKey(provider, step, message) {
    const error = new Error(message);
    error.provider = provider;
    error.step = step;
    error.emptyKey = true;
    return error;
}

export function tagFailure(error, { provider, step } = {}) {
    const wrapped = error instanceof Error ? error : new Error(String(error ?? 'Something failed.'));
    if (provider && !wrapped.provider) wrapped.provider = provider;
    if (step && !wrapped.step) wrapped.step = step;
    return wrapped;
}

function clipDetail(value) {
    const clean = redactText(value).replace(/\s+/g, ' ').trim();
    if (!clean || /^HTTP \d{3}$/i.test(clean)) return '';
    if (clean.length <= DETAIL_LIMIT) return clean;
    return `${clean.slice(0, DETAIL_LIMIT - 1)}…`;
}

function failureMeta(message, options = {}) {
    const error = message && typeof message === 'object' ? message : null;
    const text = String(error?.message || message || 'Something failed.');
    const statusMatch = text.match(/\bHTTP\s+(\d{3})\b/i);
    return {
        text,
        provider: String(options.provider || error?.provider || '').toLowerCase(),
        step: String(options.step || error?.step || '').toLowerCase(),
        status: Number(options.status || error?.status || statusMatch?.[1] || 0) || 0,
    };
}

function providerLabel(meta) {
    if (PROVIDER_LABELS[meta.provider]) return PROVIDER_LABELS[meta.provider];
    if (/openrouter/i.test(meta.text)) return 'OpenRouter';
    if (/fal\.ai/i.test(meta.text)) return 'fal.ai';
    if (/\bxai\b/i.test(meta.text)) return 'xAI';
    if (/replicate/i.test(meta.text)) return 'Replicate';
    return '';
}

function whileMaking(step) {
    if (step === 'still' || step === 'image') return 'while making the still';
    if (step === 'video') return 'while making the video';
    if (step === 'shot list' || step === 'shotlist') return 'while writing the shot list';
    if (step === 'text') return 'while writing text';
    if (step === 'models') return 'while listing models';
    return '';
}

function rejectedPlain(label, step) {
    const where = whileMaking(step);
    return where ? `${label} rejected the key ${where}.` : `${label} rejected the key.`;
}

function emptyKeyCopy(meta) {
    const text = meta.text.trim();
    const shotList = meta.step === 'shot list' || meta.step === 'shotlist' || /shot-list|shot list/i.test(text);
    const shotFix = 'Add it under Extensions → Thoughtform, or switch the shot-list source back to SillyTavern.';
    const addFix = 'Add it under Extensions → Thoughtform.';
    if (meta.emptyKey || /^No [A-Za-z0-9. -]+ (?:key|token) yet\.?$/i.test(text)) {
        const plain = text.endsWith('.') ? text : `${text}.`;
        if (/^No Replicate token yet/i.test(plain)) {
            return { plain: 'No Replicate token yet.', fix: 'Add the token under Extensions → Thoughtform, and enable SillyTavern’s CORS proxy.' };
        }
        return { plain, fix: shotList ? shotFix : addFix };
    }
    if (/add an openrouter key/i.test(text)) return { plain: 'No OpenRouter key yet.', fix: shotList ? shotFix : addFix };
    if (/add an xai key/i.test(text)) return { plain: 'No xAI key yet.', fix: addFix };
    if (/add a fal\.ai key/i.test(text)) return { plain: 'No fal.ai key yet.', fix: addFix };
    if (/add a replicate/i.test(text)) return { plain: 'No Replicate token yet.', fix: 'Add the token under Extensions → Thoughtform, and enable SillyTavern’s CORS proxy.' };
    return null;
}

function openRouterCopy(meta) {
    const known = meta.provider === 'openrouter' || /openrouter/i.test(meta.text);
    if (!known) return null;
    const detail = clipDetail(meta.text);
    const limit = meta.status === 403 || /key limit exceeded/i.test(meta.text);
    const credits = meta.status === 402 || /insufficient credits|payment required|requires more credits|not enough credits/i.test(meta.text);
    const invalid = meta.status === 401 || /invalid (?:api )?key|missing authentication|unauthorized|user not found/i.test(meta.text);
    if (limit) {
        return {
            plain: rejectedPlain('OpenRouter', meta.step),
            detail,
            fix: 'Raise this key\'s limit at openrouter.ai/settings/keys.',
        };
    }
    if (credits) {
        const plain = meta.step === 'still'
            ? 'OpenRouter does not have enough credits to make the still.'
            : meta.step === 'video'
                ? 'OpenRouter does not have enough credits to make the video.'
                : 'OpenRouter does not have enough credits.';
        return { plain, detail, fix: 'Add credits at openrouter.ai/settings/credits.' };
    }
    if (invalid) {
        return {
            plain: rejectedPlain('OpenRouter', meta.step),
            detail,
            fix: 'Open Extensions → Thoughtform and paste a valid OpenRouter key. Keys stay in SillyTavern settings.json.',
        };
    }
    return null;
}

export function explainError(message, options = {}) {
    const meta = failureMeta(message, options);
    const { text } = meta;
    if (/at least \$1(?:\.00)? in balance|requires at least \$1/i.test(text)) {
        return {
            plain: 'OpenRouter needs at least US$1.00 in the account before it will make an image or a video.',
            detail: clipDetail(text),
            fix: 'Top up the OpenRouter balance, or switch the still model and the video provider to Mock or another host.',
            banner: true,
        };
    }
    if (/cors proxy is disabled|enableCorsProxy/i.test(text)) {
        return { plain: 'SillyTavern’s CORS proxy is off, so this host cannot be reached.', fix: 'For Replicate, Runway, or Kling’s own API, set enableCorsProxy: true in config.yaml or start SillyTavern with --corsProxy, then restart. fal, xAI, and OpenRouter are called directly.' };
    }
    if (/timed out|timeout/i.test(text)) {
        return { plain: 'The provider took too long to answer.', fix: 'Try that scene again. Cancel stops waiting. Clips that already finished can still be downloaded.' };
    }
    if (/failed to fetch|networkerror|network request failed|connection (?:was )?(?:reset|closed|refused)|net::err/i.test(text)) {
        return { plain: 'The connection dropped before the provider finished.', fix: 'Check the network and try that scene again. For Replicate, Runway, or Kling’s own API, set enableCorsProxy: true or start SillyTavern with --corsProxy. fal, xAI, and OpenRouter are called directly.' };
    }
    const empty = emptyKeyCopy(meta);
    if (empty) return empty;
    const openRouter = openRouterCopy(meta);
    if (openRouter) return openRouter;
    if (/add an? .+ key|no key|api key|401|403|unauthorized/i.test(text) || meta.status === 401 || meta.status === 403) {
        const label = providerLabel(meta);
        if (!label) {
            return {
                plain: 'The provider rejected the credentials.',
                detail: clipDetail(text),
                fix: 'Open Extensions → Thoughtform and paste the key for this provider. Keys stay in SillyTavern settings.json.',
            };
        }
        return {
            plain: rejectedPlain(label, meta.step),
            detail: clipDetail(text),
            fix: `Open Extensions → Thoughtform and paste the ${label} key. Keys stay in SillyTavern settings.json.`,
        };
    }
    if (/refus|rejected|content.?policy|safety|moderat|nsfw|prohibited|violat|not allowed|flagged|filtered|blocked by|cannot generate|unable to generate|disallowed|unprocessable|content_policy/i.test(text)) {
        const outfit = /outfit|clothes|clothing|wardrobe|bikini|dress|skirt|uniform/i.test(text);
        return {
            plain: outfit ? 'The provider refused this outfit prompt.' : 'The provider refused this prompt.',
            fix: 'Edit the prompt or the outfit description and generate again, or switch provider. The safety checkbox only sends a switch the host documents. Local ComfyUI does not apply that host’s filter.',
        };
    }
    if (/^fal\.ai failed\.?$/i.test(text) || /^HTTP 4\d\d$/.test(text.trim())) {
        return {
            plain: 'The provider rejected the request and did not explain why.',
            fix: 'Edit the prompt or switch provider, then try again. Outfit wording is a common reason. Local ComfyUI does not use that host’s filter.',
        };
    }
    if (/could not read a json shot list|empty shot list/i.test(text)) {
        return { plain: 'The shot-list model did not return usable JSON.', fix: 'Try again, switch the shot-list source, or use the local split and edit the prompts yourself.' };
    }
    if (/select at least one message/i.test(text)) {
        return { plain: 'No chat messages are selected.', fix: 'Tick the messages to film, or use All.' };
    }
    if (/ffmpeg|sharedarraybuffer/i.test(text)) {
        return { plain: 'The browser stitcher could not start.', fix: 'One clip downloads on its own. Multi-clip stitch loads ffmpeg.wasm from jsDelivr the first time. If the CDN is blocked, download the clips separately.' };
    }
    if (/comfyui|prompt_id|workflow/i.test(text)) {
        return { plain: 'ComfyUI did not accept the workflow.', fix: 'Check the URL, start ComfyUI with --enable-cors-header *, and load an API-format workflow whose model files exist on that machine. Keep the port private.' };
    }
    return { plain: text, fix: 'Try that step again, or switch provider. Nothing was requested again.' };
}

export function formatFailure(error) {
    const explained = explainError(error);
    const detail = explained.detail && !String(explained.plain || '').includes(explained.detail) ? explained.detail : '';
    return {
        ...explained,
        text: [explained.plain, detail, explained.fix].filter(Boolean).join(' '),
    };
}

export function debugLog(entry) {
    const item = {
        at: new Date().toISOString(),
        level: entry.level || 'info',
        message: redactText(entry.message || ''),
        ms: entry.ms == null ? null : Math.round(Number(entry.ms)),
        provider: entry.provider || '',
        detail: redactText(entry.detail || ''),
    };
    logs.push(item);
    if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
    return item;
}

export function recentLogs() {
    return logs.map((entry) => ({ ...entry }));
}

export function buildDiagnostics({ version, settings, extra = {} }) {
    return {
        version: version || '',
        exportedAt: new Date().toISOString(),
        userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
        settings: redactSettings(settings),
        logs: recentLogs(),
        ...extra,
    };
}
