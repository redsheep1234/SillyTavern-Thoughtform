/** Which SillyTavern expression faces are drawn, and which reuse a drawn face for free. */

export const EXPRESSION_TABLE = [
    { st: 'neutral', id: 'neutral', label: 'neutral', generate: true, line: 'Neutral expression, relaxed mouth, eyes open, looking at the camera.' },
    { st: 'joy', id: 'happy', label: 'happy', aliases: ['happy'], generate: true, line: 'Happy expression, a genuine smile, bright eyes.' },
    { st: 'amusement', id: 'laughing', label: 'laughing', aliases: ['laughing'], generate: true, line: 'Laughing, mouth open in a laugh, eyes narrowed.' },
    { st: 'sadness', id: 'sad', label: 'sad', aliases: ['sad'], generate: true, line: 'Sad expression, downturned mouth, soft eyes.' },
    { st: 'grief', id: 'crying', label: 'crying', aliases: ['crying'], generate: true, line: 'Crying, tears on the cheeks, a trembling mouth.' },
    { st: 'anger', id: 'angry', label: 'angry', aliases: ['angry'], generate: true, line: 'Angry expression, furrowed brow, tense mouth.' },
    { st: 'surprise', id: 'surprised', label: 'surprised', aliases: ['surprised'], generate: true, line: 'Surprised, raised brows, slightly open mouth.' },
    { st: 'fear', id: 'scared', label: 'scared', aliases: ['scared'], generate: true, line: 'Scared, wide eyes, tense jaw.' },
    { st: 'embarrassment', id: 'embarrassed', label: 'embarrassed/blushing', aliases: ['embarrassed', 'embarrassed/blushing'], generate: true, line: 'Embarrassed, a blush across the cheeks, glance slightly aside.' },
    { st: 'pride', id: 'smug', label: 'smug', aliases: ['smug'], generate: true, line: 'Smug, one brow lifted, a small closed-mouth smile.' },
    { st: 'curiosity', id: 'thinking', label: 'thinking', aliases: ['thinking'], generate: true, line: 'Thinking, eyes off to the side, a thoughtful mouth.' },
    { st: 'desire', id: 'flirty', label: 'seductive/flirty', aliases: ['flirty', 'seductive/flirty'], generate: true, line: 'Flirty expression, one brow raised, a small smile.' },
    { st: 'admiration', id: 'admiration', label: 'admiration', generate: true, line: 'Warm adoring smile, soft eyes, affection in the face. Not a laugh.' },
    { st: 'disgust', id: 'disgust', label: 'disgust', generate: true, line: 'Disgust, nose wrinkled, upper lip raised, eyes narrowed.' },
    { st: 'confusion', id: 'confusion', label: 'confusion', generate: true, line: 'Confused, brows drawn together unevenly, mouth slightly askew.' },
    { st: 'nervousness', id: 'nervousness', label: 'nervousness', generate: true, line: 'Nervous, a tight small smile, uneasy eyes, a glance slightly aside.' },
    { st: 'love', id: 'love', label: 'love', generate: false, copyOf: 'admiration', line: 'Love, a warm adoring smile, soft eyes. A distinct picture, not a reused smile.' },
    { st: 'caring', id: 'caring', label: 'caring', generate: false, copyOf: 'admiration', line: 'Caring, a gentle concerned smile, soft eyes.' },
    { st: 'gratitude', id: 'gratitude', label: 'gratitude', generate: false, copyOf: 'admiration', line: 'Grateful, a soft thankful smile, bright eyes.' },
    { st: 'approval', id: 'approval', label: 'approval', generate: false, copyOf: 'joy', line: 'Approving, a small nod-ready smile, relaxed eyes.' },
    { st: 'optimism', id: 'optimism', label: 'optimism', generate: false, copyOf: 'joy', line: 'Optimistic, a hopeful soft smile, bright eyes.' },
    { st: 'relief', id: 'relief', label: 'relief', generate: false, copyOf: 'joy', line: 'Relieved, a softer smile, breath let out, eyes easing.' },
    { st: 'excitement', id: 'excitement', label: 'excitement', generate: false, optional: true, copyOf: 'amusement', line: 'Excited, wide bright eyes, an eager open smile, raised brows. Not a laugh.' },
    { st: 'annoyance', id: 'annoyance', label: 'annoyance', generate: false, copyOf: 'anger', line: 'Annoyed, a tight frown, one brow lowered. Not a shout.' },
    { st: 'disapproval', id: 'disapproval', label: 'disapproval', generate: false, copyOf: 'anger', line: 'Disapproving, a flat mouth, lowered brows, a hard stare.' },
    { st: 'disappointment', id: 'disappointment', label: 'disappointment', generate: false, optional: true, copyOf: 'sadness', line: 'Disappointed, a small frown and let-down eyes, mouth pressed shut. Not crying.' },
    { st: 'remorse', id: 'remorse', label: 'remorse', generate: false, copyOf: 'sadness', line: 'Remorseful, downcast eyes, a guilty downturned mouth.' },
    { st: 'realization', id: 'realization', label: 'realization', generate: false, copyOf: 'surprise', line: 'Realization, eyes widening as it lands, brows up, mouth parting.' },
    { st: 'determined', id: 'determined', label: 'determined', generate: false, optional: true, extra: true, line: 'Determined, level gaze, set mouth.' },
    { st: 'tired', id: 'tired', label: 'tired', generate: false, optional: true, extra: true, line: 'Tired, heavy eyelids, a soft almost-yawn.' },
];

