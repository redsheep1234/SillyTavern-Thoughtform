/** Upload approved expression stills into SillyTavern's Character Expressions folder. */

import { canonicalExpression, expressionFiles } from './expressions.js';

/** SillyTavern's built-in classifier labels. Custom names are extra files. */
export const ST_EXPRESSIONS = [
    'admiration', 'amusement', 'anger', 'annoyance', 'approval', 'caring',
    'confusion', 'curiosity', 'desire', 'disappointment', 'disapproval', 'disgust',
    'embarrassment', 'excitement', 'fear', 'gratitude', 'grief', 'joy', 'love',
    'nervousness', 'optimism', 'pride', 'realization', 'relief', 'remorse',
    'sadness', 'surprise', 'neutral',
];

export function spriteExportPlan(record) {
    const targets = expressionFiles(record, ST_EXPRESSIONS);
    const mappings = [];
    const seen = new Set();
    for (const image of spriteTargets(record)) {
        const to = canonicalExpression(image.stLabel || image.label);
        if (!to) continue;
        mappings.push({
            from: image.label || image.stLabel || 'still',
            to,
            copyOf: image.copyOf || '',
        });
        seen.add(to);
    }
    for (const image of targets) {
        const to = String(image.stLabel || image.label || '').toLowerCase();
        if (!to || seen.has(to)) continue;
        mappings.push({
            from: image.label || to,
            to,
            copyOf: image.copyOf || '',
        });
        seen.add(to);
    }
    const used = new Set(targets.map((image) => String(image.stLabel || image.label || '').toLowerCase()));
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
    return (record?.images || []).filter((image) => image.dataUrl && image.frame !== 'wide' && image.tags?.includes('expression') && (image.stLabel || image.label));
}

export function dataUrlBytes(dataUrl) {
    const match = String(dataUrl).match(/^data:([^,]*),(.*)$/s);
    if (!match) throw new Error('Expression image is not a data URL.');
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return { mime: match[1].split(';')[0] || 'image/png', bytes };
}

function spriteFolder(record) {
    const name = String(record?.stName || record?.name || 'character').replace(/[\\/:*?"<>|]/g, '_').trim();
    return name || 'character';
}

export function expressionZipFiles(record) {
    return expressionFiles(record, ST_EXPRESSIONS).map((image) => {
        const decoded = dataUrlBytes(image.dataUrl);
        const label = image.stLabel || image.label;
        const ext = decoded.mime.includes('jpeg') ? 'jpg' : 'png';
        return {
            name: `${spriteFolder(record)}/${label}.${ext}`,
            bytes: decoded.bytes,
        };
    });
}

function crc32(bytes) {
    let crc = 0xffffffff;
    for (let index = 0; index < bytes.length; index++) {
        crc ^= bytes[index];
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function pushU16(out, value) {
    out.push(value & 255, (value >> 8) & 255);
}

function pushU32(out, value) {
    out.push(value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >> 24) & 255);
}

/** A stored (uncompressed) zip. SillyTavern can drop the folder into expressions. */
export function buildStoredZip(files) {
    const locals = [];
    const central = [];
    let offset = 0;
    for (const file of files) {
        const name = new TextEncoder().encode(file.name);
        const data = file.bytes;
        const crc = crc32(data);
        const local = [];
        pushU32(local, 0x04034b50);
        pushU16(local, 20);
        pushU16(local, 0);
        pushU16(local, 0);
        pushU16(local, 0);
        pushU16(local, 0);
        pushU32(local, crc);
        pushU32(local, data.length);
        pushU32(local, data.length);
        pushU16(local, name.length);
        pushU16(local, 0);
        local.push(...name, ...data);
        const entry = [];
        pushU32(entry, 0x02014b50);
        pushU16(entry, 20);
        pushU16(entry, 20);
        pushU16(entry, 0);
        pushU16(entry, 0);
        pushU16(entry, 0);
        pushU16(entry, 0);
        pushU32(entry, crc);
        pushU32(entry, data.length);
        pushU32(entry, data.length);
        pushU16(entry, name.length);
        pushU16(entry, 0);
        pushU16(entry, 0);
        pushU16(entry, 0);
        pushU16(entry, 0);
        pushU32(entry, 0);
        pushU32(entry, offset);
        entry.push(...name);
        locals.push(...local);
        central.push(...entry);
        offset += local.length;
    }
    const end = [];
    pushU32(end, 0x06054b50);
    pushU16(end, 0);
    pushU16(end, 0);
    pushU16(end, files.length);
    pushU16(end, files.length);
    pushU32(end, central.length);
    pushU32(end, offset);
    pushU16(end, 0);
    return Uint8Array.from([...locals, ...central, ...end]);
}

export function zipExpressionSet(record) {
    const files = expressionZipFiles(record);
    if (!files.length) throw new Error('Approve an expression still before exporting sprites.');
    return buildStoredZip(files);
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
    const targets = expressionFiles(record, ST_EXPRESSIONS);
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
