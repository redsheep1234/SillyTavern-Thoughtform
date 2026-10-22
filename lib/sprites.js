/** Upload approved expression stills into SillyTavern's Character Expressions folder. */

/** SillyTavern's built-in classifier labels. Custom names are extra files. */
export const ST_EXPRESSIONS = [
    'admiration', 'amusement', 'anger', 'annoyance', 'approval', 'caring',
    'confusion', 'curiosity', 'desire', 'disappointment', 'disapproval', 'disgust',
    'embarrassment', 'excitement', 'fear', 'gratitude', 'grief', 'joy', 'love',
    'nervousness', 'optimism', 'pride', 'realization', 'relief', 'remorse',
    'sadness', 'surprise', 'neutral',
];

export function spriteExportPlan(record) {
    const targets = spriteTargets(record);
    const mappings = targets.map((image) => ({
        from: image.label || image.stLabel || 'still',
        to: image.stLabel || image.label || 'still',
    }));
    const used = new Set(mappings.map((item) => String(item.to).toLowerCase()));
    const empty = ST_EXPRESSIONS.filter((name) => !used.has(name));
    return { targets, mappings, empty };
}

export function setFallbackExpression(name, context) {
    const bag = context?.extensionSettings;
    if (!bag || !name) return false;
    bag.expressions = bag.expressions || {};
    bag.expressions.fallback_expression = name;
    bag.expressions.showDefault = false;
    const select = typeof document === 'undefined' ? null : document.getElementById('expression_fallback');
    if (select) {
        select.value = name;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    context.saveSettingsDebounced?.();
    return true;
}

export function openSpriteSet() {
    if (typeof document === 'undefined') return false;
    const drawer = document.querySelector('#expressions_settings');
    const toggle = drawer?.querySelector('.inline-drawer-toggle');
    const closed = drawer && !drawer.classList.contains('open');
    if (closed && toggle) toggle.click();
    drawer?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (drawer) return true;
    const item = [...document.querySelectorAll('#extensions_settings .inline-drawer-header, .inline-drawer-header')]
        .find((node) => /expression/i.test(node.textContent || ''));
    item?.click();
    item?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return Boolean(item);
}

export function spriteTargets(record) {
    return (record?.images || []).filter((image) => image.dataUrl && image.tags?.includes('expression') && (image.stLabel || image.label));
}

function dataUrlToBlob(dataUrl) {
    const match = String(dataUrl).match(/^data:([^,]*),(.*)$/s);
    if (!match) throw new Error('Expression image is not a data URL.');
    const mime = match[1].split(';')[0] || 'image/png';
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: mime });
}

export async function uploadExpressionSprites(record, { fetchImpl = globalThis.fetch, headers = {} } = {}) {
    const targets = spriteTargets(record);
    if (!targets.length) throw new Error('Approve an expression still before exporting sprites.');
    const folder = record.stName || record.name;
    if (!folder) throw new Error('This board has no character name for the sprites folder.');
    const head = { ...headers };
    delete head['Content-Type'];
    delete head['content-type'];
    const uploaded = [];
    for (const image of targets) {
        const label = image.stLabel || image.label;
        const spriteName = label;
        const blob = dataUrlToBlob(image.dataUrl);
        const ext = blob.type.includes('jpeg') ? 'jpg' : 'png';
        const form = new FormData();
        form.append('name', folder);
        form.append('label', label);
        form.append('spriteName', spriteName);
        form.append('avatar', blob, `${spriteName}.${ext}`);
        const response = await fetchImpl('/api/sprites/upload', { method: 'POST', body: form, headers: head });
        if (!response.ok) {
            const text = typeof response.text === 'function' ? await response.text() : '';
            throw new Error(text || `Sprite upload failed (${response.status}).`);
        }
        uploaded.push(label);
    }
    return uploaded;
}
