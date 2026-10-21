/** Project-level art direction prepended to stills, keyframes, and video prompts. */

export function styleLockText(settings = {}) {
    const custom = String(settings.styleLock || '').trim();
    if (custom) return custom;
    if (settings.style === 'anime') return '2D anime, cel-shaded, same art style as the references.';
    if (settings.style === 'other') {
        return String(settings.styleOther || '').trim() || 'Same art style as the references.';
    }
    return 'Photoreal live action, same photographic style as the references.';
}

export function withStyleLock(prompt, settings) {
    const lock = styleLockText(settings);
    const body = String(prompt || '').trim();
    if (!lock) return body;
    if (body === lock || body.startsWith(`${lock}\n`) || body.startsWith(`${lock} `)) return body;
    return [lock, body].filter(Boolean).join('\n');
}
