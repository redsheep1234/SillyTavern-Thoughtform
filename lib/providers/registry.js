import { generateComfy } from './comfyui.js';
import { generateCustom } from './custom.js';
import { generateFal, FAL_MODELS } from './fal.js';
import { generateMock } from './mock.js';
import { generateOpenRouterVideo, OPENROUTER_VIDEO_MODELS } from './openrouter.js';
import { generateReplicate, REPLICATE_MODELS } from './replicate.js';
import { generateXai, XAI_MODELS } from './xai.js';

/**
 * Provider contract. Copy one of the files in this folder and add it to `providers`.
 *
 * generate(request) -> Promise<Blob>
 * request: {
 *   prompt, negativePrompt, duration, aspectRatio, resolution, fps, steps, seed,
 *   imageDataUrl, disableSafetyChecker, generateAudio, modelId, modelInfo,
 *   settings, signal, corsMode, onProgress, registerCancel, fetchImpl, sleep
 * }
 * Throw a normal Error for a failure the panel should show.
 * Call registerCancel with a function that tells the remote job to stop.
 * Do not filter prompt text.
 */
export const providers = [
    {
        id: 'xai',
        label: 'xAI Grok Imagine',
        needsKey: true,
        keySetting: 'xaiKey',
        cors: 'direct',
        supportsImage: true,
        models: XAI_MODELS,
        setup: 'Browser-direct. Lite is the cheapest decent hosted default (about $0.02/s at 480p and $0.03/s at 720p). 1080p on Lite is upscaled from 720p. No SillyTavern proxy is required.',
        nsfw: 'xAI can reject a prompt and marks some outputs as moderated. This is not an unrestricted route. Local ComfyUI is.',
        generate: generateXai,
    },
    {
        id: 'openrouter',
        label: 'OpenRouter video',
        needsKey: true,
        keySetting: 'openrouterKey',
        cors: 'direct',
        supportsImage: true,
        models: OPENROUTER_VIDEO_MODELS,
        setup: 'Browser-direct, as of 21 Oct 2026. POST /api/v1/videos, then poll. Refresh models to load the live catalog and pricing. Auto still falls back to the SillyTavern proxy if a direct call fails. This is not the Gemini API and not Sora.',
        nsfw: 'There is no OpenRouter-wide safety switch. xAI, Alibaba, Kling, ByteDance, Google, and MiniMax each apply their own policy. This is not an unrestricted route.',
        generate: generateOpenRouterVideo,
    },
    {
        id: 'fal',
        label: 'fal.ai',
        needsKey: true,
        keySetting: 'falKey',
        cors: 'direct',
        supportsImage: true,
        models: FAL_MODELS,
        setup: 'Browser-direct. fal.ai allows the browser to call queue.fal.run. The key is stored in SillyTavern settings. No proxy is required.',
        nsfw: 'Kling 2.5 Turbo Pro and Wan 2.2 accept enable_safety_checker. Turning the safety setting off sends false; fal still runs the checker unless the account is allowed to disable it. Veo 3.1 on fal gets safety_tolerance 6 instead of 4. Kling v3 and Hailuo have no checker switch in their published schema.',
        generate: generateFal,
    },
    {
        id: 'comfyui',
        label: 'ComfyUI (local)',
        needsKey: false,
        cors: 'comfy',
        supportsImage: true,
        models: [{ id: 'workflow', label: 'Imported workflow' }],
        setup: 'Point this at your ComfyUI and an API-format workflow. Start ComfyUI with --enable-cors-header * so the page can call it. That flag is for a machine you control. Do not expose that ComfyUI port to the internet. WebSocket progress is direct-only. The SillyTavern proxy drops query strings, so /view will not work through it.',
        nsfw: 'Local ComfyUI is the unrestricted route (Wan 2.2 14B, HunyuanVideo 1.5, LTX-2.3), unless a node inside your own workflow adds a checker. This extension does not add one.',
        generate: generateComfy,
    },
    {
        id: 'mock',
        label: 'Mock (no key)',
        needsKey: false,
        cors: 'direct',
        supportsImage: true,
        models: [{ id: 'mock', label: 'Browser title card' }],
        setup: 'Records a short stand-in clip in this browser so you can try selection, the shot list, stitching, and download without spending money.',
        nsfw: 'The mock clip is a title card. It does not call a model.',
        generate: generateMock,
    },
    {
        id: 'custom',
        label: 'Custom API',
        needsKey: false,
        cors: 'auto',
        supportsImage: true,
        models: [{ id: 'custom', label: 'Template' }],
        setup: 'Any JSON host with a submit URL and a poll URL. Use this for Runway, Luma, or another vendor. Kling\'s own API does not allow browser CORS; Auto tries the browser first, then the SillyTavern proxy. Edit the template under Extensions → Scene Video.',
        nsfw: 'Nothing is added or removed here. Put whatever safety field the host documents into the body template.',
        generate: generateCustom,
    },
    {
        id: 'replicate',
        label: 'Replicate (needs CORS proxy)',
        needsKey: true,
        keySetting: 'replicateKey',
        cors: 'proxy',
        requiresProxy: true,
        supportsImage: true,
        models: REPLICATE_MODELS,
        setup: 'Needs SillyTavern\'s built-in CORS proxy. Replicate does not allow browser calls. Set enableCorsProxy: true in config.yaml, or start with --corsProxy, then restart. On a shared server the proxy is an SSRF risk. A private-address whitelist can also block it.',
        nsfw: 'Wan 2.2 fast accepts disable_safety_checker. Kling 2.5 Turbo Pro and Veo on Replicate do not publish that switch. Their own policy still applies.',
        generate: generateReplicate,
    },
];

export function getProvider(id) {
    return providers.find((provider) => provider.id === id) || providers.find((provider) => provider.id === 'mock');
}
