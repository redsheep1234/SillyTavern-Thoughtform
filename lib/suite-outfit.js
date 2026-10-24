/** One costume for a character's expressions and turnaround. Poses may vary. */

export const OUTFIT_DEFAULTS = Object.freeze({
    woman: 'plain fitted athletic wear, modest, non-revealing: a heather-grey fitted singlet and athletic shorts to mid-thigh, and sneakers',
    man: 'plain fitted athletic wear, modest, non-revealing: a charcoal fitted singlet and athletic shorts, and sneakers',
    neutral: 'plain fitted athletic wear, modest, non-revealing: a heather-grey fitted plain t-shirt and athletic shorts, and sneakers',
    fantasy: 'a fitted tunic and leggings in a plain solid colour, modest and non-revealing, with simple shoes',
    scifi: 'a fitted plain bodysuit in a solid colour, modest and non-revealing',
});

const GARMENT = /\b(wear(?:ing|s)?|dressed|outfit|clothes|clothing|coat|raincoat|jacket|shirt|blouse|dress|skirt|trousers|pants|jeans|shorts|shoes|boots|sneakers|hoodie|sweater|singlet|tank|uniform|hat|scarf|gloves|bikini|sarong|gown|cloak|robe|apron|cape|vest|tunic|kimono|armor|armour|tie|belt|jumpsuit|bodysuit|leggings)\b/i;
const UNDRESSED = /\b(nude|naked|undressed|no clothes|without clothes|shirtless|topless|nothing on|wearing nothing)\b/i;

const WOMAN = /\b(she|her|hers|herself|woman|women|girl|lady|female)\b/i;
const MAN = /\b(he|him|his|himself|man|men|boy|gentleman|male)\b/i;
const THEY = /\b(they|them|their|theirs|themself|themselves|non-?binary)\b/i;

const FANTASY_STRONG = /\b(fantasy|medieval|sword|sorcery|wizard|kingdom)\b/gi;
const FANTASY_WEAK = /\b(magic|knight|castle|dragon|elves|elf|witch)\b/gi;
const SCIFI_STRONG = /\b(sci-?fi|science fiction|cyberpunk|futuristic|spaceship|starship)\b/gi;
const SCIFI_WEAK = /\b(android|space station)\b/gi;

export function outfitDefaults(settings) {
    const stored = settings?.suiteOutfitDefaults || {};
    const next = {};
    for (const [key, fallback] of Object.entries(OUTFIT_DEFAULTS)) {
        const text = String(stored[key] || '').trim();
        next[key] = text || fallback;
    }
    return next;
}

