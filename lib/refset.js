/** Expression sheet, turnaround, and close-ups. Prompts describe the picture, not a sexual act. */

import { findExpression, fullExpressionNames, isCopiedExpression } from './expressions.js';
import { stillCost } from './providers/image.js';
import { appearanceWithoutClothes } from './wardrobe.js';

export const DEFAULT_EXPRESSIONS = [
    { id: 'neutral', label: 'neutral', st: 'neutral', line: 'Neutral expression, relaxed mouth, eyes open, looking at the camera.' },
    { id: 'happy', label: 'happy', st: 'joy', line: 'Happy expression, a genuine smile, bright eyes.' },
    { id: 'laughing', label: 'laughing', st: 'amusement', line: 'Laughing, mouth open in a laugh, eyes narrowed.' },
    { id: 'sad', label: 'sad', st: 'sadness', line: 'Sad expression, downturned mouth, soft eyes.' },
    { id: 'crying', label: 'crying', st: 'grief', line: 'Crying, tears on the cheeks, a trembling mouth.' },
    { id: 'angry', label: 'angry', st: 'anger', line: 'Angry expression, furrowed brow, tense mouth.' },
    { id: 'surprised', label: 'surprised', st: 'surprise', line: 'Surprised, raised brows, slightly open mouth.' },
    { id: 'scared', label: 'scared', st: 'fear', line: 'Scared, wide eyes, tense jaw.' },
    { id: 'embarrassed', label: 'embarrassed/blushing', st: 'embarrassment', line: 'Embarrassed, a blush across the cheeks, glance slightly aside.' },
    { id: 'smug', label: 'smug', st: 'pride', line: 'Smug, one brow lifted, a small closed-mouth smile.' },
    { id: 'thinking', label: 'thinking', st: 'curiosity', line: 'Thinking, eyes off to the side, a thoughtful mouth.' },
    { id: 'determined', label: 'determined', st: 'determined', line: 'Determined, level gaze, set mouth.' },
    { id: 'flirty', label: 'seductive/flirty', st: 'desire', line: 'Flirty expression, one brow raised, a small smile. Show the face only.' },
    { id: 'tired', label: 'tired', st: 'tired', line: 'Tired, heavy eyelids, a soft almost-yawn.' },
];

export const TURNAROUND = [
    { id: 'front', label: 'front', kind: 'turnaround', line: 'One single full-body figure, front view, standing straight, arms relaxed, plain background. Do not draw a second figure or other views in this picture.' },
    { id: 'three-quarter', label: 'three-quarter', kind: 'turnaround', line: 'One single full-body figure, three-quarter view, standing, plain background. Do not draw a second figure or other views in this picture.' },
    { id: 'side', label: 'side', kind: 'turnaround', line: 'One single full-body figure, side profile, standing, plain background. Do not draw a second figure or other views in this picture.' },
    { id: 'back', label: 'back', kind: 'turnaround', line: 'One single full-body figure, back view, standing, plain background. Do not draw a second figure or other views in this picture.' },
    { id: 'standing', label: 'standing', kind: 'pose', line: 'One single full-body figure, standing, front view, plain background. Do not draw a second figure.' },
    { id: 'sitting', label: 'sitting', kind: 'pose', line: 'One single full-body figure, sitting on a simple stool, plain background. Do not draw a second figure.' },
    { id: 'walking', label: 'walking', kind: 'pose', line: 'One single full-body figure, mid-stride, plain background. Do not draw a second figure.' },
    { id: 'action', label: 'action', kind: 'pose', line: 'One single full-body figure, a ready stance, plain background. Do not draw a second figure.' },
];

export const QUICK_EXPRESSION_IDS = ['neutral', 'happy', 'sad', 'angry'];
export const QUICK_TURNAROUND_IDS = ['front', 'side', 'back'];

export function expressionsForPreset(preset = 'quick') {
    if (preset === 'full') return resolveSuiteExpressions(expressionListText('full'), { full: true });
    const source = DEFAULT_EXPRESSIONS.filter((item) => QUICK_EXPRESSION_IDS.includes(item.id));
    return source.map((item) => ({ ...item }));
}

export function turnaroundForPreset(preset = 'quick') {
    const source = preset === 'full'
        ? TURNAROUND
        : TURNAROUND.filter((item) => QUICK_TURNAROUND_IDS.includes(item.id));
    return source.map((item) => ({ ...item }));
}

export function expressionListText(preset = 'quick') {
    if (preset === 'full') return fullExpressionNames().join('\n');
    return expressionsForPreset(preset).map((item) => item.st || item.label).join('\n');
}

/** Full keeps every SillyTavern name. Ticked extras are drawn; the rest stay copies. */
export function resolveSuiteExpressions(text, { extras = [], full = false } = {}) {
    const on = new Set((extras || []).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean));
    const rows = parseExpressionList(text).map((item) => {
        if (!full || !item.optional) return item;
        const names = [item.st, item.id].map((name) => String(name || '').toLowerCase());
        if (!names.some((name) => on.has(name))) return item;
        return { ...item, generate: true, copyOf: '' };
    });
    if (!full) return rows;
    for (const extra of ['determined', 'tired']) {
        if (!on.has(extra)) continue;
        if (rows.some((item) => item.st === extra || item.id === extra)) continue;
        const row = findExpression(extra);
        if (row) rows.push({ ...row, label: row.st, generate: true, copyOf: '' });
    }
    return rows;
}

