import assert from 'node:assert/strict';
import test from 'node:test';
import { testProviderConnection } from '../lib/connect.js';
import { MODULE_NAME, defaultSettings } from '../lib/constants.js';
import { explainError } from '../lib/debug.js';
import { completeText, generateShotList } from '../lib/llm.js';
import { pictureProviderId } from '../lib/models.js';
import { buildVeniceStillBody, generateReferenceImage, VENICE_IMAGE_ID } from '../lib/providers/image.js';
import { buildVeniceBody, generateVenice, VENICE_MODELS, VENICE_TEXT_MODEL } from '../lib/providers/venice.js';
import { ensureSettings } from '../lib/settings.js';

const FACE = 'data:image/png;base64,aaaa';
const SHEET = 'https://cdn.example/face.png';

function headers(type) {
    return { get(name) { return String(name).toLowerCase() === 'content-type' ? type : ''; } };
}

function jsonResponse(payload, status = 200) {
    const text = JSON.stringify(payload);
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: headers('application/json'),
        text: async () => text,
        json: async () => payload,
    };
}

function videoResponse(bytes) {
    const blob = new Blob([bytes], { type: 'video/mp4' });
    return {
        ok: true,
        status: 200,
        headers: headers('video/mp4'),
        blob: async () => blob,
    };
}

test('Venice picture ids stay off the OpenRouter path', () => {
    assert.equal(pictureProviderId(VENICE_IMAGE_ID), 'venice');
    assert.equal(pictureProviderId('google/gemini-2.5-flash-image'), 'openrouter');
    assert.equal(defaultSettings.veniceKey, '');
    assert.equal(defaultSettings.veniceModel, VENICE_MODELS[0].id);
    assert.equal(defaultSettings.veniceTextModel, VENICE_TEXT_MODEL);
    const saved = ensureSettings({ [MODULE_NAME]: { provider: 'xai' } });
    assert.equal(saved.veniceKey, '');
    assert.equal(saved.veniceModel, VENICE_MODELS[0].id);
});

test('a Venice still sends style references and safe_mode, then a data URL', async () => {
    const calls = [];
    const url = await generateReferenceImage({
        modelId: VENICE_IMAGE_ID,
        prompt: 'amber eyes, silver bob',
        aspectRatio: '3:4',
        negativePrompt: 'blur',
        referenceImages: [FACE, SHEET, '', 'c', 'd', 'e'],
        disableSafetyChecker: true,
        settings: { veniceKey: 'vk-test', corsMode: 'direct' },
        corsMode: 'direct',
        fetchImpl: async (target, init) => {
            calls.push({ target, init });
            return jsonResponse({ id: 'img-1', images: ['abc+/='] });
        },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].target, 'https://api.venice.ai/api/v1/image/generate');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer vk-test');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.model, 'krea-v2-large');
    assert.equal(body.safe_mode, false);
    assert.equal(body.format, 'jpeg');
    assert.equal(body.return_binary, false);
    assert.equal(body.aspect_ratio, '3:4');
    assert.equal(body.negative_prompt, 'blur');
    assert.equal(body.style_references.length, 4);
    assert.deepEqual(body.style_references[0], { image: FACE, strength: 0.5 });
    assert.equal(url, 'data:image/jpeg;base64,abc+/=');
});

test('Venice omits style references when there are none, and keeps safe_mode on', async () => {
    let body;
    await generateReferenceImage({
        modelId: VENICE_IMAGE_ID,
        prompt: 'a quiet courtyard',
        settings: { veniceKey: 'vk-test', corsMode: 'direct', disableSafetyChecker: false },
        corsMode: 'direct',
        fetchImpl: async (_target, init) => {
            body = JSON.parse(init.body);
            return jsonResponse({ images: ['zzzz'] });
        },
    });
    assert.equal(body.safe_mode, true);
    assert.equal(Object.hasOwn(body, 'style_references'), false);
    const plain = buildVeniceStillBody(
        { prompt: 'x', referenceImages: [FACE], disableSafetyChecker: true },
        { id: 'qwen-image-2', styleReferences: false, maxStyleReferences: 0 },
    );
    assert.equal(Object.hasOwn(plain, 'style_references'), false);
    assert.equal(plain.safe_mode, false);
});

