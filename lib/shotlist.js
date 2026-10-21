import { THEMES, STYLES } from './constants.js';
import { styleLockText } from './style-lock.js';
import { shotLine } from './timeline.js';
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
                        dialogue: { type: 'string' },
                        narration: { type: 'string' },
                        shot_type: { type: 'string' },
                        camera_move: { type: 'string' },
                        locations: { type: 'array', items: { type: 'string' } },
                        props: { type: 'array', items: { type: 'string' } },
                        outfits: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    character: { type: 'string' },
                                    outfit: { type: 'string' },
                                    description: { type: 'string' },
                                    change: { type: 'boolean' },
                                },
                            },
                        },
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
export function buildShotListRequest({ messages, cast, settings, wardrobeText = '', continuityText = '' }) {
    const theme = findTheme(settings.themeId);
    const count = Number(settings.sceneCount) || 0;
    const seconds = Number(settings.secondsPerScene) || 5;
    const systemPrompt = [
        'You are a storyboard artist writing prompts for a text-to-video model.',
        'Return JSON only. No markdown. Shape: {"scenes":[{"title":"","prompt":"","negative_prompt":"","camera":"","duration":5,"characters":[],"continuity":""}]}',
        'Write what the camera sees. Do not transcribe dialogue unless a visible action depends on it.',
        'Repeat each character\'s appearance in every prompt so the shots stay consistent. Do not contradict the descriptions.',
        'When a scene has two or more people, place each one explicitly (on the left, in the center, or on the right) and repeat distinguishing traits: age, hairstyle, and outfit. Do not let them share a face or swap clothes.',
        'Put shot size and camera movement in both "camera" and the prompt.',
        'Apply the style and theme to every scene.',
        'This is the user\'s own fiction, which may be mature. Describe the picture. Do not add warnings, refusals, or commentary.',
        'Copy every name in "characters" from the people who are actually in that scene, including the user persona.',
        'Each selected message is spoken by the name in front of it. Write "dialogue" as "Name: line", one speaker per line.',
        'Never give one person another person\'s line. A muted member gets a line only when a selected message is already theirs.',
        'Someone who joins partway through the chat appears only in the scenes that cover their messages. A "first speaks at" note means every earlier scene leaves them out.',
        'Add "locations" and "props" arrays naming recurring places and held objects.',
        'Add "dialogue" for the spoken line and "narration" for narrator text. Leave them empty when there is none.',
        'Set "shot_type" to wide, medium, close-up, pov, or ots, and "camera_move" to static, pan, dolly, orbit, or handheld.',
        'Each scene may include "outfits": [{"character":"","outfit":"","description":"","change":false}].',
        'If someone changes clothes, set change to true. Reuse a wardrobe name when it fits. Otherwise propose a short new name and a visual description of the clothes.',
        'If clothes do not change, set change to false and repeat the current outfit, or omit that person. Outfit state persists until the story changes it.',
        count > 0
            ? `Produce exactly ${count} scenes. Merge or split the messages to hit that count.`
            : 'Auto-split: one scene per distinct beat, usually one scene per one to three messages, never more than 8 scenes.',
        `Each duration is close to ${seconds} seconds.`,
    ].join('\n');

    const castLines = [
        `User persona ${cast.user?.name || 'User'}: ${cast.user?.description || '(no description)'}`,
        ...(cast.characters || []).map((character) => [
            `Character ${character.name}${character.muted ? ' (muted)' : ''}${character.guest ? ' (spoke, no longer in the group)' : ''}${character.firstId == null ? '' : ` (first speaks at #${character.firstId})`}: ${character.description || '(no description)'}`,
            character.personality ? `Personality: ${character.personality}` : '',
            character.scenario ? `Scenario: ${character.scenario}` : '',
        ].filter(Boolean).join('\n')),
        ...(cast.muted || []).map((character) => `Muted and not in these messages, so leave them out: ${character.name}`),
    ];

    const messageLines = messages.map((message) => `#${message.id} ${message.name}: ${clipText(message.text, 2000)}`);
    const prompt = [
        `Style lock: ${styleLockText(settings)}`,
        `Style: ${styleLine(settings) || '(none)'}`,
        `Theme (${theme.label}): ${theme.prompt}`,
        settings.extraPrompt ? `Extra direction: ${settings.extraPrompt}` : '',
        settings.negativePrompt ? `Always avoid: ${settings.negativePrompt}` : '',
        settings.hasReferenceImage ? 'A reference still will be the first frame. Describe motion that can start from a single composed image.' : '',
        wardrobeText ? `Wardrobe:\n${wardrobeText}` : '',
        continuityText ? `Continuity from the previous episode:\n${continuityText}` : '',
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

export function linesFromDialogue(dialogue, fallbackSpeaker = '') {
    const lines = [];
    for (const raw of String(dialogue || '').split(/\n+/)) {
        const text = raw.trim();
        if (!text) continue;
        const match = text.match(/^([^:]{1,80}):\s*(.+)$/);
        if (match) lines.push({ speaker: match[1].trim(), text: match[2].trim() });
        else lines.push({ speaker: fallbackSpeaker || 'Narrator', text });
    }
    return lines;
}

export function linesFromMessages(messages) {
    return (messages || []).filter((message) => !message.isSystem).map((message) => ({
        speaker: message.name,
        text: clipText(message.text, 240),
        messageId: message.id,
    }));
}

function linesOf(scene) {
    if (Array.isArray(scene?.lines) && scene.lines.length) {
        return scene.lines.map((line) => ({
            speaker: String(line?.speaker || 'Narrator'),
            text: String(line?.text || '').trim(),
        })).filter((line) => line.text);
    }
    return linesFromDialogue(scene?.dialogue, Array.isArray(scene?.characters) ? scene.characters[0] : '');
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
        dialogue: String(scene?.dialogue || '').trim(),
        narration: String(scene?.narration || '').trim(),
        caption: String(scene?.caption || scene?.dialogue || '').trim(),
        shotType: String(scene?.shotType || scene?.shot_type || 'medium'),
        cameraMove: String(scene?.cameraMove || scene?.camera_move || 'static'),
        locations: Array.isArray(scene?.locations) ? scene.locations.map(String) : [],
        props: Array.isArray(scene?.props) ? scene.props.map(String) : [],
        outfits: Array.isArray(scene?.outfits) ? scene.outfits.map((item) => ({
            character: String(item?.character || ''),
            outfit: String(item?.outfit || ''),
            description: String(item?.description || ''),
            change: Boolean(item?.change),
        })) : [],
        lines: linesOf(scene),
        trimIn: Math.max(0, Number(scene?.trimIn) || 0),
        trimOut: scene?.trimOut == null || scene.trimOut === '' ? '' : Number(scene.trimOut),
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
        const lines = linesFromMessages(bucket);
        const names = [...new Set(lines.map((line) => line.speaker))];
        const action = bucket.map((message) => `${message.name}: ${clipText(message.text, 400)}`).join(' ');
        return {
            title: `Scene ${index + 1}`,
            prompt: `${names.join(' and ')}. ${action}`,
            negative_prompt: '',
            camera: 'Medium shot, gentle camera move that fits the action.',
            duration: seconds,
            characters: names,
            avatars: bucket.map((message) => message.avatar || ''),
            dialogue: lines.map((line) => `${line.speaker}: ${line.text}`).join('\n'),
            lines,
            narration: '',
            caption: lines.map((line) => `${line.speaker}: ${line.text}`).join('\n'),
            shotType: 'medium',
            cameraMove: 'static',
            locations: [],
            props: [],
            outfits: [],
            trimIn: 0,
            trimOut: '',
            continuity: index === 0 ? '' : 'Match the previous scene\'s faces, clothes, and location.',
        };
    });
}

export function composeVideoPrompt(scene, settings, appearance = '') {
    return [
        styleLockText(settings),
        styleLine(settings),
        themeLine(settings),
        appearance,
        shotLine(scene),
        scene.continuity,
        scene.prompt,
        scene.camera ? `Camera: ${scene.camera}` : '',
        settings.extraPrompt,
    ].map((part) => String(part || '').trim()).filter(Boolean).join('\n');
}

export function composeNegativePrompt(scene, settings) {
    return [settings.negativePrompt, scene.negative_prompt].map((part) => String(part || '').trim()).filter(Boolean).join(', ');
}
