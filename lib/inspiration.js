/** Inspiration photos steer one thing each. Only an identity photo may steer the face. */

import { referenceCandidates } from './library.js';

export const PHOTO_ROLES = [
    { id: 'face', label: 'Face', phrase: 'face' },
    { id: 'hair', label: 'Hair', phrase: 'hair' },
    { id: 'body', label: 'Body/build', phrase: 'body type' },
    { id: 'outfit', label: 'Outfit', phrase: 'outfit' },
    { id: 'pose', label: 'Pose', phrase: 'pose' },
    { id: 'style', label: 'Style/vibe', phrase: 'style' },
];

const JOB_ROLES = {
    expression: ['face', 'hair'],
    closeup: ['face', 'hair'],
    body: ['face', 'body', 'outfit', 'pose'],
    turnaround: ['face', 'body', 'outfit', 'pose'],
    pose: ['face', 'body', 'outfit', 'pose'],
    outfit: ['face', 'body', 'outfit', 'pose'],
    scene: ['main', 'outfit', 'style'],
};

const USED_NAME = {
    face: 'Face photo',
    hair: 'Hair photo',
    body: 'Body photo',
    outfit: 'Outfit photo',
    pose: 'Pose photo',
    style: 'Style photo',
};

export function jobForTags(tags = []) {
    const list = tags || [];
    if (list.includes('closeup')) return 'closeup';
    if (list.includes('expression')) return 'expression';
    if (list.includes('turnaround')) return 'turnaround';
    if (list.includes('pose')) return 'pose';
    if (list.includes('outfit') || list.includes('full body')) return 'body';
    return 'expression';
}

export function imageRole(image) {
    if (PHOTO_ROLES.some((role) => role.id === image?.role)) return image.role;
    if (image?.source === 'avatar') return 'face';
    const tags = image?.tags || [];
    if (tags.includes('outfit')) return 'outfit';
    if (tags.includes('pose') || tags.includes('turnaround')) return 'pose';
    if (tags.includes('expression') || tags.includes('face') || tags.includes('closeup')) return 'face';
    if (tags.includes('full body')) return 'body';
    return '';
}

/** Identity defaults on for the avatar and the character's own stills. Inspiration stays off. */
export function isIdentityPhoto(image, record) {
    if (!image) return false;
    if (image.identity === true) return true;
    if (image.identity === false) return false;
    if (image.source === 'inspiration') return false;
    if (image.source === 'avatar') return true;
    if (record?.primaryId && image.id === record.primaryId) return true;
    const tags = image.tags || [];
    return tags.includes('expression') || tags.includes('face') || tags.includes('closeup');
}

export function usedName(image, record) {
    if (!image) return 'reference';
    if (image.source === 'avatar' || image.avatar) return 'avatar';
    if (record?.primaryId && image.id === record.primaryId && image.source !== 'inspiration') return 'main picture';
    const role = imageRole(image);
    if (USED_NAME[role] && (image.source === 'inspiration' || image.role)) return USED_NAME[role];
    return image.label || USED_NAME[role] || 'reference';
}

export function usedLine(images, record) {
    const labels = (images || []).map((image) => usedName(image, record)).filter(Boolean);
    if (!labels.length) return '';
    return `Used: ${labels.join(', ')}`;
}

function ordinal(index) {
    return ['first', 'second', 'third', 'fourth'][index] || `image ${index + 1}`;
}

export function referenceUseNote(images, record) {
    const list = images || [];
    if (!list.length) return '';
    const faceAt = list.findIndex((image) => isIdentityPhoto(image, record));
    const extras = list
        .map((image, index) => ({ image, index }))
        .filter(({ image, index }) => index !== faceAt && !isIdentityPhoto(image, record));
    const sentences = [];
    if (extras.length && faceAt >= 0) {
        const parts = extras.map(({ image, index }) => {
            const role = PHOTO_ROLES.find((item) => item.id === imageRole(image));
            return `the ${ordinal(index)} image only for the ${role?.phrase || 'tagged detail'}`;
        });
        sentences.push(`Use ${parts.join(' and ')}. Keep the face from the ${ordinal(faceAt)} image.`);
    } else if (extras.length) {
        const parts = extras.map(({ image, index }) => {
            const role = PHOTO_ROLES.find((item) => item.id === imageRole(image));
            return `the ${ordinal(index)} image only for the ${role?.phrase || 'tagged detail'}`;
        });
        sentences.push(`Use ${parts.join(' and ')}. Do not take the face from these photos.`);
    }
    if (String(record?.mustKeep || '').trim()) sentences.push('Must keep wins over the reference photos.');
    return sentences.join(' ');
}

function withUrl(image) {
    return Boolean(image?.dataUrl || image?.url);
}

function findFace(record, images) {
    const faces = (images || []).filter((image) => withUrl(image) && isIdentityPhoto(image, record) && (
        imageRole(image) === 'face' || image.source === 'avatar' || image.id === record?.primaryId
    ));
    return faces.find((image) => image.source === 'avatar')
        || faces.find((image) => imageRole(image) === 'face' && image.id === record?.primaryId)
        || faces.find((image) => imageRole(image) === 'face')
        || faces.find((image) => image.id === record?.primaryId)
        || faces[0]
        || null;
}

