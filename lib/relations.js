import { emptyRecord, newId } from './library.js';
import { clothingClause, outfitTextFor } from './suite-outfit.js';

export const RELATIONS = [
    {
        id: 'parent',
        label: 'Parent',
        line: (name) => `Older parent of ${name}. Visibly older, about 50s. Share eye shape, coloring, and a related hairstyle, with an older face. Not a younger copy of ${name}.`,
    },
    {
        id: 'sibling',
        label: 'Sibling',
        line: (name) => `Sibling of ${name}. A similar age, with family resemblance in the eyes and coloring, and a distinct hairstyle and face so they are not identical.`,
    },
    {
        id: 'child',
        label: 'Child',
        line: (name) => `Child of ${name}. Younger face and proportions. Family resemblance in the eyes and coloring. Not a smaller copy of ${name}.`,
    },
    {
        id: 'partner',
        label: 'Partner',
        line: (name) => `Partner of ${name}. A different person in the same art style. Do not copy ${name}'s face, age, or hairstyle.`,
    },
];

export const TRAIT_FIELDS = [
    { id: 'hair', label: 'Hair' },
    { id: 'eyes', label: 'Eyes' },
    { id: 'height', label: 'Height' },
    { id: 'age', label: 'Age' },
];

export function relationSpec(relation) {
    return RELATIONS.find((item) => item.id === relation) || RELATIONS[0];
}

export function emptyTraits() {
    return { hair: '', eyes: '', height: '', age: '' };
}

export function normalizeTraits(traits) {
    const next = emptyTraits();
    for (const field of TRAIT_FIELDS) next[field.id] = String(traits?.[field.id] || '').trim();
    return next;
}

/** Pull hair, eyes, height, and age out of a free-text description. Clothes are left out. */
export function parseTraits(text) {
    const traits = emptyTraits();
    const parts = String(text || '').split(/[,.]/).map((part) => part.trim()).filter(Boolean);
    for (const part of parts) {
        if (/eye/i.test(part)) traits.eyes = traits.eyes || part;
        else if (/height|\btall\b|\bshort\b|\bcm\b|feet/i.test(part)) traits.height = traits.height || part;
        else if (/\bage\b|\d0s|years|older|younger|teen/i.test(part)) traits.age = traits.age || part;
        else if (/hair|bob|braid|ponytail|bangs|locks|\bcut\b|silver|blonde|auburn|copper/i.test(part)) traits.hair = traits.hair || part;
    }
    return traits;
}

export function inheritTraits(source, relation) {
    if (relation === 'partner') return emptyTraits();
    const traits = parseTraits(source?.appearance || '');
    if (relation === 'parent' && !traits.age) traits.age = 'about 50s';
    if (relation === 'child' && !traits.age) traits.age = 'younger';
    if (relation === 'sibling' && !traits.age) traits.age = 'a similar age';
    return traits;
}

export function describeRelated(source, relation, traits) {
    const spec = relationSpec(relation);
    const name = source?.name || 'the source character';
    const kept = TRAIT_FIELDS.map((field) => String(traits?.[field.id] || '').trim()).filter(Boolean);
    return [
        spec.line(name),
        kept.length ? `Family features to echo, not duplicate: ${kept.join(', ')}` : '',
    ].filter(Boolean).join(' ');
}

export function relatedAppearance(source, relation) {
    return describeRelated(source, relation, inheritTraits(source, relation));
}

/** A new board seeded from an existing character. The source record is not modified. */
export function createRelatedCharacter(library, source, { relation = 'parent', name = '' } = {}) {
    if (!source?.key) throw new Error('Pick a character to relate.');
    const spec = relationSpec(relation);
    const label = String(name || '').trim() || `${spec.label} of ${source.name}`;
    const traits = inheritTraits(source, spec.id);
    const appearance = describeRelated(source, spec.id, traits);
    const record = emptyRecord({
        key: `related:${newId('rel')}`,
        name: label.slice(0, 80),
        kind: 'character',
        stName: label.slice(0, 80),
    });
    record.sourceKey = source.key;
    record.relation = spec.id;
    record.traits = traits;
    record.appearance = appearance;
    record.composedAppearance = appearance;
    record.nameLocked = Boolean(String(name || '').trim());
    library.records[record.key] = record;
    return record;
}

