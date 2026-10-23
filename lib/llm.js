import { missingKey } from './debug.js';
import { textSettingsFor } from './models.js';
import { SHOT_SCHEMA, buildShotListRequest, parseShotList } from './shotlist.js';
import { fetchJson } from './transport.js';

async function fromSillyTavern(requestText, systemPrompt, signal, image = '') {
    const context = globalThis.SillyTavern?.getContext?.();
    if (!context) throw new Error('SillyTavern is not available.');
    if (signal?.aborted) throw new Error('Cancelled');
    const args = {
        prompt: requestText,
        systemPrompt,
        responseLength: 1800,
        jsonSchema: SHOT_SCHEMA,
        ...(image ? { image } : {}),
    };
    if (typeof context.generateRaw === 'function') {
        // One call. A schema failure is not sent again until the user clicks Write shot list.
        return context.generateRaw(args);
    }
    if (typeof context.generateQuietPrompt === 'function') {
        return context.generateQuietPrompt({
            quietPrompt: `${systemPrompt}\n\n${requestText}\n\nReply with JSON only.`,
            responseLength: 1800,
        });
    }
    throw new Error('This SillyTavern build has no generateRaw or generateQuietPrompt.');
}

export function buildChatCompletionsBody({ systemPrompt, prompt, model, image = '' }) {
    const content = image
        ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: image } }]
        : prompt;
    return {
        model,
        temperature: image ? 0.2 : 0.4,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content },
        ],
    };
}

async function fromChatCompletions({ url, key, model, systemPrompt, prompt, signal, mode, extraHeaders, provider = '', step = '', image = '' }) {
    if (!url) throw new Error('Set the OpenAI-compatible base URL.');
    if (!model) throw new Error('Set the model name.');
    const endpoint = `${url.replace(/\/+$/, '')}/chat/completions`;
    const headers = {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...extraHeaders,
    };
    const body = buildChatCompletionsBody({ systemPrompt, prompt, model, image });
    const response = await fetchJson(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
        mode,
        provider,
        step,
    });
    const text = response?.choices?.[0]?.message?.content;
    if (!text) throw new Error('The chat model returned no message.');
    return text;
}

export async function completeText({ systemPrompt, prompt, settings, signal, responseLength = 600, image = '' }) {
    const effective = textSettingsFor(settings, { image });
    const mode = effective.corsMode || 'auto';
    if (effective.llmSource === 'openrouter') {
        if (!String(effective.openrouterKey || '').trim()) throw missingKey('openrouter', 'text', 'No OpenRouter key yet.');
        return fromChatCompletions({
            url: 'https://openrouter.ai/api/v1',
            key: effective.openrouterKey,
            model: effective.openrouterTextModel || 'openrouter/auto',
            systemPrompt,
            prompt,
            signal,
            mode,
            extraHeaders: { 'X-Title': 'SillyTavern Thoughtform' },
            provider: 'openrouter',
            step: 'text',
            image,
        });
    }
    if (effective.llmSource === 'openai') {
        return fromChatCompletions({
            url: effective.openaiBaseUrl,
            key: effective.openaiKey,
            model: effective.openaiModel,
            systemPrompt,
            prompt,
            signal,
            mode,
            provider: 'openai',
            step: 'text',
            image,
        });
    }
    const context = globalThis.SillyTavern?.getContext?.();
    if (!context) throw new Error('SillyTavern is not available.');
    if (typeof context.generateRaw === 'function') {
        return context.generateRaw({ prompt, systemPrompt, responseLength, ...(image ? { image } : {}) });
    }
    if (typeof context.generateQuietPrompt === 'function') {
        return context.generateQuietPrompt({ quietPrompt: `${systemPrompt}\n\n${prompt}`, responseLength, ...(image ? { image } : {}) });
    }
    throw new Error('This SillyTavern build has no generateRaw or generateQuietPrompt.');
}

export async function generateShotList({ messages, cast, settings, signal, hasReferenceImage, wardrobeText = '', continuityText = '' }) {
    const built = buildShotListRequest({
        messages,
        cast,
        settings: { ...settings, hasReferenceImage },
        wardrobeText,
        continuityText,
    });
    const mode = settings.corsMode || 'auto';
    let raw = '';
    if (settings.llmSource === 'openrouter') {
        if (!String(settings.openrouterKey || '').trim()) throw missingKey('openrouter', 'shot list', 'No OpenRouter key yet.');
        raw = await fromChatCompletions({
            url: 'https://openrouter.ai/api/v1',
            key: settings.openrouterKey,
            model: settings.openrouterTextModel || 'openrouter/auto',
            systemPrompt: built.systemPrompt,
            prompt: built.prompt,
            signal,
            mode,
            extraHeaders: { 'X-Title': 'SillyTavern Thoughtform' },
            provider: 'openrouter',
            step: 'shot list',
        });
    } else if (settings.llmSource === 'openai') {
        raw = await fromChatCompletions({
            url: settings.openaiBaseUrl,
            key: settings.openaiKey,
            model: settings.openaiModel,
            systemPrompt: built.systemPrompt,
            prompt: built.prompt,
            signal,
            mode,
            provider: 'openai',
            step: 'shot list',
        });
    } else {
        raw = await fromSillyTavern(built.prompt, built.systemPrompt, signal);
    }
    return {
        scenes: parseShotList(raw, { fallbackSeconds: Number(settings.secondsPerScene) || 5 }),
        raw,
        source: settings.llmSource || 'sillytavern',
    };
}
