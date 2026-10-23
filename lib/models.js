import { estimateCost } from './cost.js';
import { GEMINI_IMAGE_ID, IMAGE_MODELS, findImageModel, missingImageKey, stillCost } from './providers/image.js';
import { getProvider, providers } from './providers/registry.js';
import { activeModelId, applyQualityPreset } from './presets.js';
import { formatAudShort } from './simple.js';

const PICTURE_PROVIDERS = [
    { id: 'mock', label: 'Mock' },
    { id: 'openrouter', label: 'OpenRouter' },
    { id: 'fal', label: 'fal.ai' },
    { id: 'comfy', label: 'ComfyUI' },
];

const SHOT_PROVIDERS = [
    { id: 'sillytavern', label: "SillyTavern's model" },
    { id: 'openrouter', label: 'OpenRouter' },
    { id: 'openai', label: 'OpenAI-compatible' },
];

const VOICE_PROVIDERS = [
    { id: 'mock', label: 'Mock', model: 'Mock tone' },
    { id: 'elevenlabs', label: 'ElevenLabs', model: 'SillyTavern voice map' },
    { id: 'openai', label: 'OpenAI-compatible', model: 'Speech model' },
];

export const SAME_PROVIDERS = [
    { id: 'openrouter', label: 'OpenRouter' },
    { id: 'fal', label: 'fal.ai' },
    { id: 'comfyui', label: 'ComfyUI (local)' },
    { id: 'mock', label: 'Mock (free preview)' },
];

const PICTURE_DEFAULT = {
    mock: 'mock',
    openrouter: GEMINI_IMAGE_ID,
    fal: 'fal-ai/flux-pro/kontext/multi',
    comfy: 'comfy',
};

function saved(settings, key) {
    return Boolean(String(settings?.[key] || '').trim());
}

export function pictureProviderId(modelId) {
    const id = String(modelId || 'mock');
    if (id === 'comfy') return 'comfy';
    if (id.startsWith('fal-ai/')) return 'fal';
    if (id === 'mock') return 'mock';
    return 'openrouter';
}

export function pictureModels(providerId) {
    return IMAGE_MODELS.filter((model) => pictureProviderId(model.id) === providerId);
}

function keyState(settings, keySetting) {
    if (!keySetting) return { state: 'local', text: 'No key' };
    if (saved(settings, keySetting)) return { state: 'ok', text: 'Saved' };
    return { state: 'needs', text: 'Needs key', setting: keySetting };
}

function pictureCost(modelId) {
    const cost = stillCost(1, modelId);
    if (!cost.usd) return 'Free';
    return `${formatAudShort(cost.usd)} each`;
}

function videoCost(settings) {
    const estimate = estimateCost({
        providerId: settings.provider,
        modelId: activeModelId(settings),
        resolution: settings.resolution,
        seconds: 1,
        sceneCount: 1,
        customPerSecond: settings.custom?.costPerSecond,
    });
    if (!estimate.known || estimate.usd == null) return 'Check provider';
    if (estimate.usd === 0) return 'Free';
    return `${formatAudShort(estimate.usd)} / second`;
}

function shotSource(settings) {
    return settings?.llmSource || 'sillytavern';
}

export function describeSource(settings) {
    return String(settings?.describeSource || '').trim() || shotSource(settings);
}

export function textSettingsFor(settings, { image = '' } = {}) {
    if (!settings || !image || !String(settings.describeSource || '').trim()) return settings;
    if (settings.describeSource === settings.llmSource) return settings;
    return { ...settings, llmSource: settings.describeSource };
}

function shotModelLabel(settings, source) {
    if (source === 'openrouter') return settings.openrouterTextModel || 'openrouter/auto';
    if (source === 'openai') return settings.openaiModel || 'Model name not set';
    return "SillyTavern's connected model";
}

function pictureWarnings(settings) {
    const model = findImageModel(settings.imageModel);
    const notes = [];
    const gap = missingImageKey(settings);
    if (gap) notes.push(gap.text);
    if (model.id === 'mock') {
        notes.push('Mock draws a text card, not a picture. Suites send reference photos, and a text card will not keep a likeness.');
    }
    if (model.id === 'comfy' && !String(settings.comfyWorkflow || '').trim()) {
        notes.push('ComfyUI stills need a workflow. Load one in the ComfyUI row.');
    }
    return notes;
}

