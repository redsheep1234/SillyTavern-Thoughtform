/** Turn one still into a clip. The picture is the keyframe. */

export function animatePrompt(prompt) {
    const note = 'Animate this still. Use it as the keyframe. Keep the same person, face, clothes, and place. Small natural motion only.';
    const base = String(prompt || '').trim();
    return base ? `${base}\n${note}` : note;
}
