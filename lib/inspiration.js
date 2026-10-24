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

const ROLE_FROM_NAME = [
    { role: 'body', pattern: /turn[-_\s]?around|character[-_\s]?sheet|full[-_\s]?body|fullbody/i },
    { role: 'pose', pattern: /\bpose\b/i },
    { role: 'outfit', pattern: /outfit|wardrobe|\bdress\b|clothes/i },
    { role: 'hair', pattern: /\bhair\b/i },
    { role: 'face', pattern: /\bface\b|portrait|headshot|close[-_\s]?up/i },
    { role: 'style', pattern: /\bstyle\b|\bvibe\b/i },
];

/** Guess a role from a file name. A bare "Upload" label stays empty. */
export function uploadRoleFromName(name) {
    const text = String(name || '').trim();
    if (!text || /^upload(?:\.[a-z0-9]+)?$/i.test(text)) return '';
    const found = ROLE_FROM_NAME.find((item) => item.pattern.test(text));
    return found?.role || '';
}

export function tagsForUploadRole(role) {
    if (role === 'face') return ['face'];
    if (role === 'hair') return [];
    if (role === 'body') return ['full body'];
    if (role === 'pose') return ['pose'];
    if (role === 'outfit') return ['outfit'];
    if (role === 'style') return ['style'];
    return [];
}

function isWideSheet(image) {
    const ratio = String(image?.aspectRatio || '');
    if (ratio === '16:9' || ratio === '4:3' || ratio === '3:2') return true;
    const width = Number(image?.width || 0);
    const height = Number(image?.height || 0);
    return width >= 320 && height > 0 && width >= height * 1.15;
}

/** An upload the user never tagged. The old adder stored these as a face named Upload. */
function isBareUpload(image) {
    if (image?.source !== 'upload') return false;
    if (PHOTO_ROLES.some((role) => role.id === image?.role)) return false;
    if (image?.identity === true) return false;
    const tags = (image?.tags || []).filter((tag) => tag && tag !== 'face');
    if (tags.length) return false;
    const named = uploadRoleFromName(`${image?.label || ''} ${image?.file || ''}`);
    if (named && named !== 'face') return false;
    const label = String(image?.label || '').trim();
    return !label || /^upload(?:\.[a-z0-9]+)?$/i.test(label);
}

/** Turnaround and full-body sheets are not expression faces. */
function isExpressionSheet(image) {
    if (!image || image.source === 'avatar' || image.source === 'inspiration') return false;
    const tags = image.tags || [];
    if (tags.includes('turnaround') || tags.includes('full body')) return true;
    if (tags.includes('pose') && image.source === 'upload') return true;
    if (isBareUpload(image)) return true;
    const guessed = uploadRoleFromName(`${image.label || ''} ${image.file || ''}`);
    if (guessed === 'body' || guessed === 'pose' || guessed === 'outfit') return true;
    if (image.source === 'upload' && isWideSheet(image) && !tags.includes('expression') && !tags.includes('closeup')) return true;
    return false;
}

const BODY_SAMPLE_TAGS = ['turnaround', 'pose', 'expression', 'outfit', 'closeup'];

/** A photo the user marked as a body type. Generated turnarounds and wardrobe shots are not samples. */
export function isBodySample(image) {
    if (!image || !(image.dataUrl || image.url)) return false;
    if (image.role === 'body') return true;
    const tags = image.tags || [];
    if (tags.some((tag) => BODY_SAMPLE_TAGS.includes(tag))) return false;
    if (image.frame === 'wide') return false;
    return imageRole(image) === 'body';
}

export function bodySampleImages(record) {
    return (record?.images || []).filter((image) => isBodySample(image));
}

/** The one body photo chosen for the suite. Empty when none is set, so callers keep the old pick. */
export function bodyReferenceImage(record, images) {
    const id = String(record?.bodyRefId || '').trim();
    if (!id) return null;
    const pool = images || record?.images || [];
    const image = pool.find((item) => item.id === id);
    return isBodySample(image) ? image : null;
}

