/** Upload approved expression stills into SillyTavern's Character Expressions folder. */

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
