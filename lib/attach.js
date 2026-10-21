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

export async function uploadVideoBlob(blob, filename, context, fetchImpl = globalThis.fetch) {
    const headers = context.getRequestHeaders?.() || { 'Content-Type': 'application/json' };
    const data = await blobToBase64(blob);
    const ext = blob.type?.includes('webm') ? 'webm' : 'mp4';
    const name = safeFileName(filename.endsWith(ext) ? filename : `${filename}.${ext}`);
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

export async function attachVideoToMessage(blob, { messageId, filename, context, fetchImpl }) {
    const uploaded = await uploadVideoBlob(blob, filename, context, fetchImpl);
    const message = context.chat?.[messageId];
    if (!message) throw new Error('That message is no longer in the chat.');
    if (!message.extra || typeof message.extra !== 'object') message.extra = {};
    context.ensureMessageMediaIsArray?.(message);
    if (!Array.isArray(message.extra.media)) message.extra.media = [];
    message.extra.media.push({
        url: uploaded.path,
        type: 'video',
        title: uploaded.name,
        source: 'api',
    });
    const element = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
    if (element && context.appendMediaToMessage && globalThis.$) {
        context.appendMediaToMessage(message, globalThis.$(element));
    }
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
        mes: 'Scene video',
        extra: {
            media: [{ url: uploaded.path, type: 'video', title: uploaded.name, source: 'api' }],
        },
    };
    context.chat.push(message);
    context.addOneMessage?.(message);
    await context.saveChat?.();
    return uploaded;
}
