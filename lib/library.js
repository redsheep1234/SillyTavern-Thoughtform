import { imageBelongsTo } from './variants.js';
import { clipText } from './util.js';

/** Tags the reference board understands. Outfit and expression tags are added by the generators. */
export const IMAGE_TAGS = ['face', 'full body', 'outfit', 'style', 'expression', 'turnaround', 'pose', 'closeup'];

let sequence = 0;

export function newId(prefix = 'id') {
    sequence += 1;
    const random = Math.random().toString(36).slice(2, 8);
    return `${prefix}-${Date.now().toString(36)}-${sequence}-${random}`;
}

export function ensureLibrary(settings) {
    if (!settings.library || typeof settings.library !== 'object' || Array.isArray(settings.library)) {
        settings.library = { records: {}, links: {} };
    }
    if (!settings.library.records || typeof settings.library.records !== 'object') settings.library.records = {};
    if (!settings.library.links || typeof settings.library.links !== 'object') settings.library.links = {};
    return settings.library;
}

export function characterRecordKey(character) {
    const avatar = String(character?.avatar || '').trim();
    const name = String(character?.name || 'Character').trim() || 'Character';
    return `character:${avatar || name}`;
}

export function personaRecordKey(persona) {
    const id = String(persona?.id || persona?.avatar || persona?.name || 'user').trim() || 'user';
    return `persona:${id}`;
}

export function emptyRecord({ key, name, kind, stName, avatar, personaId }) {
    return {
        key,
        name: name || 'Character',
        kind: kind || 'character',
        stName: stName || name || 'Character',
        avatar: avatar || '',
        personaId: personaId || '',
        appearance: '',
        primaryId: '',
        defaultOutfitId: '',
        images: [],
        outfits: [],
        loraName: '',
        loraStrength: 0.8,
    };
}

export function thumbnailUrl(kind, file) {
    const name = String(file || '').trim();
    if (!name) return '';
    if (name.startsWith('data:') || name.startsWith('http') || name.startsWith('/')) return name;
    const type = kind === 'persona' ? 'persona' : 'avatar';
    return `/thumbnail?type=${type}&file=${encodeURIComponent(name)}`;
}

function rememberAvatar(record, kind, avatar) {
    if (!avatar) return false;
    if (record.images.some((image) => image.source === 'avatar' && image.avatar === avatar)) return false;
    const image = {
        id: newId('img'),
        dataUrl: '',
        url: thumbnailUrl(kind, avatar),
        tags: ['face'],
        label: 'Avatar',
        source: 'avatar',
        avatar,
        outfitId: '',
        prompt: '',
        stLabel: '',
    };
    record.images.unshift(image);
    if (!record.primaryId) record.primaryId = image.id;
    return true;
}

/**
 * Create missing boards for characters and personas. Uploads, outfits, and links stay put.
 * Persona descriptions seed only that persona's own board, never a board it is linked to.
 */
export function syncLibrary(library, { characters = [], personas = [] } = {}) {
    let changed = false;
    for (const character of characters) {
        if (!character?.name) continue;
        const key = characterRecordKey(character);
        let record = library.records[key];
        if (!record) {
            record = emptyRecord({
                key,
                name: character.name,
                kind: 'character',
                stName: character.name,
                avatar: character.avatar || '',
            });
            record.appearance = clipText(character.description || '', 1200);
            library.records[key] = record;
            changed = true;
        } else if (!record.appearance && character.description) {
            record.appearance = clipText(character.description, 1200);
            changed = true;
        }
        if (rememberAvatar(record, 'character', character.avatar || '')) changed = true;
    }
    for (const persona of personas) {
        if (!persona?.id && !persona?.name) continue;
        const key = personaRecordKey(persona);
        let record = library.records[key];
        if (!record) {
            record = emptyRecord({
                key,
                name: persona.name || 'User',
                kind: 'persona',
                stName: persona.name || 'User',
                avatar: persona.avatar || '',
                personaId: persona.id || '',
            });
            record.appearance = clipText(persona.description || '', 1200);
            library.records[key] = record;
            changed = true;
        } else {
            if (persona.name) record.name = persona.name;
            record.personaId = persona.id || record.personaId;
            if (!record.appearance && persona.description) {
                record.appearance = clipText(persona.description, 1200);
                changed = true;
            }
        }
        if (rememberAvatar(record, 'persona', persona.avatar || '')) changed = true;
    }
    return changed;
}

