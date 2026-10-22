import { SHOT_SCHEMA, buildShotListRequest, parseShotList } from './shotlist.js';
import { fetchJson } from './transport.js';

async function fromSillyTavern(requestText, systemPrompt, signal) {
    const context = globalThis.SillyTavern?.getContext?.();
    if (!context) throw new Error('SillyTavern is not available.');
    if (signal?.aborted) throw new Error('Cancelled');
    const args = {
        prompt: requestText,
        systemPrompt,
        responseLength: 1800,
        jsonSchema: SHOT_SCHEMA,
    };
    if (typeof context.generateRaw === 'function') {
        try {
            return await context.generateRaw(args);
        } catch (error) {
            if (signal?.aborted) throw error;
            return context.generateRaw({ prompt: requestText, systemPrompt, responseLength: 1800 });
        }
    }
    if (typeof context.generateQuietPrompt === 'function') {
        return context.generateQuietPrompt({
            quietPrompt: `${systemPrompt}\n\n${requestText}\n\nReply with JSON only.`,
            responseLength: 1800,
        });
    }
    throw new Error('This SillyTavern build has no generateRaw or generateQuietPrompt.');
}

export function buildChatCompletionsBody({ systemPrompt, prompt, model }) {
    return {
        model,
        temperature: 0.4,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
        ],
    };
}

async function fromChatCompletions({ url, key, model, systemPrompt, prompt, signal, mode, extraHeaders }) {
    if (!url) throw new Error('Set the OpenAI-compatible base URL.');
    if (!model) throw new Error('Set the model name.');
    const endpoint = `${url.replace(/\/+$/, '')}/chat/completions`;
    const headers = {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...extraHeaders,
    };
    const body = buildChatCompletionsBody({ systemPrompt, prompt, model });
    let response;
    try {
        response = await fetchJson(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({ ...body, response_format: { type: 'json_object' } }),
            signal,
            mode,
        });
    } catch (error) {
        if (signal?.aborted) throw error;
        response = await fetchJson(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal,
            mode,
        });
    }
    const text = response?.choices?.[0]?.message?.content;
    if (!text) throw new Error('The chat model returned no message.');
    return text;
}

export async function completeText({ systemPrompt, prompt, settings, signal, responseLength = 600 }) {
    const mode = settings.corsMode || 'auto';
    if (settings.llmSource === 'openrouter') {
        if (!settings.openrouterKey) throw new Error('Add an OpenRouter key, or switch the shot-list model back to SillyTavern.');
        return fromChatCompletions({
            url: 'https://openrouter.ai/api/v1',
            key: settings.openrouterKey,
            model: settings.openrouterTextModel || 'openrouter/auto',
            systemPrompt,
            prompt,
            signal,
            mode,
            extraHeaders: { 'X-Title': 'SillyTavern Thoughtform' },
        });
    }
    if (settings.llmSource === 'openai') {
        return fromChatCompletions({
            url: settings.openaiBaseUrl,
            key: settings.openaiKey,
            model: settings.openaiModel,
            systemPrompt,
            prompt,
            signal,
            mode,
        });
    }
    const context = globalThis.SillyTavern?.getContext?.();
    if (!context) throw new Error('SillyTavern is not available.');
    if (typeof context.generateRaw === 'function') {
        return context.generateRaw({ prompt, systemPrompt, responseLength });
    }
    if (typeof context.generateQuietPrompt === 'function') {
        return context.generateQuietPrompt({ quietPrompt: `${systemPrompt}\n\n${prompt}`, responseLength });
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
        if (!settings.openrouterKey) throw new Error('Add an OpenRouter key, or switch the shot-list model back to SillyTavern.');
        raw = await fromChatCompletions({
            url: 'https://openrouter.ai/api/v1',
            key: settings.openrouterKey,
            model: settings.openrouterTextModel || 'openrouter/auto',
            systemPrompt: built.systemPrompt,
            prompt: built.prompt,
            signal,
            mode,
            extraHeaders: { 'X-Title': 'SillyTavern Thoughtform' },
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
