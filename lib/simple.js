import { estimateCost } from './cost.js';
import { activeModelId, applyQualityPreset, getQualityPreset } from './presets.js';

/** Approximate rate used only for the on-screen AUD figure. Not a live bank quote. */
export const USD_PER_AUD = 0.66;

export function audToUsd(aud) {
    const value = Number(aud);
    if (!Number.isFinite(value)) return 0;
    return round3(value * USD_PER_AUD);
}

export function usdToAud(usd) {
    const value = Number(usd);
    if (!Number.isFinite(value)) return 0;
    return round3(value / USD_PER_AUD);
}

export function formatClock(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    if (minutes <= 0) return `~${total}s`;
    return `~${minutes}m${String(rest).padStart(2, '0')}s`;
}

export function formatAud(usd) {
    if (usd == null || Number.isNaN(Number(usd))) return 'Check provider';
    if (Number(usd) === 0) return '$0.00 AUD';
    return `$${(Number(usd) / USD_PER_AUD).toFixed(2)} AUD`;
}

export function overCapMessage({ projectedUsd, capAud } = {}) {
    const projected = Number(projectedUsd) || 0;
    const aud = Number(capAud) || usdToAud(projected);
    return `This would pass your budget (about $${Number(aud).toFixed(2)} AUD, $${projected.toFixed(2)} USD). Continue past the cap?`;
}

