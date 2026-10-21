import { formatUsd } from './util.js';

/**
 * Rates checked against provider docs when this extension was written.
 * Unknown models return a null estimate instead of a guess.
 * OpenRouter's live pricing_skus override the fallback when the user refreshes models.
 */
const XAI_LITE = {
    perSecond: 0.03,
    perSecondByResolution: { '480p': 0.02, '720p': 0.03, '1080p': 0.14 },
    note: 'xAI list price, Oct 2026. Lite 1080p is upscaled from 720p.',
};
const XAI_FULL = {
    perSecond: 0.14,
    perSecondByResolution: { '480p': 0.08, '720p': 0.14, '1080p': 0.25 },
    note: 'xAI list price, Oct 2026. Native 1080p.',
};

const RATES = {
    'xai:grok-imagine-video-1.5-lite': XAI_LITE,
    'xai:grok-imagine-video-1.5': XAI_FULL,
    'openrouter:x-ai/grok-imagine-video-1.5-lite': XAI_LITE,
    'openrouter:x-ai/grok-imagine-video-1.5': XAI_FULL,
    'openrouter:alibaba/wan-3.0': {
        perSecondByResolution: { '480p': 0.05, '1080p': 0.20 },
        note: 'OpenRouter catalog range, mid-Oct 2026: about $0.05/s at 480p and $0.20/s at 1080p. Refresh models so live pricing_skus replace this. 720p is left as Check provider.',
    },
    'openrouter:kwaivgi/kling-v3.0-std': {
        perSecond: 0.084,
        note: 'About $0.084/s without audio and $0.126/s with audio, mid-Oct 2026. This estimate uses the silent rate.',
    },
    'fal:fal-ai/kling-video/v2.5-turbo/pro/text-to-video': {
        perSecond: 0.07,
        note: 'fal.ai lists $0.35 for a 5 second Kling 2.5 Turbo Pro clip and $0.07 for each extra second.',
    },
    'fal:fal-ai/kling-video/v2.5-turbo/pro/image-to-video': {
        perSecond: 0.07,
        note: 'Priced like Kling 2.5 Turbo Pro text-to-video. Confirm on fal.ai before a long run.',
    },
    'openrouter:google/veo-3.1': {
        perSecondByResolution: { '1080p': 0.20, '4k': 0.40 },
        note: 'OpenRouter list price, 21 Oct 2026, video only: about $0.20/s at 1080p and $0.40/s at 4K. With audio those are about $0.40/s and $0.60/s, which this estimate leaves out. 720p stays Check provider until Refresh models replaces this with live pricing_skus. This is an OpenRouter route, not the Gemini API.',
    },
};

export function rateFor(providerId, modelId, resolution, modelInfo) {
    if (providerId === 'openrouter' && modelInfo?.pricing_skus) {
        const skus = modelInfo.pricing_skus;
        const high = resolution === '1080p' || resolution === '4k' || resolution === '2K';
        const raw = (high && skus['per-video-second-1080p']) || skus['per-video-second'] || skus.generate;
        const perSecond = Number(raw);
        if (Number.isFinite(perSecond)) {
            return { perSecond, note: 'Live pricing_skus from OpenRouter /api/v1/videos/models.' };
        }
    }
    return RATES[`${providerId}:${modelId}`] || null;
}

export function estimateCost({ providerId, modelId, resolution, seconds, sceneCount, modelInfo, customPerSecond, totalSeconds, imageInputs = 0 }) {
    const count = Math.max(1, Number(sceneCount) || 1);
    const each = Math.max(0, Number(seconds) || 0);
    const billed = totalSeconds != null ? Math.max(0, Number(totalSeconds) || 0) : each * count;
    const sceneLabel = totalSeconds != null
        ? `${count} scene${count === 1 ? '' : 's'}, ${billed}s billed`
        : `${count} scene${count === 1 ? '' : 's'} × ${each}s`;
    if (providerId === 'mock' || providerId === 'comfyui') {
        return {
            usd: 0,
            known: true,
            label: '$0.00',
            note: providerId === 'comfyui' ? 'Local ComfyUI has no provider charge.' : 'The mock provider stays on this machine.',
        };
    }
    if (providerId === 'custom') {
        const rate = Number(customPerSecond);
        if (!Number.isFinite(rate) || customPerSecond === '' || customPerSecond == null) {
            return { usd: null, known: false, label: 'Unknown', note: 'Set a cost per second on the custom provider to see an estimate.' };
        }
        const usd = rate * billed;
        return { usd, known: true, label: `~${formatUsd(usd)}`, note: 'Using the cost per second you entered.' };
    }
    const rate = rateFor(providerId, modelId, resolution, modelInfo);
    if (!rate) {
        return {
            usd: null,
            known: false,
            label: 'Check provider',
            note: 'No rate is stored for this model. Video APIs usually bill per second of output. Confirm the price before generating.',
        };
    }
    const mapped = rate.perSecondByResolution?.[resolution];
    const perSecond = mapped != null ? mapped : rate.perSecond;
    if (perSecond == null || !Number.isFinite(Number(perSecond))) {
        return {
            usd: null,
            known: false,
            label: 'Check provider',
            note: rate.note || 'No rate is stored for this resolution.',
        };
    }
    const inputs = Math.max(0, Number(imageInputs) || 0);
    const imageFee = providerId === 'xai' ? 0.01 * inputs : 0;
    const usd = perSecond * billed + imageFee;
    const imageNote = imageFee
        ? ` Includes $${imageFee.toFixed(2)} for ${inputs} image input${inputs === 1 ? '' : 's'} at $0.01 each.`
        : '';
    return {
        usd,
        known: true,
        label: `~${formatUsd(usd)}`,
        note: `${rate.note} ${sceneLabel}.${imageNote} Stitching does not add provider cost.`,
    };
}