export function findExpression(name) {
    const text = String(name || '').trim().toLowerCase();
    if (!text) return null;
    return EXPRESSION_TABLE.find((row) => row.st === text || row.id === text || String(row.label || '').toLowerCase() === text || (row.aliases || []).includes(text)) || null;
}

export function canonicalExpression(name) {
    const row = findExpression(name);
    return row?.st || String(name || '').trim().toLowerCase();
}

/** SillyTavern labels the Full suite files, in table order. Extras stay out. */
export function fullExpressionNames() {
    return EXPRESSION_TABLE.filter((row) => !row.extra).map((row) => row.st);
}

export function isCopiedExpression(expression) {
    return Boolean(expression?.copyOf) && expression.generate !== true;
}

/** After the drawn faces exist, point each free label at that picture. */
export function fillExpressionCopies(items) {
    const list = items || [];
    for (const item of list) {
        if (!isCopiedExpression(item) && !item.copyOf) continue;
        if (!item.copyOf) continue;
        const sourceName = String(item.copyOf).toLowerCase();
        const source = list.find((other) => !other.copyOf && String(other.stLabel || other.label || '').toLowerCase() === sourceName);
        if (!source || source.skipped) {
            item.skipped = true;
            item.error = '';
            continue;
        }
        if (source.dataUrl) {
            item.dataUrl = source.dataUrl;
            item.cacheKey = source.cacheKey || '';
            item.error = '';
            item.skipped = false;
        } else if (source.error) {
            item.error = `No ${item.copyOf} picture to copy.`;
            item.skipped = false;
        }
    }
    return list;
}

function imageExpressionName(image) {
    return canonicalExpression(image?.stLabel || image?.label);
}

/**
 * One file per SillyTavern label.
 * A missing near-duplicate reuses the drawn face. Extras are added only when saved.
 */
export function expressionFiles(record, names) {
    const saved = (record?.images || []).filter((image) => image?.dataUrl && image.frame !== 'wide' && image.tags?.includes('expression') && (image.stLabel || image.label));
    const groups = new Map();
    for (const image of saved) {
        const name = imageExpressionName(image);
        if (!name) continue;
        const group = groups.get(name) || [];
        group.push(image);
        groups.set(name, group);
    }
    const files = [];
    const used = new Set();
    for (const name of names || []) {
        const group = groups.get(name) || [];
        const direct = group.find((image) => image.portrait === true)
            || group.find((image) => String(image.stLabel || '').toLowerCase() === name)
            || group[0];
        if (direct) {
            files.push({ ...direct, stLabel: name });
            used.add(name);
            continue;
        }
        const row = findExpression(name);
        if (!row?.copyOf || row.generate === true) continue;
        const sourceGroup = groups.get(row.copyOf) || [];
        const source = sourceGroup.find((image) => image.portrait === true) || sourceGroup[0];
        if (!source) continue;
        files.push({
            ...source,
            label: name,
            stLabel: name,
            copyOf: row.copyOf,
        });
        used.add(name);
    }
    for (const image of saved) {
        const name = imageExpressionName(image);
        if (!name || used.has(name) || (names || []).includes(name)) continue;
        files.push({ ...image, stLabel: image.stLabel || name });
        used.add(name);
    }
    return files;
}
