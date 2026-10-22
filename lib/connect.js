import { fetchJson, providerFetch } from './transport.js';
import { explainError } from './debug.js';

function explained(error) {
    const text = explainError(error?.message || error);
    return { ok: false, message: text.plain, fix: text.fix };
}

export async function testProviderConnection(providerId, settings, fetchImpl = globalThis.fetch) {
    const mode = settings?.corsMode || 'auto';
    try {
        if (providerId === 'mock') return { ok: true, message: 'Mock provider is local. No network call.' };
        if (providerId === 'xai') {
            if (!settings?.xaiKey) return { ok: false, message: 'No xAI key yet.', fix: 'Add the key under Extensions → Thoughtform.' };
            await fetchJson('https://api.x.ai/v1/models', { method: 'GET', headers: { Authorization: `Bearer ${settings.xaiKey}` }, mode, fetchImpl });
            return { ok: true, message: 'xAI accepted the key.' };
        }
        if (providerId === 'openrouter') {
            if (!settings?.openrouterKey) return { ok: false, message: 'No OpenRouter key yet.', fix: 'Add the key under Extensions → Thoughtform.' };
            await fetchJson('https://openrouter.ai/api/v1/videos/models', { method: 'GET', headers: { Authorization: `Bearer ${settings.openrouterKey}` }, mode, fetchImpl });
            return { ok: true, message: 'OpenRouter accepted the key.' };
        }
        if (providerId === 'fal') {
            if (!settings?.falKey) return { ok: false, message: 'No fal.ai key yet.', fix: 'Add the key under Extensions → Thoughtform.' };
            const response = await providerFetch('https://queue.fal.run/', {
                method: 'GET',
                headers: { Authorization: `Key ${settings.falKey}` },
                mode,
                fetchImpl,
            });
            if (response.status === 401 || response.status === 403) return { ok: false, message: 'fal.ai rejected the key.', fix: 'Check the key under Extensions → Thoughtform.' };
            return { ok: true, message: `fal.ai answered (${response.status}).` };
        }
        if (providerId === 'replicate') {
            if (!settings?.replicateKey) return { ok: false, message: 'No Replicate token yet.', fix: 'Add the token, and enable SillyTavern’s CORS proxy.' };
            await fetchJson('https://api.replicate.com/v1/account', { method: 'GET', headers: { Authorization: `Bearer ${settings.replicateKey}` }, mode: 'proxy', fetchImpl });
            return { ok: true, message: 'Replicate accepted the token through the proxy.' };
        }
        if (providerId === 'comfyui') {
            const base = String(settings?.comfyUrl || '').replace(/\/+$/, '');
            if (!base) return { ok: false, message: 'Set the ComfyUI URL.', fix: 'Use a ComfyUI you started with --enable-cors-header *, and keep that port private.' };
            await fetchJson(`${base}/system_stats`, { method: 'GET', mode: 'direct', fetchImpl });
            return { ok: true, message: 'ComfyUI system_stats responded.' };
        }
        if (providerId === 'custom') {
            if (!settings?.custom?.submitUrl) return { ok: false, message: 'Set a submit URL first.', fix: 'Custom hosts have no shared ping. A GET is sent to the submit URL.' };
            const response = await providerFetch(settings.custom.submitUrl, { method: 'GET', mode, fetchImpl });
            return { ok: response.ok, message: `Custom host answered (${response.status}).` };
        }
        return { ok: false, message: 'Unknown provider.' };
    } catch (error) {
        return explained(error);
    }
}
