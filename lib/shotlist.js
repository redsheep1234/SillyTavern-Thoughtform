import { THEMES, STYLES } from './constants.js';
import { clipText, snapDuration } from './util.js';

export const SHOT_SCHEMA = {
    name: 'shot_list',
    description: 'Visual scenes for a text-to-video model.',
    strict: false,
    returnInvalid: true,
    value: {
        type: 'object',
        additionalProperties: false,
        required: ['scenes'],
        properties: {
            scenes: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['title', 'prompt', 'duration'],
                    properties: {
                        title: { type: 'string' },
                        prompt: { type: 'string' },
                        negative_prompt: { type: 'string' },
                        camera: { type: 'string' },
                        duration: { type: 'number' },
                        characters: { type: 'array', items: { type: 'string' } },
                        continuity: { type: 'string' },
                    },
                },
            },
        },
    },
};

export function findTheme(themeId) {
    for (const group of THEMES) {
        const theme = group.items.find((item) => item.id === themeId);
        if (theme) return theme;
    }
    return THEMES[1].items[0];
}

export function styleLine(settings) {
    const style = STYLES.find((item) => item.id === settings.style) || STYLES[0];
    if (style.id === 'other') return String(settings.styleOther || '').trim();
    return style.line;
}

export function themeLine(settings) {
    return findTheme(settings.themeId).prompt;
}

/**
 * @param {object} args
 * @param {Array<{id:number,name:string,text:string}>} args.messages
 * @param {{user:any,characters:any[]}} args.cast
 * @param {object} args.settings
 */
export function buildShotListRequest({ messages, cast, settings }) {
    const theme = findTheme(settings.themeId);
    const count = Number(settings.sceneCount) || 0;
    const seconds = Number(settings.secondsPerScene) || 5;
    const systemPrompt = [
        'You are a storyboard artist writing prompts for a text-to-video model.',
        'Return JSON only. No markdown. Shape: {"scenes":[{"title":"","prompt":"","negative_prompt":"","camera":"","duration":5,"characters":[],"continuity":""}]}',
        'Write what the camera sees. Do not transcribe dialogue unless a visible action depends on it.',
        'Repeat each character\'s appearance in every prompt so the shots stay consistent. Do not contradict the descriptions.',
        'Put shot size and camera movement in both "camera" and the prompt.',
        'Apply the style and theme to every scene.',
        'This is the user\'s own fiction, which may be mature. Describe the picture. Do not add warnings, refusals, or commentary.',
        count > 0
            ? `Produce exactly ${count} scenes. Merge or split the messages to hit that count.`
            : 'Auto-split: one scene per distinct beat, usually one scene per one to three messages, never more than 8 scenes.',
        `Each duration is close to ${seconds} seconds.`,
    ].join('\n');

    const castLines = [
        `User persona ${cast.user?.name || 'User'}: ${cast.user?.description || '(no description)'}`,
        ...(cast.characters || []).map((character) => [
            `Character ${character.name}: ${character.description || '(no description)'}`,
            character.personality ? `Personality: ${character.personality}` : '',
            character.scenario ? `Scenario: ${character.scenario}` : '',
        ].filter(Boolean).join('\n')),
    ];

    const messageLines = messages.map((message) => `#${message.id} ${message.name}: ${clipText(message.text, 2000)}`);
    const prompt = [
        `Style: ${styleLine(settings) || '(none)'}`,
        `Theme (${theme.label}): ${theme.prompt}`,
        settings.extraPrompt ? `Extra direction: ${settings.extraPrompt}` : '',
        settings.negativePrompt ? `Always avoid: ${settings.negativePrompt}` : '',
        settings.hasReferenceImage ? 'A reference still will be the first frame. Describe motion that can start from a single composed image.' : '',
        'People:',
        castLines.join('\n\n') || '(none)',
        'Messages:',
        messageLines.join('\n\n'),
    ].filter(Boolean).join('\n\n');

    return { systemPrompt, prompt };
}

export function parseShotList(raw, { fallbackSeconds = 5, allowedDurations = null } = {}) {
    const text = String(raw || '').trim();
    if (!text) throw new Error('The model returned an empty shot list.');
    const candidates = [];
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) candidates.push(fenced[1]);
    candidates.push(text);
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));

    let parsed = null;
    for (const candidate of candidates) {
        try {
            parsed = JSON.parse(repairJson(candidate));
            if (parsed && Array.isArray(parsed.scenes)) break;
            parsed = null;
        } catch {
            parsed = null;
        }
    }
    if (!parsed) {
        const error = new Error('Could not read a JSON shot list from the model reply.');
        error.raw = text.slice(0, 4000);
        throw error;
    }
    if (!parsed.scenes.length) throw new Error('The shot list has no scenes.');
    return parsed.scenes.map((scene, index) => normalizeScene(scene, index, fallbackSeconds, allowedDurations));
}

function repairJson(text) {
    return String(text).trim().replace(/,\s*([}\]])/g, '$1');
}

function normalizeScene(scene, index, fallbackSeconds, allowedDurations) {
    const duration = snapDuration(Number(scene?.duration) || fallbackSeconds, allowedDurations);
    return {
        title: String(scene?.title || `Scene ${index + 1}`).slice(0, 120),
        prompt: String(scene?.prompt || '').trim(),
        negative_prompt: String(scene?.negative_prompt || '').trim(),
        camera: String(scene?.camera || '').trim(),
        duration,
        characters: Array.isArray(scene?.characters) ? scene.characters.map(String) : [],
        continuity: String(scene?.continuity || '').trim(),
    };
}

/** Deterministic split used when no LLM is available. The user can edit every prompt. */
export function localShotList(messages, settings) {
    if (!messages.length) return [];
    const requested = Number(settings.sceneCount) || 0;
    const count = requested > 0 ? requested : Math.max(1, Math.min(8, Math.round(messages.length / 2) || 1));
    const seconds = Number(settings.secondsPerScene) || 5;
    const buckets = Array.from({ length: count }, () => []);
    messages.forEach((message, index) => {
        const bucket = Math.min(count - 1, Math.floor((index * count) / messages.length));
        buckets[bucket].push(message);
    });
    return buckets.filter((bucket) => bucket.length).map((bucket, index) => {
        const names = [...new Set(bucket.map((message) => message.name))];
        const action = bucket.map((message) => `${message.name}: ${clipText(message.text, 400)}`).join(' ');
        return {
            title: `Scene ${index + 1}`,
            prompt: `${names.join(' and ')}. ${action}`,
            negative_prompt: '',
            camera: 'Medium shot, gentle camera move that fits the action.',
            duration: seconds,
            characters: names,
            continuity: index === 0 ? '' : 'Match the previous scene\'s faces, clothes, and location.',
        };
    });
}

export function composeVideoPrompt(scene, settings) {
    return [
        styleLine(settings),
        themeLine(settings),
        scene.continuity,
        scene.prompt,
        scene.camera ? `Camera: ${scene.camera}` : '',
        settings.extraPrompt,
    ].map((part) => String(part || '').trim()).filter(Boolean).join('\n');
}

export function composeNegativePrompt(scene, settings) {
    return [settings.negativePrompt, scene.negative_prompt].map((part) => String(part || '').trim()).filter(Boolean).join(', ');
}
