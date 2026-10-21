export const QUALITY_PRESETS = [
    {
        id: 'draft',
        label: 'Draft',
        blurb: 'About 480p. Fastest path and the lowest hosted price.',
        xai: { model: 'grok-imagine-video-1.5-lite', resolution: '480p', fps: 16, steps: 8 },
        fal: { model: 'fal-ai/wan/v2.2-a14b/text-to-video', resolution: '480p', fps: 16, steps: 16 },
        replicate: { model: 'wan-video/wan-2.2-t2v-fast', resolution: '480p', fps: 16, steps: 16 },
        openrouter: { model: 'x-ai/grok-imagine-video-1.5-lite', resolution: '480p', fps: 16, steps: 16 },
        comfyui: { resolution: '480p', fps: 16, steps: 12 },
        mock: { resolution: '480p', fps: 8, steps: 1 },
        custom: { resolution: '480p', fps: 16, steps: 16 },
    },
    {
        id: 'standard',
        label: 'Standard',
        blurb: 'About 720p. Default balance of cost and motion.',
        xai: { model: 'grok-imagine-video-1.5-lite', resolution: '720p', fps: 24, steps: 20 },
        fal: { model: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video', resolution: '720p', fps: 24, steps: 20 },
        replicate: { model: 'kwaivgi/kling-v2.5-turbo-pro', resolution: '720p', fps: 24, steps: 20 },
        openrouter: { model: 'x-ai/grok-imagine-video-1.5-lite', resolution: '720p', fps: 24, steps: 20 },
        comfyui: { resolution: '720p', fps: 16, steps: 20 },
        mock: { resolution: '720p', fps: 8, steps: 1 },
        custom: { resolution: '720p', fps: 16, steps: 20 },
    },
    {
        id: 'showcase',
        label: 'Showcase',
        blurb: 'The sharp picture. It costs more per second, so a tight budget uses fewer or shorter scenes.',
        xai: { model: 'grok-imagine-video-1.5-lite', resolution: '1080p', fps: 24, steps: 28 },
        fal: { model: 'fal-ai/kling-video/v3/standard/text-to-video', resolution: '1080p', fps: 24, steps: 28 },
        replicate: { model: 'google/veo-3.1-fast', resolution: '1080p', fps: 24, steps: 28 },
        openrouter: { model: 'alibaba/wan-3.0', resolution: '1080p', fps: 24, steps: 28 },
        comfyui: { resolution: '1080p', fps: 24, steps: 24 },
        mock: { resolution: '1080p', fps: 8, steps: 1 },
        custom: { resolution: '1080p', fps: 24, steps: 28 },
    },
    {
        id: 'high',
        label: 'High',
        blurb: '1080p. On xAI Lite this is an upscale of 720p. Same picture as Showcase. Kept for older setups.',
        xai: { model: 'grok-imagine-video-1.5-lite', resolution: '1080p', fps: 24, steps: 28 },
        fal: { model: 'fal-ai/kling-video/v3/standard/text-to-video', resolution: '1080p', fps: 24, steps: 28 },
        replicate: { model: 'google/veo-3.1-fast', resolution: '1080p', fps: 24, steps: 28 },
        openrouter: { model: 'alibaba/wan-3.0', resolution: '1080p', fps: 24, steps: 28 },
        comfyui: { resolution: '1080p', fps: 24, steps: 24 },
        mock: { resolution: '1080p', fps: 8, steps: 1 },
        custom: { resolution: '1080p', fps: 24, steps: 28 },
    },
    {
        id: 'max',
        label: 'Max',
        blurb: 'Native 1080p or the top hosted model. Read the estimate before you queue it.',
        xai: { model: 'grok-imagine-video-1.5', resolution: '1080p', fps: 24, steps: 40 },
        fal: { model: 'fal-ai/veo3.1', resolution: '1080p', fps: 24, steps: 40 },
        replicate: { model: 'google/veo-3.1', resolution: '1080p', fps: 24, steps: 40 },
        openrouter: { model: 'google/veo-3.1', resolution: '1080p', fps: 24, steps: 40 },
        comfyui: { resolution: '1080p', fps: 24, steps: 40 },
        mock: { resolution: '1080p', fps: 8, steps: 1 },
        custom: { resolution: '1080p', fps: 24, steps: 40 },
    },
];

export function getQualityPreset(id) {
    return QUALITY_PRESETS.find((preset) => preset.id === id) || null;
}

/** Copy a preset onto the settings object for the active provider. */
export function applyQualityPreset(settings, qualityId) {
    const preset = getQualityPreset(qualityId);
    if (!preset) return settings;
    const patch = preset[settings.provider] || preset.custom;
    settings.quality = preset.id;
    if (patch.resolution) settings.resolution = patch.resolution;
    if (patch.fps) settings.fps = patch.fps;
    if (patch.steps) settings.steps = patch.steps;
    if (patch.model) {
        if (settings.provider === 'xai') settings.xaiModel = patch.model;
        if (settings.provider === 'fal') settings.falModel = patch.model;
        if (settings.provider === 'replicate') settings.replicateModel = patch.model;
        if (settings.provider === 'openrouter') settings.openrouterVideoModel = patch.model;
    }
    return settings;
}

export function activeModelId(settings) {
    switch (settings.provider) {
        case 'xai': return settings.xaiModel;
        case 'fal': return settings.falModel;
        case 'replicate': return settings.replicateModel;
        case 'openrouter': return settings.openrouterVideoModel;
        case 'comfyui': return settings.comfyWorkflowName || 'comfyui-workflow';
        case 'custom': return 'custom';
        default: return 'mock';
    }
}
