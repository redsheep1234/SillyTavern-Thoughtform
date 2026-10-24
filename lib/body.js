/** Figure wording. Must keep stays a separate hard lock and is not rewritten from this line. */

function cleanLine(text) {
    return String(text || '').trim().replace(/[.]+$/, '').slice(0, 240);
}

/** Build phrase without a trailing period, for lines that already join on ". ". */
export function buildPhrase(text) {
    const line = cleanLine(text);
    return line ? `Build: ${line}` : '';
}

/**
 * Full-body work gets the build sentence.
 * Portraits only mention the same figure at the shoulders and neckline.
 */
export function bodyClause(text, scope = 'full') {
    const line = cleanLine(text);
    if (!line) return '';
    if (scope === 'portrait') {
        return `Figure, at the shoulders and neckline only: ${line}. The face stays dominant.`;
    }
    return `Build: ${line}.`;
}