function findRole(images, role, picked, outfitId = '') {
    const fresh = (images || []).filter((image) => withUrl(image) && !picked.includes(image) && imageRole(image) === role);
    if (role === 'outfit' && outfitId) {
        const named = fresh.find((image) => image.outfitId === outfitId);
        if (named) return named;
    }
    return fresh.find((image) => image.source === 'inspiration') || fresh[0] || null;
}

export function selectJobReferences(record, { job = 'expression', medium = '', cap = 4, outfitId = '' } = {}) {
    const empty = { images: [], warning: '', switchTo: '', used: '', useNote: '' };
    if (!record) return empty;
    const roles = JOB_ROLES[job] || JOB_ROLES.expression;
    const candidates = referenceCandidates(record, { medium });
    const all = (record.images || []).filter(withUrl);
    const picked = [];
    for (const role of roles) {
        if (picked.length >= cap) break;
        let choice = null;
        if (role === 'face') choice = findFace(record, candidates.images);
        else if (role === 'main') {
            const primary = all.find((image) => image.id === record.primaryId && isIdentityPhoto(image, record));
            choice = primary || findFace(record, candidates.images);
        } else choice = findRole(all, role, picked, outfitId);
        if (choice && !picked.includes(choice)) picked.push(choice);
    }
    const images = picked.slice(0, cap);
    return {
        images,
        warning: candidates.warning,
        switchTo: candidates.switchTo,
        used: usedLine(images, record),
        useNote: referenceUseNote(images, record),
    };
}

/** Several people share one still. Mains first, then the other roles, still capped. */
export function selectCastReferences(records, { job = 'scene', medium = '', cap = 4 } = {}) {
    const roles = JOB_ROLES[job] || JOB_ROLES.scene;
    const picked = [];
    const warnings = [];
    for (const role of roles) {
        for (const record of records || []) {
            if (picked.length >= cap) break;
            const selection = selectJobReferences(record, { job, medium, cap });
            if (selection.warning) warnings.push(selection.warning);
            const choice = selection.images.find((image) => {
                if (picked.includes(image)) return false;
                if (role === 'face') return isIdentityPhoto(image, record);
                if (role === 'main') return image.id === record.primaryId || image.source === 'avatar' || isIdentityPhoto(image, record);
                return imageRole(image) === role;
            });
            if (choice && !picked.some((image) => image.id && image.id === choice.id)) picked.push(choice);
        }
    }
    const images = picked.slice(0, cap);
    const record = records?.[0];
    return {
        images,
        warning: warnings[0] || '',
        switchTo: '',
        used: usedLine(images, record),
        useNote: referenceUseNote(images, record),
    };
}

export function roleSuggestionRequest() {
    return {
        systemPrompt: [
            'You can see one reference photo for a fictional character.',
            'Reply with JSON only: {"role":"face"|"hair"|"body"|"outfit"|"pose"|"style"}.',
            'face is a portrait. hair is hair. body is a body type. outfit is clothes. pose is a stance. style is a mood or art style.',
            'Pick the single most useful role.',
        ].join(' '),
        prompt: 'What should this photo guide?',
    };
}

export function parseRoleSuggestion(text) {
    const raw = String(text || '').trim().replace(/^```(?:json)?\s*|```$/g, '');
    if (!raw) return '';
    let role = '';
    try {
        role = JSON.parse(raw).role;
    } catch {
        const found = raw.match(/face|hair|body|outfit|pose|style/i);
        role = found ? found[0] : '';
    }
    const id = String(role || '').toLowerCase();
    return PHOTO_ROLES.some((item) => item.id === id) ? id : '';
}

export function roleLookNote(settings) {
    if (settings?.llmSource === 'openrouter' && String(settings.openrouterKey || '').trim()) {
        return 'Suggesting a role uses your OpenRouter text model once.';
    }
    if (settings?.llmSource === 'openai' && String(settings.openaiKey || '').trim()) {
        return 'Suggesting a role uses your OpenAI text model once.';
    }
    return '';
}

export const INSPIRATION_HINT = 'Add photos of a body type, an outfit, or a pose. Thoughtform uses each one only for what you tag it as.';

export const BOARD_BUTTON_TITLE = 'Open Thoughtform board';

export function appendUseNote(prompt, note) {
    const text = String(prompt || '').trim();
    const extra = String(note || '').trim();
    if (!extra) return text;
    if (text.includes(extra)) return text;
    return `${text}\n${extra}`.trim();
}

export function mergeUsedLines(lines) {
    const labels = [];
    for (const line of lines || []) {
        const body = String(line || '').replace(/^Used:\s*/i, '');
        for (const part of body.split(',').map((item) => item.trim()).filter(Boolean)) {
            if (!labels.includes(part)) labels.push(part);
        }
    }
    return labels.length ? `Used: ${labels.join(', ')}` : '';
}

/** /board with no name opens the character in the current chat. */
export function boardCommandTarget(value, currentName = '') {
    const name = String(value || '').trim();
    return name || String(currentName || '').trim();
}