function videoWarnings(settings) {
    const provider = getProvider(settings.provider);
    const notes = [];
    if (provider.needsKey && provider.keySetting && !saved(settings, provider.keySetting)) {
        notes.push(`${provider.label} needs a key.`);
    }
    if (provider.id === 'mock') notes.push('Real video with Mock is a title card.');
    if (provider.requiresProxy) notes.push("Replicate needs SillyTavern's CORS proxy.");
    if (provider.id === 'comfyui' && !String(settings.comfyWorkflow || '').trim()) {
        notes.push('ComfyUI video needs a workflow. Load one in the ComfyUI row.');
    }
    if (provider.supportsImage === false) {
        notes.push('This provider cannot take a reference still, so Animate this still cannot send the picture.');
    }
    return notes;
}

function shotWarnings(settings, source = shotSource(settings)) {
    const notes = [];
    if (source === 'openrouter' && !saved(settings, 'openrouterKey')) notes.push('Shot list needs an OpenRouter key.');
    if (source === 'openai' && !saved(settings, 'openaiKey')) notes.push('Shot list needs an OpenAI-compatible key.');
    if (source === 'openai' && !String(settings.openaiModel || '').trim()) notes.push('Set the OpenAI-compatible model name.');
    return notes;
}

function describeWarnings(settings) {
    const source = describeSource(settings);
    const notes = [];
    if (source === 'sillytavern') {
        notes.push("Describe from picture sends the portrait to SillyTavern's model. That model has to be able to see a picture.");
    }
    if (source === 'openrouter' && !saved(settings, 'openrouterKey')) notes.push('Describe from picture needs an OpenRouter key.');
    if (source === 'openai' && !saved(settings, 'openaiKey')) notes.push('Describe from picture needs an OpenAI-compatible key.');
    if (source === 'openai' && !String(settings.openaiModel || '').trim()) notes.push('Set the OpenAI-compatible model name.');
    return notes;
}

function voiceWarnings(settings) {
    if (settings.ttsProvider === 'openai' && !saved(settings, 'openaiKey')) {
        return ['Speech needs an OpenAI-compatible key.'];
    }
    if (settings.ttsProvider === 'elevenlabs') {
        return ["ElevenLabs uses the voice map in SillyTavern's TTS settings."];
    }
    return [];
}

function lipsyncWarnings(settings) {
    const model = settings.lipSyncModel || '';
    if (model !== 'comfy' && !saved(settings, 'falKey')) return ['Lip-sync on fal.ai needs a fal.ai key.'];
    return [];
}