export function contentHash(value) {
    const text = stableString(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function stillAssetKey({ prompt = '', modelId = '', medium = '', references = [] } = {}) {
    const refs = (references || []).map((item) => String(item || '').slice(-32));
    return `still:${contentHash({ prompt: String(prompt || ''), modelId, medium, refs })}`;
}

export function keyframeAssetKey({ prompt = '', modelId = '', medium = '' } = {}) {
    return `keyframe:${contentHash({ prompt: String(prompt || ''), modelId, medium })}`;
}

export function clipAssetKey({ prompt = '', provider = '', modelId = '', resolution = '', fps = 0, seconds = 0, quality = '', stillKey = '' } = {}) {
    return `clip:${contentHash({
        prompt: String(prompt || ''),
        provider,
        modelId,
        resolution,
        fps: Number(fps) || 0,
        seconds: Number(seconds) || 0,
        quality: quality || '',
        stillKey: stillKey || '',
    })}`;
}

export function lookupAsset(records, key) {
    if (!key) return '';
    for (const record of records || []) {
        for (const image of record?.images || []) {
            if (image.cacheKey === key && (image.dataUrl || image.url)) return image.dataUrl || image.url;
        }
    }
    return '';
}

export function rememberAsset(cache, key, kind = 'asset') {
    const next = { ...(cache && typeof cache === 'object' ? cache : {}) };
    if (!key) return next;
    next[key] = { kind, usd: 0, label: 'cached, $0' };
    const keys = Object.keys(next);
    if (keys.length > 200) delete next[keys[0]];
    return next;
}

export function condenseBeats(messages, lengthId = 'medium') {
    const list = (messages || []).filter((message) => String(message?.text || '').trim());
    if (!list.length) return [];
    if (lengthId === 'full' || list.length <= 4) {
        return list.map((message, index) => beatFrom([message], index));
    }
    const size = lengthId === 'short' ? 6 : 3;
    const maxBeats = lengthId === 'short' ? 4 : 8;
    const count = Math.max(1, Math.min(maxBeats, Math.ceil(list.length / size)));
    const buckets = Array.from({ length: count }, () => []);
    list.forEach((message, index) => {
        buckets[Math.min(count - 1, Math.floor((index * count) / list.length))].push(message);
    });
    return buckets.filter((bucket) => bucket.length).map((bucket, index) => beatFrom(bucket, index));
}

export function beatsToMessages(beats) {
    return (beats || []).map((beat, index) => ({
        id: beat.messageIds?.[0] ?? index,
        name: (beat.speakers || [])[0] || 'Narrator',
        text: String(beat.text || ''),
        isUser: false,
    }));
}

/**
 * Fit scene count, clip length, and quality to a dollar cap or a target length.
 * With no scene list, the summary prices the whole film (stills plus video).
 * A scene list prices only what the next export will spend, and cached scenes are $0.
 */
export function fitPlan(input = {}) {
    const providerId = input.providerId || 'mock';
    const mode = input.mode === 'length' ? 'length' : 'cap';
    const capAud = Math.max(0, Number(input.capAud) || 0);
    const capUsd = mode === 'cap' ? audToUsd(capAud) : 0;
    const spentUsd = Math.max(0, Number(input.spentUsd) || 0);
    const stillKnown = input.stillUsdEach != null && Number.isFinite(Number(input.stillUsdEach));
    const stillUnit = stillKnown ? Number(input.stillUsdEach) : 0;
    const stillsFirst = input.stillsFirst !== false;
    const requested = getQualityPreset(input.quality) ? input.quality : 'standard';
    const preferred = requested === 'high' ? 'showcase' : requested;
    const baseSettings = {
        provider: providerId,
        xaiModel: input.xaiModel,
        falModel: input.falModel,
        replicateModel: input.replicateModel,
        openrouterVideoModel: input.openrouterVideoModel,
        quality: preferred,
        resolution: input.resolution || '720p',
    };
    const room = Math.max(0, capUsd - spentUsd);
    let sceneCount = suggestedScenes(input.messageCount, input.derive ? 0 : input.sceneCount);
    let seconds = clamp(input.secondsPerScene || 5, 2, 10);
    let quality = preferred;

    if (mode === 'length') {
        const shaped = shapeLength(input);
        sceneCount = shaped.sceneCount;
        seconds = shaped.seconds;
    } else if (capAud > 0) {
        const fitted = fitUnderCap({
            room,
            qualities: input.lockQuality ? [preferred] : ladderFrom(preferred),
            sceneCount,
            seconds,
            quote: (nextQuality, count, secs) => fullQuote({
                quality: nextQuality,
                sceneCount: count,
                seconds: secs,
                providerId,
                baseSettings,
                stillUnit,
                modelInfo: input.modelInfo,
                customPerSecond: input.customPerSecond,
            }),
        });
        sceneCount = fitted.sceneCount;
        seconds = fitted.seconds;
        quality = fitted.quality;
    }

    const hasScenes = Array.isArray(input.scenes) && input.scenes.length > 0;
    const placeholders = Array.from({ length: sceneCount }, (_, index) => ({
        index,
        seconds,
        asVideo: !stillsFirst,
        cachedStill: false,
        cachedClip: false,
        quality: '',
        stills: 1,
    }));
    const lines = (hasScenes ? input.scenes : placeholders).map((scene, index) => priceScene({
        scene,
        index,
        fallbackSeconds: seconds,
        fallbackQuality: quality,
        providerId,
        baseSettings,
        stillUnit,
        stillKnown,
        stillsFirst,
        modelInfo: input.modelInfo,
        customPerSecond: input.customPerSecond,
    }));
    const film = fullQuote({
        quality,
        sceneCount,
        seconds,
        providerId,
        baseSettings,
        stillUnit,
        modelInfo: input.modelInfo,
        customPerSecond: input.customPerSecond,
    });
    const priced = hasScenes ? sumLines(lines) : {
        usd: film.known ? film.usd : null,
        known: film.known,
        totalSeconds: sceneCount * seconds,
    };
    const known = priced.known;
    const usd = known ? round3(priced.usd) : null;
    const totalSeconds = priced.totalSeconds;
    const projected = spentUsd + (usd || 0);
    const over = mode === 'cap' && capUsd > 0 && known && projected > capUsd + 1e-9;
    const cachedCount = lines.filter((line) => line.cached).length;
    const providerLabel = input.providerLabel || providerId;
    const summaryCore = !known
        ? 'Check provider'
        : `≈ ${formatAud(usd)} ($${usd.toFixed(2)} USD), ${lines.length} scene${lines.length === 1 ? '' : 's'}, ${formatClock(totalSeconds)}`;
    const cacheBit = cachedCount ? `, ${cachedCount} cached, $0` : '';
    const qualityLabel = getQualityPreset(quality)?.label || quality;
    let summary = `${providerLabel}: ${summaryCore}${cacheBit}`;
    let note = '';
    if (!hasScenes && stillsFirst && known) {
        const animatic = round3(stillUnit * sceneCount);
        summary = `${providerLabel}: ≈ ${formatAud(film.usd)} ($${film.usd.toFixed(2)} USD), ${sceneCount} scene${sceneCount === 1 ? '' : 's'}, ${formatClock(sceneCount * seconds)}, ${qualityLabel}`;
        note = `Moving stills first: ${formatAud(animatic)}. Tick a scene when you want real video.`;
    } else if (hasScenes && stillsFirst && !lines.some((line) => line.asVideo)) {
        note = `A new film at this budget would be ${sceneCount} scenes, ${formatClock(sceneCount * seconds)}, ${qualityLabel}.`;
    }
    if (cachedCount && !summary.includes('cached, $0')) summary += ', cached, $0';
    return {
        mode,
        quality,
        sceneCount,
        secondsPerScene: seconds,
        totalSeconds,
        usd,
        aud: known ? usdToAud(usd) : null,
        known,
        fits: !over,
        over,
        capAud,
        capUsd,
        spentUsd: round3(spentUsd),
        lines,
        summary,
        note,
        cachedCount,
        providerLabel,
    };
}

function fitUnderCap({ room, qualities, sceneCount, seconds, quote }) {
    const attempt = (quality, count, secs) => {
        const priced = quote(quality, count, secs);
        if (!priced.known) return { done: true, quality, sceneCount: count, seconds: secs };
        if (priced.usd <= room + 1e-9) return { done: true, quality, sceneCount: count, seconds: secs };
        return null;
    };
    for (const quality of qualities) {
        const hit = attempt(quality, sceneCount, seconds);
        if (hit?.done) return hit;
    }
    for (const quality of qualities) {
        for (let secs = seconds - 1; secs >= 2; secs -= 1) {
            const hit = attempt(quality, sceneCount, secs);
            if (hit?.done) return hit;
        }
    }
    for (const quality of qualities) {
        for (let count = sceneCount - 1; count >= 1; count -= 1) {
            for (let secs = seconds; secs >= 2; secs -= 1) {
                const hit = attempt(quality, count, secs);
                if (hit?.done) return hit;
            }
        }
    }
    return { quality: qualities[qualities.length - 1] || 'draft', sceneCount: 1, seconds: 2 };
}

function fullQuote({ quality, sceneCount, seconds, providerId, baseSettings, stillUnit, modelInfo, customPerSecond }) {
    const active = modelFor(baseSettings, quality);
    const video = estimateCost({
        providerId,
        modelId: active.modelId,
        resolution: active.resolution,
        seconds,
        sceneCount,
        modelInfo,
        customPerSecond,
    });
    if (!video.known || video.usd == null) return { known: false, usd: null, resolution: active.resolution, modelId: active.modelId };
    return { known: true, usd: round3(video.usd + stillUnit * sceneCount), resolution: active.resolution, modelId: active.modelId };
}

function priceScene({ scene, index, fallbackSeconds, fallbackQuality, providerId, baseSettings, stillUnit, stillKnown, stillsFirst, modelInfo, customPerSecond }) {
    const seconds = clamp(scene.seconds || scene.duration || fallbackSeconds, 1, 15);
    const quality = scene.quality || fallbackQuality;
    const active = modelFor(baseSettings, quality);
    const stills = Math.max(1, Number(scene.stills) || 1);
    const asVideo = scene.asVideo === true || (scene.asVideo !== false && !stillsFirst);
    const cachedStill = Boolean(scene.cachedStill);
    const cachedClip = Boolean(scene.cachedClip);
    let known = cachedStill || stillKnown;
    let stillUsd = cachedStill ? 0 : stillUnit * stills;
    let videoUsd = 0;
    if (!cachedStill && !stillKnown) known = false;
    if (asVideo && !cachedClip) {
        const video = estimateCost({
            providerId,
            modelId: active.modelId,
            resolution: active.resolution,
            seconds,
            sceneCount: 1,
            modelInfo,
            customPerSecond,
        });
        known = known && video.known;
        videoUsd = video.known ? video.usd : 0;
    }
    const cached = asVideo ? cachedClip : cachedStill;
    const usd = (cachedStill ? 0 : stillUsd) + (asVideo && !cachedClip ? videoUsd : 0);
    let label = 'Check provider';
    if (cached) label = 'cached, $0';
    else if (known) label = usd === 0 ? '$0.00' : formatAud(usd);
    return {
        index: scene.index ?? index,
        seconds,
        asVideo,
        quality,
        usd: known ? round3(usd) : null,
        stillUsd: round3(cachedStill ? 0 : stillUsd),
        videoUsd: round3(asVideo && !cachedClip ? videoUsd : 0),
        known,
        cached,
        label,
    };
}

function sumLines(lines) {
    const known = lines.every((line) => line.known);
    return {
        known,
        usd: known ? lines.reduce((sum, line) => sum + (line.usd || 0), 0) : null,
        totalSeconds: lines.reduce((sum, line) => sum + line.seconds, 0),
    };
}

function modelFor(settings, quality) {
    const copy = { ...settings };
    if (getQualityPreset(quality)) applyQualityPreset(copy, quality);
    return { modelId: activeModelId(copy), resolution: copy.resolution || settings.resolution || '720p' };
}

function ladderFrom(quality) {
    const order = ['showcase', 'standard', 'draft'];
    if (quality === 'max') return ['max', ...order];
    const start = order.indexOf(quality);
    if (start < 0) return order;
    return order.slice(start);
}

function shapeLength(input) {
    const target = clamp(input.targetSeconds || 70, 10, 180);
    let count = Number(input.derive ? 0 : input.sceneCount) || 0;
    if (!count) count = clamp(Math.round((Number(input.messageCount) || 6) / 2) || 1, 1, 12);
    if (count * 10 < target) count = clamp(Math.ceil(target / 10), 1, 12);
    const seconds = clamp(Math.round(target / count), 2, 10);
    return { sceneCount: count, seconds };
}

function suggestedScenes(messageCount, requested) {
    const asked = Number(requested) || 0;
    if (asked > 0) return clamp(asked, 1, 12);
    const messages = Math.max(0, Number(messageCount) || 0);
    if (!messages) return 1;
    return clamp(Math.round(messages / 2) || 1, 1, 12);
}

function beatFrom(bucket, index) {
    const speakers = [...new Set(bucket.map((message) => message.name).filter(Boolean))];
    const text = bucket.map((message) => `${message.name}: ${firstSentence(message.text)}`).join(' ');
    return {
        title: `Beat ${index + 1}`,
        text: text.slice(0, 500),
        speakers,
        messageIds: bucket.map((message) => message.id),
    };
}

function firstSentence(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    const cut = clean.split(/(?<=[.!?])\s/)[0] || clean;
    return cut.length > 160 ? `${cut.slice(0, 159)}…` : cut;
}

function stableString(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value !== 'object') return String(value);
    if (Array.isArray(value)) return `[${value.map((item) => stableString(item)).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${key}:${stableString(value[key])}`).join(',')}}`;
}

function clamp(value, min, max) {
    const number = Math.round(Number(value) || min);
    return Math.max(min, Math.min(max, number));
}

function round3(value) {
    return Math.round(Number(value) * 1000) / 1000;
}
