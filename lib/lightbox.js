/** Full-size picture preview. No provider call. */

import { fileSrc } from './media.js';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}

/** The address a thumbnail or the overlay should load. A stored file wins once the data URL is gone. */
export function pictureSrc(image) {
    if (!image) return '';
    const direct = image.dataUrl || image.url || '';
    if (direct) return direct;
    return image.file ? fileSrc(image.file) : '';
}

export function pictureApproved(image) {
    if (!image || image.review === 'unreviewed') return false;
    return image.approved === true || image.source === 'generated';
}

export function previewButton({ set, id, key = '', label, src, imgClass = '', imgAttrs = '' }) {
    const klass = imgClass ? ` class="${escapeAttr(imgClass)}"` : '';
    const extra = imgAttrs ? ` ${imgAttrs}` : '';
    return `<button type="button" class="stsv-open-preview" data-act="open-preview" data-preview-set="${escapeAttr(set)}" data-preview-id="${escapeAttr(id)}" data-key="${escapeAttr(key)}" aria-label="View ${escapeAttr(label)} large"><img${klass} src="${escapeAttr(src)}" alt="${escapeAttr(label)}"${extra}></button>`;
}

function taggedImages(record, tags) {
    return (record?.images || []).filter((image) => {
        const list = image.tags || [];
        if (tags.includes('expression') && image.stLabel) return true;
        return tags.some((tag) => list.includes(tag));
    });
}

function libraryActions(image, { inspire = false } = {}) {
    if (inspire) return [{ act: 'delete-image', label: 'Bin' }];
    const tags = image?.tags || [];
    const actions = [];
    if (!pictureApproved(image)) actions.push({ act: 'approve-image', label: 'Approve' });
    actions.push({ act: 'redo-still', label: 'Redo' });
    if (tags.includes('expression') || tags.includes('turnaround')) {
        actions.push({ act: 'redo-wrong-outfit', label: 'Redo — wrong outfit' });
    }
    actions.push({ act: 'delete-image', label: 'Bin' });
    return actions;
}

function studioActions(item, index) {
    const itemId = String(index);
    const actions = [];
    if (!item.approved) actions.push({ act: 'approve-item', label: 'Approve', item: itemId });
    if (item.copyOf) actions.push({ act: 'make-unique', label: 'Make unique', item: itemId });
    else actions.push({ act: 'reroll-item', label: 'Redo', item: itemId });
    actions.push({ act: 'drop-item', label: 'Bin', item: itemId });
    return actions;
}

function libraryItem(image, key, inspire) {
    const src = pictureSrc(image);
    if (!src) return null;
    return {
        id: image.id,
        key,
        src,
        label: image.stLabel || image.label || 'Picture',
        actions: libraryActions(image, { inspire }),
    };
}

function redoItems(studio) {
    if (!studio) return [];
    const key = studio.recordKey || '';
    const items = [];
    if (studio.previousDataUrl) {
        items.push({
            id: 'current',
            key,
            src: studio.previousDataUrl,
            label: 'Current still',
            actions: [{ act: 'close-studio', label: 'Keep current' }],
        });
    }
    const fresh = studio.items?.[0];
    if (fresh?.dataUrl && fresh.dataUrl !== studio.previousDataUrl) {
        items.push({
            id: 'new',
            key,
            src: fresh.dataUrl,
            label: 'New still',
            actions: [
                { act: 'approve-staged', label: 'Use new' },
                { act: 'close-studio', label: 'Keep current' },
            ],
        });
    }
    return items;
}

/** Pictures in the group the thumbnail belongs to, in grid order. */
export function boardPreviewItems(record, setName, studio) {
    const key = record?.key || studio?.recordKey || '';
    if (setName === 'studio') {
        return (studio?.items || []).flatMap((item, index) => {
            if (item.dropped) return [];
            const src = pictureSrc(item);
            if (!src) return [];
            return [{
                id: String(index),
                key,
                src,
                label: item.stLabel || item.label || 'Still',
                actions: studioActions(item, index),
            }];
        });
    }
    if (setName === 'redo') return redoItems(studio);
    let images = record?.images || [];
    let inspire = false;
    if (setName === 'expressions') {
        images = taggedImages(record, ['expression']).filter((image) => image.frame !== 'wide');
    } else if (setName === 'turn') {
        images = taggedImages(record, ['turnaround', 'pose']);
    } else if (setName === 'inspire') {
        images = images.filter((image) => image.source === 'inspiration');
        inspire = true;
    }
    return images.map((image) => libraryItem(image, key, inspire)).filter(Boolean);
}