export const CLOSEUPS = [
    { id: 'face-front', label: 'face front', kind: 'closeup', line: 'Close-up of the face, front view, plain background.' },
    { id: 'face-three-quarter', label: 'face three-quarter', kind: 'closeup', line: 'Close-up of the face, three-quarter angle, plain background.' },
    { id: 'face-profile', label: 'face profile', kind: 'closeup', line: 'Close-up of the face in profile, plain background.' },
];

export function stNameFor(label) {
    const text = String(label || '').trim().toLowerCase();
    if (!text) return '';
    return findExpression(text)?.st || text;
}

/** Which names in the list already have an expression still, using SillyTavern names. */
export function expressionCoverage(record, names) {
    const have = new Set();
    for (const image of record?.images || []) {
        const tagged = image?.tags?.includes('expression') || image?.stLabel;
        if (!tagged) continue;
        if (image.stLabel) have.add(String(image.stLabel).toLowerCase());
        if (image.label) have.add(stNameFor(image.label));
    }
    const listed = [];
    const seen = new Set();
    for (const name of names || []) {
        const st = stNameFor(name);
        if (!st || seen.has(st)) continue;
        seen.add(st);
        listed.push({ name: st, done: have.has(st) });
    }
    for (const name of have) {
        if (seen.has(name)) continue;
        seen.add(name);
        listed.push({ name, done: true });
    }
    return listed;
}

export function parseExpressionList(text) {
    const raw = String(text || '').trim();
    if (!raw) return DEFAULT_EXPRESSIONS.map((item) => ({ ...item }));
    return raw.split(/\n|,/).map((part) => part.trim()).filter(Boolean).map((label) => {
        const row = findExpression(label);
        if (row) {
            const typed = label.toLowerCase();
            const asWritten = row.st === typed ? row.st : (row.label || row.st);
            return {
                ...row,
                label: asWritten,
                generate: row.extra ? true : row.generate === true,
                copyOf: row.extra ? '' : (row.copyOf || ''),
            };
        }
        const known = DEFAULT_EXPRESSIONS.find((item) => item.label.toLowerCase() === label.toLowerCase() || item.id === label.toLowerCase() || item.st === label.toLowerCase());
        if (known) {
            if (known.st && known.st.toLowerCase() === label.toLowerCase()) return { ...known, label: known.st };
            return { ...known };
        }
        const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'expr';
        return { id, label, st: id, line: `${label} expression, same face and framing.` };
    });
}

export function planReferenceSet({
    expressions = DEFAULT_EXPRESSIONS,
    includeExpressions = true,
    includeTurnaround = true,
    includeCloseups = false,
    outfit = null,
    styleLine = '',
    appearance = '',
    mustKeep = '',
    turnaround = null,
} = {}) {
    const outfitLine = outfit ? `Wear only this outfit, ${outfit.name}: ${outfit.description || 'as shown in the reference.'} Remove every other garment.` : '';
    const look = outfit ? appearanceWithoutClothes(appearance) : appearance;
    const base = [
        'Keep the same face, hair, and body as the reference.',
        outfit ? 'Keep this outfit identical. Do not add the old clothes.' : 'Keep the same clothes.',
        styleLine,
        look ? `Appearance: ${look}` : '',
        mustKeep ? `Must keep: ${mustKeep}.` : '',
        outfitLine,
        'One person only. A single figure. Do not draw a second figure or other views in the same picture.',
    ].filter(Boolean).join(' ');
    const items = [];
    if (includeExpressions) {
        for (const expression of expressions) {
            const copying = isCopiedExpression(expression);
            items.push({
                id: `expr-${expression.id}`,
                label: expression.label,
                tags: ['expression', 'face'],
                stLabel: expression.st || '',
                copyOf: copying ? expression.copyOf : '',
                aspectRatio: '3:4',
                prompt: `${base} Portrait for a chat sprite, upper body, head and shoulders, plain background, tall 3:4 frame. Expression: ${expression.line || `${expression.label} expression, same face and framing.`}`,
            });
        }
    }
    if (includeTurnaround) {
        for (const view of (turnaround || TURNAROUND)) {
            items.push({
                id: `turn-${view.id}`,
                label: view.label,
                tags: [view.kind, 'full body', outfit ? 'outfit' : ''].filter(Boolean),
                stLabel: '',
                aspectRatio: '16:9',
                prompt: `${base} ${view.line} Wide 16:9 frame.`,
            });
        }
    }
    if (includeCloseups) {
        for (const view of CLOSEUPS) {
            items.push({
                id: `close-${view.id}`,
                label: view.label,
                tags: ['closeup', 'face'],
                stLabel: '',
                aspectRatio: '3:4',
                prompt: `${base} ${view.line} Portrait 3:4 frame.`,
            });
        }
    }
    return items;
}

/** Price the pictures that will be drawn. A full SillyTavern set says how many of those are new. */
export function suiteQuote(plan, modelId) {
    const names = new Set((plan || []).filter((item) => item.tags?.includes('expression')).map((item) => String(item.stLabel || '').toLowerCase()));
    const billed = (plan || []).filter((item) => !item.copyOf);
    const cost = stillCost(billed.length, modelId);
    const full = fullExpressionNames();
    if (full.length && full.every((name) => names.has(name))) {
        return `${full.length} expressions, about ${billed.length} new pictures (copies are free) · ${cost.label}`;
    }
    return `${(plan || []).length} stills · ${cost.label}`;
}