export function modelRows(settings = {}) {
    const picture = findImageModel(settings.imageModel);
    const pictureProvider = pictureProviderId(picture.id);
    const video = getProvider(settings.provider);
    const videoModelId = activeModelId(settings);
    const videoModel = (video.models || []).find((model) => model.id === videoModelId);
    const shots = shotSource(settings);
    const describing = describeSource(settings);
    const voice = VOICE_PROVIDERS.find((item) => item.id === settings.ttsProvider) || VOICE_PROVIDERS[0];
    const lipsyncComfy = settings.lipSyncModel === 'comfy';
    const lipsyncModel = lipsyncComfy
        ? 'ComfyUI workflow'
        : (settings.lipSyncModel === 'fal-ai/latentsync' ? 'LatentSync' : 'sync-lipsync v3');
    const musicOn = settings.musicEnabled === true;
    const track = (settings.audioLibrary || []).find((item) => item.id === settings.musicTrackId);
    return [
        {
            id: 'pictures',
            task: 'Pictures',
            detail: 'Expressions, turnarounds, scene stills, outfits, and Animate this still.',
            providerId: pictureProvider,
            providerLabel: PICTURE_PROVIDERS.find((item) => item.id === pictureProvider)?.label || pictureProvider,
            modelId: picture.id,
            modelLabel: picture.short || picture.label,
            summary: `${picture.short || picture.label} (${PICTURE_PROVIDERS.find((item) => item.id === pictureProvider)?.label || pictureProvider})`,
            key: picture.key ? keyState(settings, picture.key) : { state: 'local', text: 'No key' },
            cost: pictureCost(picture.id),
            warnings: pictureWarnings(settings),
        },
        {
            id: 'video',
            task: 'Video',
            detail: 'The clip after you approve a still. Quality presets can change this model.',
            providerId: video.id,
            providerLabel: video.label,
            modelId: videoModelId,
            modelLabel: videoModel?.label || videoModelId || 'Workflow',
            summary: `${video.label} · ${videoModel?.label || videoModelId || 'Workflow'}`,
            key: video.needsKey ? keyState(settings, video.keySetting) : { state: 'local', text: 'No key' },
            cost: videoCost(settings),
            warnings: videoWarnings(settings),
        },
        {
            id: 'shots',
            task: 'Shot list',
            detail: 'Writes the scene prompts.',
            providerId: shots,
            providerLabel: SHOT_PROVIDERS.find((item) => item.id === shots)?.label || shots,
            modelId: shots,
            modelLabel: shotModelLabel(settings, shots),
            summary: shotModelLabel(settings, shots),
            key: shots === 'openrouter' ? keyState(settings, 'openrouterKey') : (shots === 'openai' ? keyState(settings, 'openaiKey') : { state: 'local', text: 'No key' }),
            cost: shots === 'sillytavern' ? 'Chat model' : 'Check provider',
            warnings: shotWarnings(settings),
        },
        {
            id: 'describe',
            task: 'Describe a picture',
            detail: 'Describe from picture, and the first look at an avatar.',
            providerId: String(settings.describeSource || '').trim() ? describing : '',
            providerLabel: String(settings.describeSource || '').trim()
                ? (SHOT_PROVIDERS.find((item) => item.id === describing)?.label || describing)
                : 'Same as shot list',
            modelId: describing,
            modelLabel: shotModelLabel(settings, describing),
            summary: String(settings.describeSource || '').trim()
                ? shotModelLabel(settings, describing)
                : `Same as shot list · ${shotModelLabel(settings, describing)}`,
            key: describing === 'openrouter' ? keyState(settings, 'openrouterKey') : (describing === 'openai' ? keyState(settings, 'openaiKey') : { state: 'local', text: 'No key' }),
            cost: describing === 'sillytavern' ? 'Chat model' : 'Check provider',
            warnings: describeWarnings(settings),
        },
        {
            id: 'voice',
            task: 'Dialogue voice',
            detail: 'Speak dialogue on the Finish step.',
            providerId: voice.id,
            providerLabel: voice.label,
            modelId: voice.id,
            modelLabel: voice.id === 'openai' ? (settings.openaiTtsModel || 'gpt-4o-mini-tts') : voice.model,
            summary: `${voice.label} · ${voice.id === 'openai' ? (settings.openaiTtsModel || 'gpt-4o-mini-tts') : voice.model}`,
            key: voice.id === 'openai' ? keyState(settings, 'openaiKey') : { state: 'local', text: 'No key' },
            cost: voice.id === 'mock' ? 'Free' : 'Check provider',
            warnings: voiceWarnings(settings),
        },
        {
            id: 'lipsync',
            task: 'Lip-sync',
            detail: 'A later pass on the finished clip.',
            providerId: lipsyncComfy ? 'comfy' : 'fal',
            providerLabel: lipsyncComfy ? 'ComfyUI' : 'fal.ai',
            modelId: settings.lipSyncModel || 'fal-ai/sync-lipsync/v3',
            modelLabel: lipsyncModel,
            summary: `${lipsyncComfy ? 'ComfyUI' : 'fal.ai'} · ${lipsyncModel}`,
            key: lipsyncComfy ? { state: 'local', text: 'No key' } : keyState(settings, 'falKey'),
            cost: lipsyncComfy ? 'Free' : 'Check provider',
            warnings: lipsyncWarnings(settings),
        },
        {
            id: 'music',
            task: 'Music',
            detail: 'A track you already have. Thoughtform does not generate music.',
            providerId: musicOn ? 'library' : 'off',
            providerLabel: 'Your library',
            modelId: musicOn ? (settings.musicTrackId || '') : '',
            modelLabel: musicOn ? (track?.name || settings.musicTag || 'No track selected') : 'Off',
            summary: musicOn ? (track?.name || settings.musicTag || 'No track selected') : 'Off',
            key: { state: 'local', text: 'No key' },
            cost: 'Free',
            warnings: musicOn && !track && !String(settings.musicTag || '').trim() ? ['Pick a track, or music stays silent.'] : [],
        },
        {
            id: 'workflow',
            task: 'ComfyUI workflow',
            detail: 'Used when pictures or video are set to ComfyUI.',
            providerId: 'comfyui',
            providerLabel: 'ComfyUI',
            modelId: settings.comfyWorkflowName || '',
            modelLabel: settings.comfyWorkflowName || (settings.comfyWorkflow ? 'Imported workflow' : 'None loaded'),
            summary: settings.comfyWorkflowName || (settings.comfyWorkflow ? 'Imported workflow' : 'None loaded'),
            key: { state: 'local', text: 'No key' },
            cost: 'Free',
            warnings: String(settings.comfyWorkflow || '').trim() ? [] : ['No workflow loaded. Local ComfyUI stills and video need one.'],
        },
    ];
}

