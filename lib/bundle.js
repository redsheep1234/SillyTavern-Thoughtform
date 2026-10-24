import { addImage, emptyRecord, newId } from './library.js';

function crc32(bytes) {
    let crc = ~0;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return ~crc >>> 0;
}

function dosTime(date) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return [time, day];
}

function u16(view, offset, value) {
    view.setUint16(offset, value, true);
}

function u32(view, offset, value) {
    view.setUint32(offset, value, true);
}

/** Stored (uncompressed) zip so a character bundle can round-trip without a dependency. */
export function zipStore(files, now = new Date()) {
    const encoder = new TextEncoder();
    const [time, day] = dosTime(now);
    const locals = [];
    const central = [];
    let offset = 0;
    for (const file of files) {
        const name = encoder.encode(file.name);
        const data = file.data instanceof Uint8Array ? file.data : encoder.encode(String(file.data ?? ''));
        const crc = crc32(data);
        const local = new Uint8Array(30 + name.length + data.length);
        const view = new DataView(local.buffer);
        u32(view, 0, 0x04034b50);
        u16(view, 4, 20);
        u16(view, 6, 0x0800);
        u16(view, 8, 0);
        u16(view, 10, time);
        u16(view, 12, day);
        u32(view, 14, crc);
        u32(view, 18, data.length);
        u32(view, 22, data.length);
        u16(view, 26, name.length);
        u16(view, 28, 0);
        local.set(name, 30);
        local.set(data, 30 + name.length);
        locals.push(local);
        const entry = new Uint8Array(46 + name.length);
        const centralView = new DataView(entry.buffer);
        u32(centralView, 0, 0x02014b50);
        u16(centralView, 4, 20);
        u16(centralView, 6, 20);
        u16(centralView, 8, 0x0800);
        u16(centralView, 10, 0);
        u16(centralView, 12, time);
        u16(centralView, 14, day);
        u32(centralView, 16, crc);
        u32(centralView, 20, data.length);
        u32(centralView, 24, data.length);
        u16(centralView, 28, name.length);
        u16(centralView, 30, 0);
        u16(centralView, 32, 0);
        u16(centralView, 34, 0);
        u16(centralView, 36, 0);
        u32(centralView, 38, 0);
        u32(centralView, 42, offset);
        entry.set(name, 46);
        central.push(entry);
        offset += local.length;
    }
    const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    u32(endView, 0, 0x06054b50);
    u16(endView, 8, files.length);
    u16(endView, 10, files.length);
    u32(endView, 12, centralSize);
    u32(endView, 16, offset);
    const total = offset + centralSize + end.length;
    const zip = new Uint8Array(total);
    let cursor = 0;
    for (const part of [...locals, ...central, end]) {
        zip.set(part, cursor);
        cursor += part.length;
    }
    return zip;
}

export function unzipStore(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const files = [];
    let offset = 0;
    const decoder = new TextDecoder();
    while (offset + 30 <= bytes.length) {
        const signature = view.getUint32(offset, true);
        if (signature === 0x02014b50 || signature === 0x06054b50) break;
        if (signature !== 0x04034b50) break;
        const method = view.getUint16(offset + 8, true);
        const compressed = view.getUint32(offset + 18, true);
        const nameLength = view.getUint16(offset + 26, true);
        const extraLength = view.getUint16(offset + 28, true);
        const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
        const start = offset + 30 + nameLength + extraLength;
        const data = bytes.slice(start, start + compressed);
        if (method !== 0) throw new Error(`The zip entry ${name} is compressed. Export uses an uncompressed zip.`);
        files.push({ name, data });
        offset = start + compressed;
    }
    if (!files.length) throw new Error('The zip has no files.');
    return files;
}

function dataUrlToBytes(dataUrl) {
    const match = String(dataUrl || '').match(/^data:([^,]*),(.*)$/s);
    if (!match) return new Uint8Array();
    if (/;base64/i.test(match[1]) || match[1] === '') {
        const binary = atob(match[2]);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
        return bytes;
    }
    return new TextEncoder().encode(decodeURIComponent(match[2]));
}

function bytesToDataUrl(bytes, mime) {
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    return `data:${mime};base64,${btoa(binary)}`;
}