export function storyPreviewItems(scenes) {
    return (scenes || []).flatMap((scene, index) => {
        const src = pictureSrc({ dataUrl: scene?.keyframeDataUrl, file: scene?.keyframeFile });
        if (!src) return [];
        const approved = Boolean(scene.keyframeApproved);
        return [{
            id: String(index),
            key: '',
            src,
            label: scene.title || `Scene ${index + 1}`,
            actions: [
                { act: 'approve-keyframe', label: approved ? 'Approved' : 'Approve', scene: String(index), disabled: approved },
                { act: 'redo-keyframe', label: 'Redo', scene: String(index) },
            ],
        }];
    });
}

export function previewAt(items, id, fallbackIndex = 0) {
    if (!items?.length) return null;
    const found = items.findIndex((item) => item.id === id);
    const index = found >= 0 ? found : Math.min(Math.max(fallbackIndex, 0), items.length - 1);
    return { index, item: items[index] };
}

export function previewStep(items, id, delta) {
    const located = previewAt(items, id, 0);
    if (!located) return null;
    const index = Math.min(items.length - 1, Math.max(0, located.index + delta));
    return { index, item: items[index] };
}

export function fitZoom() {
    return { mode: 'fit', scale: 1, x: 0, y: 0 };
}

export function toggleZoom(zoom) {
    if (!zoom || zoom.mode === 'fit') return { mode: 'actual', scale: 1, x: 0, y: 0 };
    return fitZoom();
}

function clampScale(value) {
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));
}

export function wheelZoom(zoom, deltaY) {
    const base = !zoom || zoom.mode === 'fit' ? 1 : (zoom.scale || 1);
    const factor = deltaY < 0 ? 1.12 : (1 / 1.12);
    return {
        mode: 'custom',
        scale: clampScale(base * factor),
        x: zoom?.x || 0,
        y: zoom?.y || 0,
    };
}

export function pinchZoom(zoom, ratio) {
    const base = !zoom || zoom.mode === 'fit' ? 1 : (zoom.scale || 1);
    return {
        mode: 'custom',
        scale: clampScale(base * (Number(ratio) || 1)),
        x: zoom?.x || 0,
        y: zoom?.y || 0,
    };
}

export function panBy(zoom, dx, dy) {
    if (!zoom || zoom.mode === 'fit') return zoom || fitZoom();
    return { ...zoom, x: (zoom.x || 0) + dx, y: (zoom.y || 0) + dy };
}

export function zoomTransform(zoom) {
    if (!zoom || zoom.mode === 'fit') return '';
    const scale = zoom.scale || 1;
    return `translate(${Math.round(zoom.x || 0)}px, ${Math.round(zoom.y || 0)}px) scale(${scale})`;
}

function actionButton(action, item) {
    const bits = [`type="button"`, `data-act="${escapeAttr(action.act)}"`, `data-key="${escapeAttr(item.key || '')}"`];
    if (action.act === 'delete-image' || action.act === 'approve-image' || action.act === 'redo-still' || action.act === 'redo-wrong-outfit') {
        bits.push(`data-image="${escapeAttr(item.id)}"`);
    }
    if (action.item != null && action.item !== '') bits.push(`data-item="${escapeAttr(action.item)}"`);
    if (action.scene != null && action.scene !== '') bits.push(`data-scene="${escapeAttr(action.scene)}"`);
    if (action.disabled) bits.push('disabled');
    return `<button ${bits.join(' ')}>${escapeHtml(action.label)}</button>`;
}

export function lightboxMarkup(item, { index = 0, count = 1, zoom = null } = {}) {
    if (!item?.src) return '';
    const fit = !zoom || zoom.mode === 'fit';
    const place = count > 1 ? `<span class="stsv-preview-count">${index + 1} of ${count}</span>` : '';
    const actions = (item.actions || []).map((action) => actionButton(action, item)).join('');
    const transform = zoomTransform(zoom);
    return `
        <button type="button" class="stsv-preview-dismiss" data-act="close-preview" aria-label="Close preview"></button>
        <div class="stsv-preview-sheet">
            <div class="stsv-preview-head">
                <button type="button" data-act="preview-prev" aria-label="Previous picture" ${index <= 0 ? 'disabled' : ''}>Previous</button>
                <p class="stsv-preview-label">${escapeHtml(item.label)} ${place}</p>
                <button type="button" data-act="preview-next" aria-label="Next picture" ${index >= count - 1 ? 'disabled' : ''}>Next</button>
                <button type="button" data-act="close-preview">Close</button>
            </div>
            <div class="stsv-preview-stage${fit ? '' : ' is-zoomed'}" data-zoom="${fit ? 'fit' : 'actual'}">
                <img src="${escapeAttr(item.src)}" alt="${escapeAttr(item.label)}"${transform ? ` style="transform: ${escapeAttr(transform)}"` : ''}>
            </div>
            <div class="stsv-preview-bar">
                ${actions}
                <p class="stsv-hint">Click the picture for actual size.</p>
            </div>
        </div>
    `;
}