export function assignBodyReference(record, imageId) {
    if (!record) return '';
    const id = String(imageId || '').trim();
    if (!id) {
        record.bodyRefId = '';
        return '';
    }
    const image = (record.images || []).find((item) => item.id === id);
    if (!isBodySample(image)) return String(record.bodyRefId || '');
    record.bodyRefId = image.id;
    return image.id;
}

export function imageRole(image) {
    if (PHOTO_ROLES.some((role) => role.id === image?.role)) return image.role;
    if (image?.source === 'avatar') return 'face';
    const tags = image?.tags || [];
    if (tags.includes('outfit')) return 'outfit';
    if (tags.includes('pose') || tags.includes('turnaround')) return 'pose';
    if (tags.includes('full body')) return 'body';
    if (tags.includes('expression') || tags.includes('closeup')) return 'face';
    const guessed = uploadRoleFromName(`${image?.label || ''} ${image?.file || ''}`);
    if (guessed === 'body' || guessed === 'pose' || guessed === 'outfit' || guessed === 'hair' || guessed === 'style') return guessed;
    if (isBareUpload(image) || (image?.source === 'upload' && isWideSheet(image))) return 'body';
    if (tags.includes('face') || guessed === 'face') return 'face';
    return '';
}

/** Identity defaults on for the avatar and the character's own stills. Inspiration stays off. */
export function isIdentityPhoto(image, record) {
    if (!image) return false;
    if (image.identity === true) return true;
    if (image.identity === false) return false;
    if (image.source === 'inspiration') return false;
    if (isExpressionSheet(image)) return false;
    if (image.source === 'avatar') return true;
    if (record?.primaryId && image.id === record.primaryId) return true;
    const tags = image.tags || [];
    return tags.includes('expression') || tags.includes('closeup') || (tags.includes('face') && !isBareUpload(image));
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

function findFace(record, images, { leadWithPrimary = false } = {}) {
    const faces = (images || []).filter((image) => withUrl(image) && image.identity !== false && !isExpressionSheet(image) && (
        image.source === 'avatar'
        || image.id === record?.primaryId
        || (isIdentityPhoto(image, record) && imageRole(image) === 'face')
    ));
    if (leadWithPrimary) {
        const primary = faces.find((image) => image.id === record?.primaryId);
        if (primary) return primary;
        const avatar = faces.find((image) => image.source === 'avatar');
        if (avatar) return avatar;
    }
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

function isBodyReference(image) {
    const tags = image?.tags || [];
    if (tags.some((tag) => tag === 'turnaround' || tag === 'full body' || tag === 'pose' || tag === 'outfit')) return true;
    if (image?.frame === 'wide') return true;
    const role = imageRole(image);
    return role === 'body' || role === 'pose' || role === 'outfit';
}

function isApprovedPortrait(image) {
    if (!withUrl(image) || isBodyReference(image)) return false;
    if (image.review === 'unreviewed') return false;
    const tags = image.tags || [];
    const portrait = image.portrait === true || image.cropOf || tags.includes('expression') || tags.includes('closeup');
    if (!portrait) return false;
    return image.review === 'approved' || image.approved === true || (image.source === 'generated' && image.review !== 'unreviewed');
}

/** Main picture, then at most two approved portraits. Full-body sheets stay out. */
export function expressionReferenceImages(record, images, cap = 4) {
    const all = (images || []).filter(withUrl);
    const limit = Math.min(Math.max(cap, 1), 3);
    const picked = [];
    const primary = all.find((image) => image.id === record?.primaryId) || all.find((image) => image.source === 'avatar');
    let lead = (primary && !isBodyReference(primary))
        ? primary
        : (all.find((image) => image.source === 'avatar' && !isBodyReference(image)) || primary);
    if (!lead) {
        lead = all.find((image) => image.identity === true && !isBodyReference(image) && imageRole(image) === 'face') || null;
    }
    if (lead) picked.push(lead);
    const covered = new Set(picked.map((image) => image.id));
    const replaced = new Set(all.map((image) => image.cropOf).filter(Boolean));
    const portraits = all.filter((image) => isApprovedPortrait(image) && !covered.has(image.id) && !replaced.has(image.id));
    portraits.sort((left, right) => Number(Boolean(right.portrait || right.cropOf)) - Number(Boolean(left.portrait || left.cropOf)));
    for (const image of portraits) {
        if (picked.length >= limit) break;
        picked.push(image);
    }
    return picked.slice(0, limit);
}

export function selectJobReferences(record, { job = 'expression', medium = '', cap = 4, outfitId = '', lockOutfit = false } = {}) {
    const empty = { images: [], warning: '', switchTo: '', used: '', useNote: '' };
    if (!record) return empty;
    const candidates = referenceCandidates(record, { medium });
    const all = (record.images || []).filter(withUrl);
    if (job === 'expression' || job === 'closeup') {
        const images = expressionReferenceImages(record, all, cap);
        let note = referenceUseNote(images, record);
        if (lockOutfit && images.length) {
            note = [note, 'Keep the clothes from the main picture. The outfit reads at the neckline and shoulders. Do not change clothing.'].filter(Boolean).join(' ');
        }
        return {
            images,
            warning: candidates.warning,
            switchTo: candidates.switchTo,
            used: usedLine(images, record),
            useNote: note,
        };
    }
    const bodyJob = job === 'turnaround' || job === 'pose' || job === 'body' || job === 'outfit';
    const chosenBody = bodyJob ? bodyReferenceImage(record, all) : null;
    const suiteBody = lockOutfit && (job === 'turnaround' || job === 'pose');
    let roles = [...(JOB_ROLES[job] || JOB_ROLES.expression)];
    if (suiteBody) roles = ['face'];
    if (chosenBody) roles = roles.filter((role) => role !== 'body');
    const picked = [];
    for (const role of roles) {
        if (picked.length >= cap) break;
        let choice = null;
        if (role === 'face') choice = findFace(record, all, { leadWithPrimary: true });
        else if (role === 'main') {
            const primary = all.find((image) => image.id === record.primaryId && isIdentityPhoto(image, record));
            choice = primary || findFace(record, candidates.images);
        } else choice = findRole(all, role, picked, outfitId);
        if (choice && !picked.includes(choice)) picked.push(choice);
    }
    if (suiteBody) {
        const primary = all.find((image) => image.id === record.primaryId) || all.find((image) => image.source === 'avatar');
        if (primary && !picked.includes(primary)) picked.unshift(primary);
        if (outfitId) {
            const named = all.find((image) => image.outfitId === outfitId && !picked.includes(image));
            if (named && picked.length < cap) picked.push(named);
        }
    }
    if (chosenBody && !picked.includes(chosenBody)) {
        const lead = picked.findIndex((image) => image.id === record.primaryId || image.source === 'avatar');
        picked.splice(lead >= 0 ? lead + 1 : Math.min(picked.length, 1), 0, chosenBody);
    }
    const images = picked.slice(0, cap);
    let note = referenceUseNote(images, record);
    if (chosenBody && images.includes(chosenBody) && images[0] !== chosenBody) {
        note = [note, 'The body photo is only for proportions. Do not take the face or the clothes from it.'].filter(Boolean).join(' ');
    }
    if (suiteBody && images.length) {
        const outfitHit = outfitId && images.some((image) => image.outfitId === outfitId);
        const extra = outfitHit
            ? 'Use the outfit photo only for the clothes. Do not change clothing.'
            : 'Keep the clothes from the main picture. Do not change clothing.';
        note = [note, extra].filter(Boolean).join(' ');
    }
    return {
        images,
        warning: candidates.warning,
        switchTo: candidates.switchTo,
        used: usedLine(images, record),
        useNote: note,
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