export function familyReferences(record, records = []) {
    if (!record?.sourceKey) return [];
    const source = records.find((item) => item.key === record.sourceKey);
    return source ? [source] : [];
}

/** Write trait edits onto the related record only. */
export function applyTraitEdit(record, source, traits) {
    const next = normalizeTraits({ ...normalizeTraits(record?.traits), ...traits });
    record.traits = next;
    const appearance = describeRelated(source, record.relation || 'sibling', next);
    record.appearance = appearance;
    record.composedAppearance = appearance;
    return record;
}

/** Change the relationship label. A custom name stays. The parent record is not written. */
export function assignRelation(record, source, relation) {
    const previous = relationSpec(record.relation);
    const spec = relationSpec(relation);
    const auto = `${previous.label} of ${source?.name || ''}`.trim();
    record.relation = spec.id;
    if (!record.nameLocked && record.name === auto) {
        record.name = `${spec.label} of ${source?.name || 'character'}`.slice(0, 80);
        record.stName = record.name;
    }
    return applyTraitEdit(record, source, record.traits);
}

export function remixDraft(record, source) {
    const traits = normalizeTraits(record?.traits);
    const appearance = describeRelated(source, record?.relation || 'sibling', traits);
    return {
        sourceKey: record?.sourceKey || '',
        relation: record?.relation || 'sibling',
        name: record?.name || '',
        traits,
        appearance,
        prompt: [
            appearance,
            String(record?.appearance || '').trim(),
            `This is ${record?.name || 'the relative'}, related to ${source?.name || 'the original'}. Not a copy of ${source?.name || 'them'}.`,
        ].filter(Boolean).join('\n'),
    };
}

export function replacementPrompt(record, image, options = {}) {
    const tags = image?.tags || [];
    const expression = tags.includes('expression');
    const pose = tags.includes('pose') && !tags.includes('turnaround');
    const turn = tags.includes('turnaround') || pose;
    const outfitEdit = tags.includes('outfit') && !expression && !tags.includes('turnaround');
    const kind = expression
        ? 'Expression'
        : (tags.includes('turnaround') ? 'Turnaround' : (pose ? 'Pose' : (tags.includes('outfit') ? 'Outfit' : 'Still')));
    const framing = expression
        ? 'Portrait framing, waist-up, the same in every expression: head, shoulders, and torso to the waist, tall 3:4 frame, plain background. Do not crop to the face.'
        : (turn ? 'One single full-body figure, wide 16:9 frame, plain background.' : '');
    const poseOnly = pose && !options.wrongOutfit;
    const lock = Boolean(options.wrongOutfit) || (options.lockOutfit !== false && !poseOnly && !outfitEdit && record?.varyOutfit !== true);
    const clothes = outfitEdit
        ? ''
        : clothingClause(options.suiteOutfit || outfitTextFor(record), { lock });
    const variation = options.vary
        ? `Variation ${options.seed || 'new'}. A different take of the same person. Do not copy the previous still.`
        : '';
    const wrong = options.wrongOutfit ? 'The previous still changed the clothes. Put the suite outfit back.' : '';
    return [
        String(record?.appearance || '').trim(),
        record?.mustKeep ? `Must keep: ${record.mustKeep}.` : '',
        clothes,
        wrong,
        `${kind}: ${image?.label || 'view'}.`,
        framing,
        'Same person as the description. Replace only this view.',
        variation,
        String(image?.prompt || '').trim(),
    ].filter(Boolean).join('\n');
}

/** Swap one still. The previous picture is kept on the image until this is called. */
export function approveReplacement(record, imageId, { dataUrl, prompt } = {}) {
    const image = (record?.images || []).find((item) => item.id === imageId);
    if (!image || !dataUrl) return null;
    image.previousDataUrl = image.dataUrl || image.url || '';
    image.dataUrl = dataUrl;
    if (prompt) image.prompt = prompt;
    return image;
}

export function updateOutfitText(record, outfitId, description) {
    const outfit = (record?.outfits || []).find((item) => item.id === outfitId);
    if (!outfit) return null;
    outfit.description = String(description || '');
    return outfit;
}
