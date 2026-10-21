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

export function explainError(message) {
    const text = String(message || 'Something failed.');
    if (/cors proxy is disabled|enableCorsProxy/i.test(text)) {
        return { plain: 'SillyTavern’s CORS proxy is off, so this host cannot be reached.', fix: 'For Replicate, Runway, or Kling’s own API, set enableCorsProxy: true in config.yaml or start SillyTavern with --corsProxy, then restart. fal, xAI, and OpenRouter are called directly.' };
    }
    if (/timed out|timeout/i.test(text)) {
        return { plain: 'The provider took too long to answer.', fix: 'Try that scene again. Cancel stops waiting. Clips that already finished can still be downloaded.' };
    }
    if (/failed to fetch|networkerror|network request failed|connection (?:was )?(?:reset|closed|refused)|net::err/i.test(text)) {
        return { plain: 'The connection dropped before the provider finished.', fix: 'Check the network and try that scene again. For Replicate, Runway, or Kling’s own API, set enableCorsProxy: true or start SillyTavern with --corsProxy. fal, xAI, and OpenRouter are called directly.' };
    }
    if (/add an? .+ key|no key|api key|401|403|unauthorized/i.test(text)) {
        return { plain: 'The provider rejected the credentials.', fix: 'Open Extensions → Scene Video and paste the key for this provider. Keys stay in SillyTavern settings.json.' };
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
    return { plain: text, fix: 'Turn on Debug mode and use Copy diagnostics. The log keeps request summaries with keys removed.' };
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
