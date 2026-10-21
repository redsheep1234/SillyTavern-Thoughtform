/** Expression sheet, turnaround, and close-ups. Prompts describe the picture, not a sexual act. */

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
    { id: 'front', label: 'front', kind: 'turnaround', line: 'Full body, front view, standing straight, arms relaxed, plain background.' },
    { id: 'three-quarter', label: 'three-quarter', kind: 'turnaround', line: 'Full body, three-quarter view, standing, plain background.' },
    { id: 'side', label: 'side', kind: 'turnaround', line: 'Full body, side profile, standing, plain background.' },
    { id: 'back', label: 'back', kind: 'turnaround', line: 'Full body, back view, standing, plain background.' },
    { id: 'standing', label: 'standing', kind: 'pose', line: 'Full body, standing pose, front view, plain background.' },
    { id: 'sitting', label: 'sitting', kind: 'pose', line: 'Full body, sitting on a simple stool, plain background.' },
    { id: 'walking', label: 'walking', kind: 'pose', line: 'Full body, mid-stride walking pose, plain background.' },
    { id: 'action', label: 'action', kind: 'pose', line: 'Full body, a ready stance with weight forward, plain background.' },
];

export const CLOSEUPS = [
    { id: 'face-front', label: 'face front', kind: 'closeup', line: 'Close-up of the face, front view, plain background.' },
    { id: 'face-three-quarter', label: 'face three-quarter', kind: 'closeup', line: 'Close-up of the face, three-quarter angle, plain background.' },
    { id: 'face-profile', label: 'face profile', kind: 'closeup', line: 'Close-up of the face in profile, plain background.' },
];

export function parseExpressionList(text) {
    const raw = String(text || '').trim();
    if (!raw) return DEFAULT_EXPRESSIONS.map((item) => ({ ...item }));
    return raw.split(/\n|,/).map((part) => part.trim()).filter(Boolean).map((label) => {
        const known = DEFAULT_EXPRESSIONS.find((item) => item.label.toLowerCase() === label.toLowerCase() || item.id === label.toLowerCase());
        if (known) return { ...known };
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
} = {}) {
    const outfitLine = outfit ? `Outfit ${outfit.name}: ${outfit.description || 'as shown in the reference.'}` : '';
    const base = [
        'Same person in every image. Keep the same face, hair, and body.',
        outfit ? 'Keep this outfit identical in every view.' : 'Keep the same clothes in every view.',
        styleLine,
        appearance ? `Appearance: ${appearance}` : '',
        outfitLine,
    ].filter(Boolean).join(' ');
    const items = [];
    if (includeExpressions) {
        for (const expression of expressions) {
            items.push({
                id: `expr-${expression.id}`,
                label: expression.label,
                tags: ['expression', 'face'],
                stLabel: expression.st || '',
                prompt: `${base} Expression sheet frame, head and shoulders, consistent framing, plain background. Expression: ${expression.line}`,
            });
        }
    }
    if (includeTurnaround) {
        for (const view of TURNAROUND) {
            items.push({
                id: `turn-${view.id}`,
                label: view.label,
                tags: [view.kind, 'full body', outfit ? 'outfit' : ''].filter(Boolean),
                stLabel: '',
                prompt: `${base} ${view.line}`,
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
                prompt: `${base} ${view.line}`,
            });
        }
    }
    return items;
}