test('a missing Venice key is named before any still or video call', async () => {
    let calls = 0;
    const fetchImpl = async () => {
        calls += 1;
        throw new Error('fetch should not run');
    };
    await assert.rejects(
        () => generateReferenceImage({
            modelId: VENICE_IMAGE_ID,
            prompt: 'rain',
            settings: { veniceKey: '  ', corsMode: 'direct' },
            fetchImpl,
        }),
        (error) => {
            assert.equal(error.message, 'No Venice key yet.');
            assert.equal(error.provider, 'venice');
            assert.equal(error.step, 'still');
            return true;
        },
    );
    await assert.rejects(
        () => generateVenice({ settings: { veniceKey: '' }, fetchImpl }),
        (error) => {
            assert.equal(error.message, 'No Venice key yet.');
            assert.equal(error.step, 'video');
            return true;
        },
    );
    assert.equal(calls, 0);
    const explained = explainError({ message: 'HTTP 401', provider: 'venice', step: 'still', status: 401 });
    assert.match(explained.plain, /Venice rejected the key while making the still/);
    const balance = explainError({ message: 'INSUFFICIENT_BALANCE', provider: 'venice', status: 402 });
    assert.match(balance.plain, /does not have enough credits/);
    assert.match(balance.fix, /venice\.ai\/settings\/api/);
});

test('Venice video queues, snaps duration, and polls retrieve for the mp4', async () => {
    const calls = [];
    let retrieves = 0;
    const blob = await generateVenice({
        prompt: 'A gondola at sunset',
        duration: 6,
        resolution: '4k',
        aspectRatio: '21:9',
        imageDataUrl: FACE,
        settings: { veniceKey: 'vk-test', veniceModel: VENICE_MODELS[0].id, corsMode: 'direct' },
        corsMode: 'direct',
        sleep: async () => {},
        fetchImpl: async (target, init) => {
            calls.push({ target, method: init.method, headers: init.headers, body: init.body });
            if (target.endsWith('/video/queue')) {
                return jsonResponse({ model: 'wan-2.5-preview-image-to-video', queue_id: 'job-1' });
            }
            if (target.endsWith('/video/retrieve')) {
                retrieves += 1;
                if (retrieves === 1) return jsonResponse({ status: 'PROCESSING', average_execution_time: 10, execution_duration: 1 });
                return videoResponse(Uint8Array.from([9, 8, 7, 6]));
            }
            throw new Error(`unexpected ${target}`);
        },
    });
    const queued = JSON.parse(calls[0].body);
    assert.equal(calls[0].target, 'https://api.venice.ai/api/v1/video/queue');
    assert.equal(queued.model, 'wan-2.5-preview-image-to-video');
    assert.equal(queued.duration, '5s');
    assert.equal(queued.resolution, '720p');
    assert.equal(queued.aspect_ratio, '16:9');
    assert.equal(queued.image_url, FACE);
    assert.equal(calls[0].headers.Authorization, 'Bearer vk-test');
    const retrieve = JSON.parse(calls[1].body);
    assert.equal(retrieve.queue_id, 'job-1');
    assert.equal(retrieve.model, 'wan-2.5-preview-image-to-video');
    assert.equal(blob.type, 'video/mp4');
    assert.equal(blob.size, 4);
    const snapped = buildVeniceBody(VENICE_MODELS[0].id, { duration: 8, aspectRatio: '3:4', resolution: '1080p' });
    assert.equal(snapped.body.model, VENICE_MODELS[0].id);
    assert.equal(snapped.body.duration, '10s');
    assert.equal(Object.hasOwn(snapped.body, 'image_url'), false);
});

