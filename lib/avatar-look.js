/** One cheap look at the avatar so a new card is not filmed with an empty face. */

export function avatarLookRequest(name) {
    return {
        systemPrompt: [
            'You can see one portrait of a fictional character.',
            'Reply with JSON only: {"medium":"live-action"|"anime","appearance":"...","mustKeep":"..."}.',
            'appearance is one or two sentences and includes hair colour, hair length, eye colour, and the face.',
            'mustKeep is a short comma-separated list of those same traits.',
            'medium is live-action for a photograph and anime for a drawing.',
            'If no portrait is visible, use empty strings.',
        ].join(' '),
        prompt: `Describe ${name || 'this person'}.`,
    };
}

export function parseAvatarLook(text) {
    const raw = String(text || '').trim().replace(/^```(?:json)?\s*|```$/g, '');
    if (!raw) return null;
    let data = null;
    try {
        data = JSON.parse(raw);
    } catch {
        data = null;
    }
    if (!data || typeof data !== 'object') {
        if (raw.startsWith('{') || raw.startsWith('[')) return null;
        return { medium: '', appearance: raw.slice(0, 1200), mustKeep: '' };
    }
    const medium = data.medium === 'anime' || data.medium === 'live-action' ? data.medium : '';
    const appearance = String(data.appearance || '').trim().slice(0, 1200);
    const mustKeep = String(data.mustKeep || '').trim().slice(0, 240);
    if (!appearance && !mustKeep && !medium) return null;
    return { medium, appearance, mustKeep };
}

const TRAIT_PATTERNS = [
    /\b(?:short|long|chin-length|shoulder-length|cropped)\s+(?:silver|platinum|blonde|blond|brown|black|red|white|grey|gray|auburn|dark|light|teal|copper|indigo|olive)\s+(?:bob|bangs|ponytail|braid|braids|bun|fringe|hair)\b/gi,
    /\b(?:silver|platinum|blonde|blond|brown|black|red|white|grey|gray|auburn|teal|copper)\s+(?:bob|bangs|ponytail|braid|braids|bun|fringe|hair)\b/gi,
    /\b(?:amber|green|blue|brown|grey|gray|hazel|gold|golden|violet|red)\s+eyes\b/gi,
    /\b(?:dark|light|black|white|green|blue|red|brown|grey|gray|silver|emerald|coral|indigo|olive|teal|copper)(?:\s+(?:dark|light|black|white|green|blue|red|brown|grey|gray|silver|emerald|coral|indigo|olive|teal))?\s+(?:raincoat|coat|jacket|dress|cloak|robe|scarf|hoodie|uniform|shirt|gown|bikini|sarong)\b/gi,
];

function addTrait(found, value) {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const lower = clean.toLowerCase();
    if (found.some((item) => item.toLowerCase().includes(lower))) return;
    for (let index = found.length - 1; index >= 0; index -= 1) {
        if (lower.includes(found[index].toLowerCase())) found.splice(index, 1);
    }
    found.push(clean);
}

/** Short visual traits from a card description. Biography sentences stay out. */
export function traitsFromAppearance(appearance) {
    const text = String(appearance || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const found = [];
    for (const pattern of TRAIT_PATTERNS) {
        pattern.lastIndex = 0;
        for (const match of text.matchAll(pattern)) addTrait(found, match[0]);
    }
    return found.slice(0, 6).join(', ').slice(0, 240);
}

/** Fill empty Must keep / May change once. A cleared field stays cleared. */
export function seedLookFields(record) {
    if (!record || record.lookSeeded) return false;
    const appearance = String(record.appearance || '').trim();
    if (!appearance) return false;
    if (!String(record.mustKeep || '').trim()) {
        const traits = traitsFromAppearance(appearance);
        if (traits) record.mustKeep = traits;
    }
    if (!String(record.mayChange || '').trim()) record.mayChange = 'outfit, pose';
    record.lookSeeded = true;
    return true;
}

export function applyAvatarLook(record, look) {
    if (!record || !look) return false;
    let changed = false;
    if (!String(record.appearance || '').trim() && look.appearance) {
        record.appearance = look.appearance;
        changed = true;
    }
    if (!String(record.mustKeep || '').trim() && look.mustKeep) {
        record.mustKeep = look.mustKeep;
        changed = true;
    }
    if (look.medium === 'anime' || look.medium === 'live-action') {
        if (!record.inferredMedium) {
            record.inferredMedium = look.medium;
            changed = true;
        }
        if (!record.sourceMedium) {
            record.sourceMedium = look.medium;
            changed = true;
        }
        for (const image of record.images || []) {
            if (!image.medium && (image.source === 'avatar' || image.id === record.primaryId)) {
                image.medium = look.medium;
                changed = true;
            }
        }
    }
    return changed;
}

export async function describeAvatar(record, { image, complete, force = false } = {}) {
    if (!record || !image) return null;
    if (!force && String(record.appearance || '').trim()) return null;
    const token = record.avatar || record.primaryId || 'avatar';
    if (!force && record.lookFor === token) return null;
    const request = avatarLookRequest(record.name);
    const text = await complete(request);
    const look = parseAvatarLook(text);
    if (!look?.appearance && !look?.medium && !look?.mustKeep) return null;
    applyAvatarLook(record, look);
    if (force && look?.mustKeep) record.mustKeep = look.mustKeep;
    if (!String(record.mayChange || '').trim()) record.mayChange = 'outfit, pose';
    record.lookFor = token;
    record.lookSeeded = true;
    return look;
}