export function exportBundle(record) {
    return {
        version: 1,
        kind: 'scene-video-character',
        character: {
            name: record.name,
            kind: record.kind,
            stName: record.stName,
            appearance: record.appearance,
            bodyLine: record.bodyLine || '',
            bodyRefId: record.bodyRefId || '',
            sourceKey: record.sourceKey || '',
            relation: record.relation || '',
            traits: record.traits || {},
            nameLocked: Boolean(record.nameLocked),
            sourceMedium: record.sourceMedium || '',
            variantText: record.variantText || {},
            variantPrimary: record.variantPrimary || {},
            defaultOutfitId: record.defaultOutfitId,
            loraName: record.loraName || '',
            loraStrength: record.loraStrength ?? 0.8,
            outfits: (record.outfits || []).map((outfit) => ({
                id: outfit.id,
                name: outfit.name,
                description: outfit.description || '',
            })),
            images: (record.images || []).map((image) => ({
                id: image.id,
                tags: image.tags || [],
                label: image.label || '',
                outfitId: image.outfitId || '',
                source: image.source || '',
                role: image.role || '',
                prompt: image.prompt || '',
                stLabel: image.stLabel || '',
                medium: image.medium || '',
                cacheKey: image.cacheKey || '',
                dataUrl: image.dataUrl || '',
                primary: image.id === record.primaryId,
            })),
        },
    };
}

export function importBundle(library, bundle, { key } = {}) {
    if (!bundle || bundle.kind !== 'scene-video-character' || !bundle.character) {
        throw new Error('That file is not a Thoughtform character bundle.');
    }
    const data = bundle.character;
    const recordKey = key || `board:${newId('board')}`;
    const record = library.records[recordKey] || emptyRecord({
        key: recordKey,
        name: data.name || 'Imported',
        kind: data.kind || 'board',
        stName: data.stName || data.name || 'Imported',
    });
    record.appearance = data.appearance || record.appearance;
    record.bodyLine = data.bodyLine || record.bodyLine || '';
    record.bodyRefId = data.bodyRefId || record.bodyRefId || '';
    record.sourceKey = data.sourceKey || record.sourceKey || '';
    record.relation = data.relation || record.relation || '';
    record.traits = data.traits || record.traits || {};
    record.nameLocked = Boolean(data.nameLocked || record.nameLocked);
    record.sourceMedium = data.sourceMedium || record.sourceMedium || '';
    record.variantText = data.variantText || record.variantText || {};
    record.variantPrimary = data.variantPrimary || record.variantPrimary || {};
    record.loraName = data.loraName || '';
    record.loraStrength = Number(data.loraStrength) || 0.8;
    record.outfits = (data.outfits || []).map((outfit) => ({
        id: outfit.id || newId('outfit'),
        name: outfit.name || 'Outfit',
        description: outfit.description || '',
    }));
    record.defaultOutfitId = record.outfits.some((outfit) => outfit.id === data.defaultOutfitId)
        ? data.defaultOutfitId
        : (record.outfits[0]?.id || '');
    record.images = [];
    record.primaryId = '';
    for (const image of data.images || []) {
        if (!image.dataUrl) continue;
        const saved = addImage(record, {
            id: image.id || newId('img'),
            dataUrl: image.dataUrl,
            tags: image.tags || [],
            label: image.label || '',
            outfitId: image.outfitId || '',
            source: image.source || 'import',
            role: image.role || '',
            prompt: image.prompt || '',
            stLabel: image.stLabel || '',
            medium: image.medium || '',
            cacheKey: image.cacheKey || '',
        });
        if (image.primary) record.primaryId = saved.id;
        const medium = image.medium || data.sourceMedium || '';
        if (medium && data.variantPrimary?.[medium] === image.id) {
            record.variantPrimary[medium] = saved.id;
        }
    }
    library.records[record.key] = record;
    return record;
}

export function bundleToZip(record) {
    const bundle = exportBundle(record);
    const files = [];
    for (const image of bundle.character.images) {
        if (!image.dataUrl) continue;
        const mime = /^data:([^;,]+)/.exec(image.dataUrl)?.[1] || 'image/jpeg';
        const ext = mime.includes('png') ? 'png' : 'jpg';
        const name = `images/${image.id}.${ext}`;
        files.push({ name, data: dataUrlToBytes(image.dataUrl) });
        image.file = name;
        image.mime = mime;
        delete image.dataUrl;
    }
    const manifest = new TextEncoder().encode(JSON.stringify(bundle, null, 2));
    return zipStore([{ name: 'manifest.json', data: manifest }, ...files]);
}

export function bundleFromZip(bytes) {
    const files = unzipStore(bytes);
    const manifestFile = files.find((file) => file.name === 'manifest.json');
    if (!manifestFile) throw new Error('The zip has no manifest.json.');
    const bundle = JSON.parse(new TextDecoder().decode(manifestFile.data));
    const byName = new Map(files.map((file) => [file.name, file]));
    for (const image of bundle.character?.images || []) {
        if (image.dataUrl || !image.file) continue;
        const file = byName.get(image.file);
        if (!file) continue;
        image.dataUrl = bytesToDataUrl(file.data, image.mime || 'image/jpeg');
    }
    return bundle;
}