export function choiceLine(settings, id) {
    const row = modelRows(settings).find((item) => item.id === id);
    if (!row) return '';
    return `${row.task}: ${row.summary}`;
}

export function modelWarnings(settings) {
    return modelRows(settings).flatMap((row) => row.warnings.map((text) => ({ id: row.id, task: row.task, text })));
}

export function keyStatuses(settings = {}) {
    const rows = [
        ['OpenRouter', 'openrouterKey'],
        ['fal.ai', 'falKey'],
        ['xAI', 'xaiKey'],
        ['Replicate', 'replicateKey'],
        ['OpenAI-compatible', 'openaiKey'],
    ];
    return rows.map(([label, setting]) => ({
        label,
        setting,
        ...(saved(settings, setting) ? { state: 'ok', text: 'Saved' } : { state: 'needs', text: 'Needs key' }),
    }));
}

export function applyPictureProvider(settings, providerId) {
    settings.imageModel = PICTURE_DEFAULT[providerId] || PICTURE_DEFAULT.mock;
    settings.imageModelChosen = true;
    return settings;
}

export function applyLipsyncProvider(settings, providerId) {
    settings.lipSyncModel = providerId === 'comfy' ? 'comfy' : 'fal-ai/sync-lipsync/v3';
    return settings;
}

/** Fill every task a provider can do. Existing keys and unsupported tasks stay. */
export function applySameProvider(settings, providerId) {
    const skipped = [];
    if (providerId === 'openrouter') {
        applyPictureProvider(settings, 'openrouter');
        settings.provider = 'openrouter';
        if (settings.quality !== 'custom') applyQualityPreset(settings, settings.quality || 'standard');
        settings.llmSource = 'openrouter';
        if (!String(settings.openrouterTextModel || '').trim()) settings.openrouterTextModel = 'openrouter/auto';
        settings.describeSource = '';
        skipped.push('Voice stays as it is. OpenRouter does not speak.');
        skipped.push('Lip-sync stays as it is. OpenRouter does not lip-sync.');
    } else if (providerId === 'fal') {
        applyPictureProvider(settings, 'fal');
        settings.provider = 'fal';
        if (settings.quality !== 'custom') applyQualityPreset(settings, settings.quality || 'standard');
        applyLipsyncProvider(settings, 'fal');
        skipped.push('Shot list stays as it is. fal.ai does not write prompts.');
        skipped.push('Describe a picture stays as it is. fal.ai does not look at a portrait.');
        skipped.push('Voice stays as it is. fal.ai does not speak.');
    } else if (providerId === 'comfyui') {
        applyPictureProvider(settings, 'comfy');
        settings.provider = 'comfyui';
        if (settings.quality !== 'custom') applyQualityPreset(settings, settings.quality || 'standard');
        applyLipsyncProvider(settings, 'comfy');
        skipped.push('Shot list stays as it is. ComfyUI does not write prompts.');
        skipped.push('Describe a picture stays as it is. ComfyUI does not look at a portrait.');
        skipped.push('Voice stays as it is. ComfyUI does not speak.');
    } else if (providerId === 'mock') {
        applyPictureProvider(settings, 'mock');
        settings.provider = 'mock';
        if (settings.quality !== 'custom') applyQualityPreset(settings, settings.quality || 'standard');
        settings.ttsProvider = 'mock';
        skipped.push('Shot list stays as it is. Mock does not write prompts.');
        skipped.push('Describe a picture stays as it is. Mock does not look at a portrait.');
    } else {
        skipped.push('Pick a provider first.');
    }
    skipped.push('Music stays a track from your library.');
    return { skipped };
}

export function sameProviderNote(result) {
    return (result?.skipped || []).join(' ');
}

export { providers, PICTURE_PROVIDERS, SHOT_PROVIDERS, VOICE_PROVIDERS };
