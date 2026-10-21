/** TTS. SillyTavern's voice map is reused. Playback can go through ElevenLabs, an OpenAI-compatible speech API, or a local beep. */

export function parseVoiceMap(ttsSettings) {
    const provider = ttsSettings?.currentProvider || ttsSettings?.provider || '';
    const nested = provider ? ttsSettings?.[provider]?.voiceMap : undefined;
    const raw = nested || ttsSettings?.voiceMap || '';
    if (raw && typeof raw === 'object') return { ...raw };
    const map = {};
    String(raw || '').split(/[,\n]/).map((part) => part.trim()).filter(Boolean).forEach((part) => {
        const split = part.split(':');
        if (split.length >= 2) map[split[0].trim()] = split.slice(1).join(':').trim();
    });
    return map;
}

export function voiceFor(name, ttsSettings, fallback = '') {
    const map = parseVoiceMap(ttsSettings);
    return map[name] || map[`${name} ("Quotes")`] || map.default || fallback || '';
}

export function sillyTavernVoices(context) {
    return context?.extensionSettings?.tts || {};
}

export function buildElevenSpeechBody(text) {
    return { text: String(text || '').slice(0, 2500), model_id: 'eleven_multilingual_v2' };
}

export function buildOpenAiSpeechBody({ text, model, voice }) {
    return {
        model: model || 'gpt-4o-mini-tts',
        voice: voice || 'alloy',
        input: String(text || '').slice(0, 4000),
    };
}

export function dialogueLines(scenes) {
    return (scenes || []).flatMap((scene, index) => {
        const lines = Array.isArray(scene.lines) && scene.lines.length
            ? scene.lines
            : String(scene.dialogue || '').split(/\n+/).map((raw) => {
                const match = String(raw).trim().match(/^([^:]{1,80}):\s*(.+)$/);
                return match ? { speaker: match[1].trim(), text: match[2].trim() } : null;
            }).filter(Boolean);
        return lines.filter((line) => line.text && line.speaker && line.speaker !== 'Narrator').map((line) => ({
            index,
            speaker: line.speaker,
            text: line.text,
        }));
    });
}

/** A short audible tone so the mock path can be mixed without a network call. */
export function toneWav(seconds = 0.4, frequency = 440) {
    const rate = 8000;
    const count = Math.max(1, Math.floor(rate * seconds));
    const data = new Uint8Array(44 + count);
    const view = new DataView(data.buffer);
    write(view, 0, 'RIFF');
    view.setUint32(4, 36 + count, true);
    write(view, 8, 'WAVE');
    write(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    write(view, 36, 'data');
    view.setUint32(40, count, true);
    for (let i = 0; i < count; i++) {
        data[44 + i] = 128 + Math.round(40 * Math.sin((2 * Math.PI * frequency * i) / rate));
    }
    return data;
}

function write(view, offset, text) {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

export async function synthesizeLine({ provider, text, voice, settings, signal, fetchImpl = globalThis.fetch }) {
    if (!text) throw new Error('There is no dialogue on this shot.');
    if (provider === 'mock' || !provider) return new Blob([toneWav()], { type: 'audio/wav' });
    if (provider === 'elevenlabs') {
        const key = settings?.elevenLabsKey || settings?.tts?.ElevenLabs?.apiKey;
        if (!key) throw new Error('Add an ElevenLabs key, or switch TTS to Mock.');
        if (!voice) throw new Error('Pick a voice, or set this character in SillyTavern’s TTS voice map.');
        const response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`, {
            method: 'POST',
            headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
            body: JSON.stringify(buildElevenSpeechBody(text)),
            signal,
        });
        if (!response.ok) throw new Error('ElevenLabs refused the speech request. Check the key and the voice id from SillyTavern’s voice map.');
        return response.blob();
    }
    const base = String(settings?.openaiBaseUrl || '').replace(/\/+$/, '');
    const key = settings?.openaiKey;
    if (!base) throw new Error('Set the OpenAI-compatible base URL for speech.');
    const response = await fetchImpl(`${base}/audio/speech`, {
        method: 'POST',
        headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' },
        body: JSON.stringify(buildOpenAiSpeechBody({ text, model: settings?.openaiTtsModel, voice })),
        signal,
    });
    if (!response.ok) throw new Error('The speech endpoint refused the request. Confirm it implements POST /audio/speech.');
    return response.blob();
}