export function createBoard(library, name) {
    const record = emptyRecord({
        key: `board:${newId('board')}`,
        name: String(name || 'Shared board').trim() || 'Shared board',
        kind: 'board',
        stName: name || 'Shared board',
    });
    library.records[record.key] = record;
    return record;
}

export function linkPersonaBoard(library, personaId, boardKey) {
    const own = `persona:${personaId}`;
    if (!personaId) return;
    if (!boardKey || boardKey === own) delete library.links[personaId];
    else library.links[personaId] = boardKey;
}

export function resolvePersonaBoard(library, persona) {
    if (!persona) return null;
    const ownKey = personaRecordKey(persona);
    const linked = library.links?.[persona.id];
    return library.records[linked] || library.records[ownKey] || null;
}

export function addImage(record, image) {
    const saved = {
        id: image.id || newId('img'),
        dataUrl: image.dataUrl || '',
        url: image.url || '',
        tags: [...new Set((image.tags || []).filter(Boolean))],
        label: image.label || '',
        source: image.source || 'upload',
        avatar: image.avatar || '',
        outfitId: image.outfitId || '',
        prompt: image.prompt || '',
        stLabel: image.stLabel || '',
        medium: image.medium || '',
        cacheKey: image.cacheKey || '',
    };
    record.images.push(saved);
    if (!record.primaryId) record.primaryId = saved.id;
    return saved;
}

export function removeImage(record, imageId) {
    record.images = record.images.filter((image) => image.id !== imageId);
    if (record.primaryId === imageId) record.primaryId = record.images[0]?.id || '';
}

export function imagesForPrompt(record, { outfitId = '', cap = 4, medium = '' } = {}) {
    if (!record) return [];
    let usable = (record.images || []).filter((image) => image.dataUrl || image.url);
    const styled = record.kind === 'character' || record.kind === 'persona' || record.kind === 'board';
    if (styled && (medium === 'anime' || medium === 'live-action')) {
        usable = usable.filter((image) => imageBelongsTo(image, medium, record.sourceMedium));
    }
    const outfitImages = outfitId ? usable.filter((image) => image.outfitId === outfitId) : [];
    const pool = outfitImages.length ? outfitImages : usable.filter((image) => !image.outfitId);
    const source = pool.length ? pool : usable;
    const preferred = (medium && record.variantPrimary?.[medium]) || record.primaryId;
    const primary = source.find((image) => image.id === preferred) || usable.find((image) => image.id === preferred);
    const face = source.find((image) => image.tags?.includes('face'));
    const body = source.find((image) => image.tags?.includes('full body') || image.tags?.includes('turnaround'));
    const picked = [];
    for (const image of [primary, face, body, ...source]) {
        if (!image || picked.some((item) => item.id === image.id)) continue;
        picked.push(image);
        if (picked.length >= cap) break;
    }
    return picked;
}

export async function materializeImage(image, fetchImpl = globalThis.fetch) {
    if (!image) return '';
    if (image.dataUrl) return image.dataUrl;
    const url = image.url || '';
    if (!url) return '';
    if (url.startsWith('data:')) return url;
    if (typeof fetchImpl !== 'function') return '';
    try {
        const response = await fetchImpl(url);
        if (!response.ok) return '';
        const blob = await response.blob();
        return await blobToDataUrl(blob);
    } catch {
        return '';
    }
}

export function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Could not read the image.'));
        reader.readAsDataURL(blob);
    });
}

export function recordWeight(record) {
    try {
        return JSON.stringify(record).length;
    } catch {
        return 0;
    }
}

export function namesMatch(left, right) {
    const a = String(left || '').trim().toLowerCase();
    const b = String(right || '').trim().toLowerCase();
    if (!a || !b) return false;
    if (a === b) return true;
    const short = a.length < b.length ? a : b;
    const long = a.length < b.length ? b : a;
    return short.length >= 4 && (long.startsWith(`${short} `) || long.startsWith(short));
}

/** Exact name wins. A prefix match is used only when one record would claim it. */
export function matchRecord(records, name, kind) {
    const pool = (records || []).filter((record) => !kind || record.kind === kind);
    const target = String(name || '').trim().toLowerCase();
    if (!target) return null;
    const exact = pool.find((record) => String(record.name || '').trim().toLowerCase() === target);
    if (exact) return exact;
    const fuzzy = pool.filter((record) => namesMatch(record.name, name));
    return fuzzy.length === 1 ? fuzzy[0] : null;
}
