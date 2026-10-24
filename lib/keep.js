/** Write a picture to SillyTavern's user files before the page is allowed to forget it. */

import { uploadDataUrl, uploadVideoBlob } from './attach.js';
import { addImage, newId } from './library.js';
import { fileSrc } from './media.js';
import { stillCost } from './providers/image.js';
import { formatAudShort } from './simple.js';

export function characterFolder(record) {
    const slug = String(record?.name || 'character')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'character';
    return `thoughtform/${slug}`;
}

export function storedFileName(record, label, id) {
    const folder = characterFolder(record).replace(/\//g, '_');
    const stem = String(label || 'still').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'still';
    const tail = String(id || 'still').replace(/[^a-z0-9]+/gi, '').slice(-12) || 'still';
    return `${folder}_${stem}_${tail}.jpg`;
}

export async function storeImageFile(dataUrl, { record, label, id, context, fetchImpl } = {}) {
    const name = storedFileName(record, label, id);
    const uploaded = await uploadDataUrl(dataUrl, name, context, fetchImpl);
    return {
        path: uploaded.path,
        name: uploaded.name,
        folder: characterFolder(record),
        url: fileSrc(uploaded.path),
    };
}

export async function deleteStoredFile(path, { context, fetchImpl = globalThis.fetch } = {}) {
    const clean = String(path || '').trim().replace(/^\//, '');
    if (!clean.startsWith('user/files/')) return false;
    const response = await fetchImpl('/api/files/delete', {
        method: 'POST',
        headers: context?.getRequestHeaders?.() || { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: clean }),
    });
    if (!response?.ok) {
        const text = typeof response?.text === 'function' ? await response.text() : '';
        throw new Error(text || `Could not delete ${clean}.`);
    }
    return true;
}

/** saveSettingsDebounced is lazy. Flush it, and any host hook, before the next await. */
export async function flushSettings(context) {
    const save = context?.saveSettingsDebounced;
    if (typeof save?.flush === 'function') {
        const result = save.flush();
        if (result && typeof result.then === 'function') await result;
    } else if (typeof save === 'function') {
        const result = save();
        if (result && typeof result.then === 'function') await result;
    }
    if (typeof context?.flushExtensionSettings === 'function') {
        const result = context.flushExtensionSettings();
        if (result && typeof result.then === 'function') await result;
    }
    const meta = context?.saveMetadataDebounced;
    if (typeof meta?.flush === 'function') {
        const result = meta.flush();
        if (result && typeof result.then === 'function') await result;
    } else if (typeof meta === 'function') {
        const result = meta();
        if (result && typeof result.then === 'function') await result;
    }
}

export function snapshotSuite(studio) {
    if (!studio) return null;
    return {
        stage: studio.stage || 'results',
        items: (studio.items || []).map((item) => {
            const file = item.file || '';
            const shown = String(item.dataUrl || '');
            const url = file ? fileSrc(file) : (shown.startsWith('/') || shown.startsWith('user/') ? fileSrc(shown) : '');
            const arrived = Boolean(file || url);
            return {
                id: item.imageId || item.id || '',
                label: item.label || '',
                tags: item.tags || [],
                stLabel: item.stLabel || '',
                copyOf: item.copyOf || '',
                prompt: item.prompt || '',
                aspectRatio: item.aspectRatio || '',
                cacheKey: item.cacheKey || '',
                file,
                folder: item.folder || '',
                url,
                error: item.error || '',
                skipped: Boolean(item.skipped),
                dropped: Boolean(item.dropped),
                approved: item.review === 'approved' || item.approved === true,
                review: item.review || (item.approved ? 'approved' : (arrived ? 'unreviewed' : '')),
            };
        }),
    };
}

export function sessionRestore(run, { modelId = 'mock' } = {}) {
    const items = (run?.items || []).filter((item) => !item.dropped);
    const pictures = items.filter((item) => !item.copyOf && (item.file || item.url));
    const left = items.filter((item) => !item.copyOf && !item.file && !item.url && !item.error);
    if (!pictures.length && !left.length) return null;
    const restored = pictures.length
        ? `Restored ${pictures.length} picture${pictures.length === 1 ? '' : 's'} from your last session`
        : '';
    let resume = '';
    if (left.length) {
        const cost = stillCost(left.length, modelId);
        const price = cost.usd == null ? (cost.label || 'Check provider') : formatAudShort(cost.usd);
        resume = `Resume (${left.length} left, ~${price})`;
    }
    return { restored, resume, left: left.length, count: pictures.length };
}

export function studioFromSnapshot(record) {
    const run = record?.suiteRun;
    if (!run?.items?.length) return null;
    return {
        stage: 'results',
        recordKey: record.key,
        restored: true,
        items: run.items.map((item) => ({
            ...item,
            imageId: item.id,
            dataUrl: item.url || (item.file ? fileSrc(item.file) : ''),
            approved: item.review === 'approved' || item.approved === true,
            review: item.review || (item.approved ? 'approved' : ((item.file || item.url) ? 'unreviewed' : '')),
        })),
    };
}

function samePicture(image, id, cacheKey, label) {
    if (id && image.id === id) return true;
    if (cacheKey && image.cacheKey === cacheKey && image.label === label) return true;
    return false;
}

/** Park the file on the character before the studio draws it. Unreviewed is still kept. */
export function parkPicture(record, fields) {
    const id = fields.id || newId('img');
    const existing = (record.images || []).find((image) => samePicture(image, id, fields.cacheKey, fields.label));
    const next = {
        ...fields,
        id: existing?.id || id,
        dataUrl: fields.file ? '' : (fields.dataUrl || ''),
        url: fields.url || (fields.file ? fileSrc(fields.file) : ''),
        source: fields.source || 'generated',
        review: fields.review || 'unreviewed',
        approved: fields.review === 'approved',
    };
    if (existing) {
        Object.assign(existing, next, { id: existing.id });
        return existing;
    }
    return addImage(record, next);
}

export async function keepGeneratedPicture(env, record, item, dataUrl) {
    if (!record || !item || !dataUrl) return dataUrl;
    const id = item.imageId || item.id || newId('img');
    item.imageId = id;
    let file = item.file || '';
    let url = '';
    let folder = characterFolder(record);
    const alreadyStored = file && !String(dataUrl).startsWith('data:');
    if (!alreadyStored && String(dataUrl).startsWith('data:')) {
        try {
            const stored = await storeImageFile(dataUrl, {
                record,
                label: item.stLabel || item.label,
                id,
                context: env.sillyContext?.() || env.context,
                fetchImpl: env.fetchImpl || globalThis.fetch,
            });
            file = stored.path;
            url = stored.url;
            folder = stored.folder;
        } catch (error) {
            item.storeError = error?.message || 'Could not store the picture.';
        }
    } else if (file) {
        url = fileSrc(file);
    } else if (String(dataUrl).startsWith('/') || String(dataUrl).startsWith('user/')) {
        url = fileSrc(dataUrl);
        file = String(dataUrl).replace(/^\//, '');
    }
    item.file = file;
    item.folder = folder;
    item.review = item.review === 'approved' ? 'approved' : 'unreviewed';
    item.dataUrl = url || dataUrl;
    parkPicture(record, {
        id,
        dataUrl: file ? '' : dataUrl,
        url: url || item.dataUrl,
        file,
        folder,
        label: item.label || '',
        tags: item.tags || [],
        stLabel: item.stLabel || '',
        copyOf: item.copyOf || '',
        prompt: item.prompt || '',
        cacheKey: item.cacheKey || '',
        aspectRatio: item.aspectRatio || '',
        width: item.width || 0,
        height: item.height || 0,
        portrait: item.portrait === true,
        cropOf: item.cropOf || '',
        frame: item.frame || '',
        medium: item.medium || '',
        source: 'generated',
        review: item.review,
        outfitId: item.outfitId || '',
    });
    const studio = env.studio?.();
    if (studio?.recordKey === record.key) record.suiteRun = snapshotSuite(studio);
    if (env.flush) await env.flush();
    else await flushSettings(env.sillyContext?.() || env.context);
    return item.dataUrl;
}

export function linkCopiedPictures(record, items) {
    let changed = false;
    for (const copy of items || []) {
        if (!copy.copyOf || copy.file) continue;
        const sourceName = String(copy.copyOf).toLowerCase();
        const source = items.find((other) => !other.copyOf && String(other.stLabel || other.label || '').toLowerCase() === sourceName);
        if (!source?.file) continue;
        copy.file = source.file;
        copy.folder = source.folder || '';
        copy.dataUrl = fileSrc(source.file);
        copy.review = 'unreviewed';
        copy.imageId = copy.imageId || newId('img');
        parkPicture(record, {
            id: copy.imageId,
            url: copy.dataUrl,
            file: copy.file,
            folder: copy.folder,
            label: copy.label || '',
            tags: copy.tags || [],
            stLabel: copy.stLabel || '',
            copyOf: copy.copyOf,
            prompt: copy.prompt || '',
            cacheKey: source.cacheKey || '',
            source: 'generated',
            review: 'unreviewed',
        });
        changed = true;
    }
    return changed;
}

export async function keepClip(blob, { scene, index, context, fetchImpl } = {}) {
    if (!blob) return null;
    const uploaded = await uploadVideoBlob(blob, `thoughtform-scene-${index + 1}-${Date.now()}`, context, fetchImpl);
    if (scene) scene.clipFile = uploaded.path;
    await flushSettings(context);
    return uploaded;
}