/** Clothing phrases from a card. Nude or empty descriptions count as no clothes. */
export function clothesFromAppearance(appearance) {
    const text = String(appearance || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const parts = text.split(/[.\n;]|,(?=\s)|\band\b/i).map((part) => part.trim()).filter(Boolean);
    const clothes = parts.filter((part) => GARMENT.test(part) && !UNDRESSED.test(part));
    return clothes.join(', ').slice(0, 800);
}

function count(pattern, text) {
    pattern.lastIndex = 0;
    return text.match(pattern)?.length || 0;
}

/** woman, man, or neutral. The name is never read. */
export function resolvePresentation(record, extraText = '') {
    const field = normalizeGender(record?.gender || record?.sex || '');
    const text = [record?.pronouns, record?.appearance, record?.personality, record?.description, record?.scenario, extraText]
        .filter(Boolean)
        .join('\n');
    const fromWords = presentationFromWords(text);
    if (field && fromWords && field !== fromWords) return 'neutral';
    return field || fromWords || '';
}

function normalizeGender(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return '';
    if (/^(woman|female|girl|f|she|her)$/.test(text)) return 'woman';
    if (/^(man|male|boy|m|he|him)$/.test(text)) return 'man';
    if (/^(neutral|non-?binary|they|them|nb|other|person)$/.test(text)) return 'neutral';
    return '';
}

function presentationFromWords(text) {
    const woman = WOMAN.test(text);
    const man = MAN.test(text);
    const they = THEY.test(text);
    const hits = [woman, man, they].filter(Boolean).length;
    if (hits > 1) return 'neutral';
    if (!hits) return '';
    if (woman) return 'woman';
    if (man) return 'man';
    return 'neutral';
}

/** contemporary, fantasy, or scifi. One weak hint is not enough. */
export function resolveSetting(record, extraText = '') {
    const text = [record?.appearance, record?.personality, record?.description, record?.scenario, extraText].filter(Boolean).join('\n');
    const fantasy = count(FANTASY_STRONG, text) + (count(FANTASY_WEAK, text) >= 2 ? 1 : 0);
    const scifi = count(SCIFI_STRONG, text) + (count(SCIFI_WEAK, text) >= 2 ? 1 : 0);
    if (fantasy && fantasy > scifi) return 'fantasy';
    if (scifi && scifi > fantasy) return 'scifi';
    return 'contemporary';
}

export function defaultOutfitFor(record, settings, extraText = '') {
    const setting = resolveSetting(record, extraText);
    const defaults = outfitDefaults(settings);
    if (setting === 'fantasy') return { key: 'fantasy', text: defaults.fantasy, setting };
    if (setting === 'scifi') return { key: 'scifi', text: defaults.scifi, setting };
    const detected = resolvePresentation(record, extraText);
    const presentation = detected || record?.presentation || 'neutral';
    const key = presentation === 'woman' || presentation === 'man' ? presentation : 'neutral';
    return { key, text: defaults[key], setting: 'contemporary', presentation: key };
}

export function shortOutfit(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    const cut = clean.split(/[.]/)[0].trim();
    return cut.length > 72 ? `${cut.slice(0, 69).trim()}…` : cut;
}

export function suiteOutfitLabel(record) {
    if (record?.suiteOutfitFrom === 'default' || !String(record?.suiteOutfit || '').trim()) {
        return 'default (none found in picture)';
    }
    return shortOutfit(record.suiteOutfit);
}

export function outfitTextFor(record, settings) {
    const stored = String(record?.suiteOutfit || '').trim();
    if (stored) return stored;
    const card = clothesFromAppearance(record?.appearance);
    if (card) return card;
    return defaultOutfitFor(record, settings).text;
}

/** Always names clothes. A locked suite repeats one costume. Vary outfit may change it. */
export function clothingClause(text, { lock = true } = {}) {
    if (!lock) return 'Fully clothed, modest and non-revealing. The outfit may vary. Do not undress the character.';
    const outfit = String(text || '').trim() || OUTFIT_DEFAULTS.neutral;
    return `Fully clothed, wearing exactly: ${outfit}, same outfit in every image. Do not change clothing.`;
}

export function seedSuiteOutfit(record, settings, extraText = '') {
    if (!record) return false;
    const presented = resolvePresentation(record, extraText);
    if (presented) record.presentation = presented;
    else if (!record.presentation) record.presentation = 'neutral';
    if (record.suiteOutfitFrom === 'manual' || record.suiteOutfitFrom === 'wardrobe') {
        record.suiteOutfitSeeded = true;
        return false;
    }
    if (record.suiteOutfitFrom === 'vision' && String(record.suiteOutfit || '').trim()) {
        record.suiteOutfitSeeded = true;
        return false;
    }
    const clothes = clothesFromAppearance(record.appearance);
    if (clothes) {
        const same = record.suiteOutfitFrom === 'card' && record.suiteOutfit === clothes && record.suiteOutfitSeeded;
        record.suiteOutfit = clothes;
        record.suiteOutfitFrom = 'card';
        record.suiteOutfitId = '';
        record.suiteOutfitSeeded = true;
        return !same;
    }
    const choice = defaultOutfitFor(record, settings, extraText);
    const same = record.suiteOutfitFrom === 'default' && record.suiteOutfit === choice.text && record.suiteOutfitSeeded;
    record.suiteOutfit = choice.text;
    record.suiteOutfitFrom = 'default';
    record.suiteOutfitKey = choice.key;
    record.suiteOutfitId = '';
    record.suiteOutfitSeeded = true;
    return !same;
}

export function editSuiteOutfit(record, text, settings) {
    const clean = String(text || '').trim().slice(0, 800);
    if (!clean) {
        record.suiteOutfit = '';
        record.suiteOutfitFrom = '';
        record.suiteOutfitSeeded = false;
        record.suiteOutfitId = '';
        seedSuiteOutfit(record, settings);
        return;
    }
    record.suiteOutfit = clean;
    record.suiteOutfitFrom = 'manual';
    record.suiteOutfitSeeded = true;
    record.suiteOutfitId = '';
}

export function assignWardrobeOutfit(record, outfit) {
    if (!record || !outfit) return;
    record.suiteOutfitId = outfit.id;
    record.suiteOutfit = String(outfit.description || outfit.name || '').trim().slice(0, 800);
    record.suiteOutfitFrom = 'wardrobe';
    record.suiteOutfitSeeded = true;
}

export function useMainPictureOutfit(record, settings) {
    if (!record) return;
    record.suiteOutfitId = '';
    record.suiteOutfit = '';
    record.suiteOutfitFrom = '';
    record.suiteOutfitSeeded = false;
    seedSuiteOutfit(record, settings);
}

export function outfitLookRequest(name) {
    return {
        systemPrompt: [
            'You can see one picture of a fictional character.',
            'Reply with JSON only: {"outfit":"..."}.',
            'outfit lists the garments, colours, materials, and accessories you can see, in one or two sentences.',
            'If you cannot see clear clothing, the crop is head-only, or the figure is undressed, use an empty string.',
            'Do not describe the face, hair, or body. Never say nude, naked, or undressed.',
        ].join(' '),
        prompt: `What clothing is ${name || 'this person'} wearing?`,
    };
}

export function parseOutfitLook(text) {
    const raw = String(text || '').trim().replace(/^```(?:json)?\s*|```$/g, '');
    if (!raw) return '';
    let outfit = '';
    try {
        const data = JSON.parse(raw);
        outfit = String(data?.outfit || '').trim();
    } catch {
        if (raw.startsWith('{')) return '';
        outfit = raw;
    }
    if (!outfit || /^(none|n\/a|no clothing|not visible|head only|unclear)$/i.test(outfit)) return '';
    if (UNDRESSED.test(outfit)) return '';
    return clothesFromAppearance(outfit);
}

export async function describeSuiteOutfit(record, { complete, settings } = {}) {
    if (!record || record.suiteOutfitVision) return null;
    if (record.suiteOutfitFrom === 'manual' || record.suiteOutfitFrom === 'wardrobe') {
        record.suiteOutfitVision = true;
        return null;
    }
    record.suiteOutfitVision = true;
    let outfit = '';
    try {
        const request = outfitLookRequest(record.name);
        outfit = parseOutfitLook(await complete(request));
    } catch {
        outfit = '';
    }
    if (outfit) {
        record.suiteOutfit = outfit;
        record.suiteOutfitFrom = 'vision';
        record.suiteOutfitSeeded = true;
        return outfit;
    }
    if (record.suiteOutfitFrom === 'card' && clothesFromAppearance(record.suiteOutfit)) return null;
    const choice = defaultOutfitFor(record, settings);
    record.suiteOutfit = choice.text;
    record.suiteOutfitFrom = 'default';
    record.suiteOutfitKey = choice.key;
    record.suiteOutfitSeeded = true;
    return null;
}

export function locksOutfit(record, tags = [], { wrongOutfit = false } = {}) {
    if (wrongOutfit) return true;
    const list = tags || [];
    if (list.includes('outfit') && !list.includes('expression') && !list.includes('turnaround') && !list.includes('pose')) return false;
    if (record?.varyOutfit === true) return false;
    return list.includes('expression') || list.includes('turnaround') || list.includes('pose') || list.includes('closeup') || list.length === 0;
}
