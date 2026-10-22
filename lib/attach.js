import { safeFileName } from './util.js';

export function buildFileUploadBody(filename, base64) {
    return { name: safeFileName(filename), data: base64 };
}

export function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const value = String(reader.result || '');
            const comma = value.indexOf(',');
            resolve(comma >= 0 ? value.slice(comma + 1) : value);
        };
        reader.onerror = () => reject(new Error('Could not read the video.'));
        reader.readAsDataURL(blob);
    });
}

async function uploadBase64(name, data, context, fetchImpl) {
    const headers = context?.getRequestHeaders?.() || { 'Content-Type': 'application/json' };
    const response = await fetchImpl('/api/files/upload', {
        method: 'POST',
        headers,
        body: JSON.stringify(buildFileUploadBody(name, data)),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Upload failed (${response.status}).`);
    }
    const payload = await response.json();
    if (!payload?.path) throw new Error('SillyTavern did not return a file path.');
    return { path: payload.path, name };
}

export async function uploadVideoBlob(blob, filename, context, fetchImpl = globalThis.fetch) {
    const data = await blobToBase64(blob);
    const ext = blob.type?.includes('webm') ? 'webm' : 'mp4';
    const name = safeFileName(filename.endsWith(ext) ? filename : `${filename}.${ext}`);
    return uploadBase64(name, data, context, fetchImpl);
}

export async function uploadDataUrl(dataUrl, filename, context, fetchImpl = globalThis.fetch) {
    const value = String(dataUrl || '');
    const comma = value.indexOf(',');
    const data = comma >= 0 ? value.slice(comma + 1) : value;
    const base = String(filename || 'scene-still');
    const name = safeFileName(base.endsWith('.jpg') || base.endsWith('.png') || base.endsWith('.webp') ? base : `${base}.jpg`);
    return uploadBase64(name, data, context, fetchImpl);
}

export function appendMessageMedia(message, entry, context) {
    if (!message || !entry?.url) return false;
    if (!message.extra || typeof message.extra !== 'object') message.extra = {};
    context?.ensureMessageMediaIsArray?.(message);
    if (!Array.isArray(message.extra.media)) message.extra.media = [];
    if (message.extra.media.some((item) => item.url === entry.url && item.type === entry.type)) return false;
    message.extra.media.push({
        url: entry.url,
        type: entry.type || 'image',
        title: entry.title || '',
        source: 'api',
    });
    return true;
}

export function paintMessageMedia(message, messageId, context) {
    if (typeof document === 'undefined' || messageId == null) return;
    const element = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
    if (element && context?.appendMediaToMessage && globalThis.$) {
        context.appendMediaToMessage(message, globalThis.$(element));
    }
}

export async function attachImageDataUrl(dataUrl, { messageId, filename, context, fetchImpl = globalThis.fetch }) {
    const uploaded = await uploadDataUrl(dataUrl, filename, context, fetchImpl);
    const message = context.chat?.[messageId];
    if (!message) throw new Error('That message is no longer in the chat.');
    appendMessageMedia(message, { url: uploaded.path, type: 'image', title: uploaded.name }, context);
    paintMessageMedia(message, messageId, context);
    await context.saveChat?.();
    return uploaded;
}

export async function attachVideoToMessage(blob, { messageId, filename, context, fetchImpl }) {
    const uploaded = await uploadVideoBlob(blob, filename, context, fetchImpl);
    const message = context.chat?.[messageId];
    if (!message) throw new Error('That message is no longer in the chat.');
    appendMessageMedia(message, { url: uploaded.path, type: 'video', title: uploaded.name }, context);
    paintMessageMedia(message, messageId, context);
    await context.saveChat?.();
    return uploaded;
}

export async function attachVideoAsNewMessage(blob, { filename, context, fetchImpl }) {
    const uploaded = await uploadVideoBlob(blob, filename, context, fetchImpl);
    const message = {
        name: context.name1 || 'You',
        is_user: true,
        is_system: false,
        send_date: context.humanizedDateTime?.() || new Date().toISOString(),
        mes: 'Thoughtform',
        extra: {
            media: [{ url: uploaded.path, type: 'video', title: uploaded.name, source: 'api' }],
        },
    };
    context.chat.push(message);
    context.addOneMessage?.(message);
    await context.saveChat?.();
    return uploaded;
}
