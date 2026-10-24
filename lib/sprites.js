/** Upload approved expression stills into SillyTavern's Character Expressions folder. */

import { canonicalExpression, expressionFiles, expressionReady } from './expressions.js';
import { fileSrc } from './media.js';

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
    return (record?.images || []).filter((image) => expressionReady(image));
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

function concatBytes(parts) {
    let size = 0;
    for (const part of parts) size += part.length;
    const out = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

function bytesOf(list) {
    return Uint8Array.from(list);
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
        const local = concatBytes([
            bytesOf([0x50, 0x4b, 0x03, 0x04]),
            bytesOf([20, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
            u32(crc),
            u32(data.length),
            u32(data.length),
            u16(name.length),
            u16(0),
            name,
            data,
        ]);
        const entry = concatBytes([
            bytesOf([0x50, 0x4b, 0x01, 0x02]),
            bytesOf([20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
            u32(crc),
            u32(data.length),
            u32(data.length),
            u16(name.length),
            u16(0),
            u16(0),
            u16(0),
            u16(0),
            u16(0),
            u32(0),
            u32(offset),
            name,
        ]);
        locals.push(local);
        central.push(entry);
        offset += local.length;
    }
    const centralBytes = concatBytes(central);
    const end = concatBytes([
        bytesOf([0x50, 0x4b, 0x05, 0x06]),
        u16(0),
        u16(0),
        u16(files.length),
        u16(files.length),
        u32(centralBytes.length),
        u32(offset),
        u16(0),
    ]);
    return concatBytes([...locals, centralBytes, end]);
}

function u16(value) {
    return Uint8Array.of(value & 255, (value >> 8) & 255);
}

function u32(value) {
    return Uint8Array.of(value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >> 24) & 255);
}

export function zipExpressionSet(record) {
    const files = expressionZipFiles(record);
    if (!files.length) throw new Error('Approve an expression still before exporting sprites.');
    return buildStoredZip(files);
}

export function expressionZipName(record) {
    const folder = String(record?.stName || record?.name || 'expressions').replace(/[\\/:*?"<>|]/g, '_').trim() || 'expressions';
    return `${folder}-expressions.zip`;
}

function pictureLocation(image) {
    const direct = String(image?.dataUrl || '');
    if (direct.startsWith('data:')) return { dataUrl: direct, url: '' };
    const raw = direct || image?.url || image?.file || '';
    return { dataUrl: '', url: raw ? fileSrc(raw) : '' };
}

function spriteFileLabel(image) {
    return image?.stLabel || image?.label || 'that expression';
}

/** Bytes for one still. A data URL is local. A stored SillyTavern file is fetched. */
export async function pictureBytes(image, { fetchImpl = globalThis.fetch, headers = {} } = {}) {
    const label = spriteFileLabel(image);
    const located = pictureLocation(image);
    if (located.dataUrl) return dataUrlBytes(located.dataUrl);
    if (!located.url) throw new Error(`Could not read ${label}. The still has no file.`);
    const head = {};
    const token = headers?.['X-CSRF-Token'] || headers?.['x-csrf-token'];
    if (token) head['X-CSRF-Token'] = token;
    let response;
    try {
        response = await fetchImpl(located.url, { credentials: 'same-origin', headers: head });
    } catch (error) {
        throw new Error(`Could not read ${label}. ${error?.message || 'The picture did not load.'}`.trim());
    }
    if (!response?.ok) throw new Error(`Could not read ${label} (${response?.status || 'failed'}).`);
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (!buffer.length) throw new Error(`Could not read ${label}. The file was empty.`);
    const type = response.headers?.get?.('content-type') || 'image/png';
    return { mime: String(type).split(';')[0] || 'image/png', bytes: buffer };
}

function spriteExtension(mime) {
    return /jpe?g/i.test(mime || '') ? 'jpg' : 'png';
}

/** Zip approved expressions, including stills that live in SillyTavern user files. */
export async function expressionZipBytes(record, options) {
    const images = expressionFiles(record, ST_EXPRESSIONS);
    if (!images.length) throw new Error('Approve an expression still before exporting sprites.');
    const files = [];
    for (const image of images) {
        const decoded = await pictureBytes(image, options);
        const label = image.stLabel || image.label;
        files.push({
            name: `${spriteFolder(record)}/${label}.${spriteExtension(decoded.mime)}`,
            bytes: decoded.bytes,
        });
    }
    return buildStoredZip(files);
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
        const decoded = await pictureBytes(image, { fetchImpl, headers });
        const ext = spriteExtension(decoded.mime);
        const blob = new Blob([decoded.bytes], { type: decoded.mime || 'image/png' });
        const form = new FormData();
        form.append('name', folder);
        form.append('label', label);
        form.append('spriteName', label);
        form.append('avatar', blob, `${label}.${ext}`);
        let response;
        try {
            response = await fetchImpl('/api/sprites/upload', { method: 'POST', body: form, headers: head });
        } catch (error) {
            throw new Error(`Sprite upload failed for ${label}. ${error?.message || 'The sprite folder did not answer.'}`);
        }
        if (!response?.ok) {
            const text = typeof response.text === 'function' ? await response.text() : '';
            throw new Error(text || `Sprite upload failed for ${label} (${response?.status || 'failed'}).`);
        }
        uploaded.push(label);
    }
    return uploaded;
}