test('a Venice download_url is fetched without the API key', async () => {
    const calls = [];
    let retrieves = 0;
    const share = 'https://private-share.venice.ai/v1/share/read/clip';
    const blob = await generateVenice({
        prompt: 'Canal',
        duration: 5,
        settings: { veniceKey: 'vk-test', corsMode: 'direct' },
        corsMode: 'direct',
        sleep: async () => {},
        fetchImpl: async (target, init) => {
            calls.push({ target, method: init.method, headers: init.headers || {} });
            if (target.endsWith('/video/queue')) {
                return jsonResponse({ model: VENICE_MODELS[0].id, queue_id: 'job-2', download_url: share });
            }
            if (target.endsWith('/video/retrieve')) {
                retrieves += 1;
                return jsonResponse({ status: 'COMPLETED', average_execution_time: 1, execution_duration: 1 });
            }
            if (target === share) return videoResponse(Uint8Array.from([1, 2, 3, 4, 5]));
            throw new Error(`unexpected ${target}`);
        },
    });
    assert.equal(retrieves, 1);
    const download = calls.find((call) => call.target === share);
    assert.equal(download.method, 'GET');
    assert.equal(download.headers.Authorization, undefined);
    assert.equal(blob.size, 5);
});

test('the shot list and describe from picture post to Venice chat', async () => {
    const calls = [];
    const fetchImpl = async (target, init) => {
        calls.push({ target, init });
        const body = JSON.parse(init.body);
        if (body.messages?.some((message) => Array.isArray(message.content))) {
            return jsonResponse({ choices: [{ message: { content: 'short silver bob, amber eyes' } }] });
        }
        return jsonResponse({
            choices: [{ message: { content: '{"scenes":[{"title":"Canal","prompt":"A gondola","duration":5}]}' } }],
        });
    };
    const settings = {
        ...defaultSettings,
        llmSource: 'venice',
        veniceKey: 'vk-test',
        corsMode: 'direct',
    };
    await assert.rejects(
        () => generateShotList({
            messages: [{ id: 1, name: 'Mara', text: 'The canal', isUser: false }],
            cast: { user: { name: 'You', description: '' }, characters: [] },
            settings: { ...settings, veniceKey: '' },
            fetchImpl,
        }),
        /No Venice key yet/,
    );
    const listed = await generateShotList({
        messages: [{ id: 1, name: 'Mara', text: 'The canal', isUser: false }],
        cast: { user: { name: 'You', description: '' }, characters: [{ name: 'Mara', description: 'amber eyes', personality: '', scenario: '' }] },
        settings,
        fetchImpl,
    });
    assert.equal(listed.scenes[0].title, 'Canal');
    assert.equal(listed.source, 'venice');
    assert.equal(calls[0].target, 'https://api.venice.ai/api/v1/chat/completions');
    const shotBody = JSON.parse(calls[0].init.body);
    assert.equal(shotBody.model, VENICE_TEXT_MODEL);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer vk-test');
    const described = await completeText({
        settings: { ...settings, llmSource: 'sillytavern', describeSource: 'venice' },
        systemPrompt: 'Describe the portrait.',
        prompt: 'What do you see?',
        image: FACE,
        fetchImpl,
    });
    assert.match(described, /amber eyes/);
    const lookBody = JSON.parse(calls[1].init.body);
    assert.equal(lookBody.model, VENICE_TEXT_MODEL);
    assert.equal(lookBody.messages[1].content[1].image_url.url, FACE);
});

test('Test connection names Venice and does not spend on a generation', async () => {
    let calls = 0;
    const empty = await testProviderConnection('venice', { veniceKey: '  ' }, async () => {
        calls += 1;
        throw new Error('fetch should not run');
    });
    assert.match(empty.message, /No Venice key yet/);
    assert.match(empty.fix, /Extensions → Thoughtform/);
    const ok = await testProviderConnection('venice', { veniceKey: 'vk-test', corsMode: 'direct' }, async (target, init) => {
        calls += 1;
        assert.equal(target, 'https://api.venice.ai/api/v1/models');
        assert.equal(init.method, 'GET');
        assert.equal(init.headers.Authorization, 'Bearer vk-test');
        return jsonResponse({ data: [] });
    });
    assert.equal(ok.ok, true);
    assert.match(ok.message, /Venice accepted the key/);
    assert.equal(calls, 1);
});
