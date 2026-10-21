import { emptyRecord, newId } from './library.js';

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

export function relationSpec(relation) {
    return RELATIONS.find((item) => item.id === relation) || RELATIONS[0];
}

export function relatedAppearance(source, relation) {
    const spec = relationSpec(relation);
    const name = source?.name || 'the source character';
    const features = String(source?.appearance || '').trim();
    return [
        spec.line(name),
        features ? `Family features to echo, not duplicate: ${features}` : '',
    ].filter(Boolean).join(' ');
}

/** A new board seeded from an existing character. Generation uses the source board as style and resemblance references. */
export function createRelatedCharacter(library, source, { relation = 'parent', name = '' } = {}) {
    if (!source?.key) throw new Error('Pick a character to relate.');
    const spec = relationSpec(relation);
    const label = String(name || '').trim() || `${spec.label} of ${source.name}`;
    const record = emptyRecord({
        key: `related:${newId('rel')}`,
        name: label.slice(0, 80),
        kind: 'character',
        stName: label.slice(0, 80),
    });
    record.sourceKey = source.key;
    record.relation = spec.id;
    record.appearance = relatedAppearance(source, spec.id);
    library.records[record.key] = record;
    return record;
}

export function familyReferences(record, records = []) {
    if (!record?.sourceKey) return [];
    const source = records.find((item) => item.key === record.sourceKey);
    return source ? [source] : [];
}
