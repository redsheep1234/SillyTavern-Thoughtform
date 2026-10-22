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

export async function describeAvatar(record, { image, complete } = {}) {
    if (!record || !image || String(record.appearance || '').trim()) return null;
    const token = record.avatar || record.primaryId || 'avatar';
    if (record.lookFor === token) return null;
    const request = avatarLookRequest(record.name);
    const text = await complete(request);
    const look = parseAvatarLook(text);
    if (!look?.appearance && !look?.medium) return null;
    applyAvatarLook(record, look);
    record.lookFor = token;
    return look;
}
