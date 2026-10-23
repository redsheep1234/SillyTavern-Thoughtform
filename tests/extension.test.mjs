import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { estimateCost } from '../lib/cost.js';
import { explainError } from '../lib/debug.js';
import { comfyHardwareNote } from '../lib/providers/comfyui.js';
import { imagesForPrompt } from '../lib/library.js';
import { defaultSettings } from '../lib/constants.js';
import { applySceneToWorkflow, detectMapping, parseWorkflowJson } from '../lib/comfy/workflow.js';
import { buildFalBody } from '../lib/providers/fal.js';
import { buildCustomRequest } from '../lib/providers/custom.js';
import { buildOpenRouterVideoBody, OPENROUTER_VIDEO_MODELS } from '../lib/providers/openrouter.js';
import { providers } from '../lib/providers/registry.js';
import { buildXaiBody, generateXai } from '../lib/providers/xai.js';
import { applyQualityPreset, getQualityPreset } from '../lib/presets.js';
import { ensureSettings } from '../lib/settings.js';
import { buildShotListRequest, localShotList, parseShotList } from '../lib/shotlist.js';
import { buildXfadeFilter, clipSeconds, safeFade } from '../lib/stitch.js';
import { toProxyUrl, transportAttempts } from '../lib/transport.js';
import { frameCount, getByPath, safeFileName } from '../lib/util.js';

test('index loads without SillyTavern', async () => {
    const module = await import('../index.js');
    assert.equal(typeof module.onActivate, 'function');
    assert.equal(globalThis.SillyTavern, undefined);
});

test('provider order matches the October 2026 browser matrix', () => {
    assert.equal(providers[0].id, 'xai');
    assert.equal(providers.find((provider) => provider.id === 'openrouter').cors, 'direct');
    assert.equal(providers.at(-1).id, 'replicate');
    assert.equal(providers.at(-1).requiresProxy, true);
    assert.equal(OPENROUTER_VIDEO_MODELS.some((model) => /sora/i.test(model.id)), false);
    assert.ok(OPENROUTER_VIDEO_MODELS.some((model) => model.id === 'x-ai/grok-imagine-video-1.5-lite'));
    assert.ok(OPENROUTER_VIDEO_MODELS.some((model) => model.id === 'alibaba/wan-3.0'));
});

test('draft preset is 480p on xAI Lite', () => {
    const settings = structuredClone(defaultSettings);
    applyQualityPreset(settings, 'draft');
    assert.equal(settings.quality, 'draft');
    assert.equal(settings.resolution, '480p');
    assert.equal(settings.xaiModel, 'grok-imagine-video-1.5-lite');
    assert.equal(getQualityPreset('missing'), null);
});

test('xAI Lite 720p estimate is three cents a second', () => {
    const estimate = estimateCost({
        providerId: 'xai',
        modelId: 'grok-imagine-video-1.5-lite',
        resolution: '720p',
        seconds: 5,
        sceneCount: 2,
    });
    assert.equal(estimate.usd, 0.3);
    assert.equal(estimate.label, '~$0.30');
    const unknown = estimateCost({
        providerId: 'openrouter',
        modelId: 'alibaba/wan-3.0',
        resolution: '720p',
        seconds: 5,
        sceneCount: 1,
    });
    assert.equal(unknown.known, false);
    const withStill = estimateCost({
        providerId: 'xai',
        modelId: 'grok-imagine-video-1.5-lite',
        resolution: '720p',
        seconds: 5,
        sceneCount: 1,
        imageInputs: 1,
    });
    assert.equal(withStill.usd, 0.16);
    const veo = estimateCost({
        providerId: 'openrouter',
        modelId: 'google/veo-3.1',
        resolution: '1080p',
        seconds: 5,
        sceneCount: 1,
    });
    assert.equal(veo.usd, 1);
    const veo4k = estimateCost({
        providerId: 'openrouter',
        modelId: 'google/veo-3.1',
        resolution: '4k',
        seconds: 1,
        sceneCount: 1,
    });
    assert.equal(veo4k.usd, 0.4);
    const veo720 = estimateCost({
        providerId: 'openrouter',
        modelId: 'google/veo-3.1',
        resolution: '720p',
        seconds: 5,
        sceneCount: 1,
    });
    assert.equal(veo720.known, false);
});

test('timeouts and dropped connections are plain sentences', () => {
    const timed = explainError('Timed out waiting for the video. You can try again.');
    assert.match(timed.plain, /took too long/);
    const dropped = explainError('Failed to fetch');
    assert.match(dropped.plain, /connection dropped/);
    const proxy = explainError('CORS proxy is disabled');
    assert.match(proxy.plain, /CORS proxy is off/);
});

test('an 8GB ComfyUI card is pointed at LTX-2.3', () => {
    const note = comfyHardwareNote({ devices: [{ name: 'cuda:0 RTX 3060 Ti', vram_total: 8 * 1024 ** 3 }] });
    assert.match(note, /8\.0 GB/);
    assert.match(note, /LTX-2\.3/);
    assert.match(note, /14B does not fit/);
    assert.match(comfyHardwareNote({}), /8GB/);
});

test('a missing board does not invent reference images', () => {
    assert.deepEqual(imagesForPrompt(undefined), []);
    assert.deepEqual(imagesForPrompt({ kind: 'character', images: [] }, { medium: 'anime' }), []);
});

test('xAI body clamps duration and keeps the image as a string', () => {
    const body = buildXaiBody('grok-imagine-video-1.5-lite', {
        prompt: 'A quiet street',
        negativePrompt: 'watermark',
        duration: 99,
        resolution: '480p',
        aspectRatio: '16:9',
        generateAudio: false,
        imageDataUrl: 'data:image/jpeg;base64,aaaa',
    });
    assert.equal(body.model, 'grok-imagine-video-1.5-lite');
    assert.equal(body.duration, 15);
    assert.equal(body.resolution, '480p');
    assert.equal(body.generate_audio, false);
    assert.equal(body.image, 'data:image/jpeg;base64,aaaa');
    assert.match(body.prompt, /Avoid: watermark/);
});

test('xAI polls until the video URL is ready', async () => {
    let polls = 0;
    const seen = [];
    const fetchImpl = async (url, options) => {
        seen.push({ url, method: options.method, body: options.body });
        if (String(url).endsWith('/v1/videos/generations')) {
            return json({ request_id: 'req_1' });
        }
        if (String(url).includes('/v1/videos/req_1')) {
            polls += 1;
            return json(polls === 1 ? { status: 'pending' } : { status: 'done', video: { url: 'https://cdn.example/clip.mp4' } });
        }
        if (String(url).includes('cdn.example')) {
            return new Response(Uint8Array.from([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'video/mp4' } });
        }
        throw new Error(`unexpected ${url}`);
    };
    const blob = await generateXai({
        prompt: 'rain on a window',
        duration: 5,
        resolution: '720p',
        aspectRatio: '16:9',
        settings: { xaiKey: 'test-key', xaiModel: 'grok-imagine-video-1.5-lite', corsMode: 'direct' },
        corsMode: 'direct',
        fetchImpl,
        sleep: async () => {},
    });
    assert.equal(blob.type, 'video/mp4');
    assert.equal(polls, 2);
    const submit = JSON.parse(seen[0].body);
    assert.equal(submit.model, 'grok-imagine-video-1.5-lite');
    assert.equal(submit.duration, 5);
});

test('fal Kling body snaps duration and can request the checker off', () => {
    const { body, endpoint } = buildFalBody('fal-ai/kling-video/v2.5-turbo/pro/text-to-video', {
        prompt: 'a bridge at dusk',
        duration: 6,
        aspectRatio: '16:9',
        disableSafetyChecker: true,
    });
    assert.match(endpoint, /text-to-video/);
    assert.equal(body.duration, '5');
    assert.equal(body.enable_safety_checker, false);
});

test('OpenRouter video body keeps a first frame', () => {
    const body = buildOpenRouterVideoBody('x-ai/grok-imagine-video-1.5-lite', {
        prompt: 'rain',
        duration: 5,
        resolution: '480p',
        aspectRatio: '16:9',
        imageDataUrl: 'data:image/png;base64,aaaa',
    });
    assert.equal(body.resolution, '480p');
    assert.equal(body.duration, 5);
    assert.equal(body.frame_images[0].frame_type, 'first_frame');
});

test('custom template keeps quotes and numeric duration', () => {
    const request = buildCustomRequest({
        prompt: 'say "hello"',
        negativePrompt: 'blur',
        duration: 5,
        aspectRatio: '16:9',
        resolution: '720p',
        fps: 24,
        steps: 20,
        seed: '',
        settings: {
            custom: {
                ...defaultSettings.custom,
                submitUrl: 'https://example.test/jobs',
                apiKey: 'secret',
                body: '{"prompt":"{{prompt}}","duration":"{{duration}}"}',
            },
        },
    });
    assert.equal(request.body.prompt, 'say "hello"');
    assert.equal(request.body.duration, 5);
    assert.equal(request.headers.Authorization, 'Bearer secret');
});

test('proxy URL stays a raw http target', () => {
    assert.equal(toProxyUrl('https://api.replicate.com/v1/predictions'), '/proxy/https://api.replicate.com/v1/predictions');
    assert.throws(() => toProxyUrl('javascript:alert(1)'));
});

test('a paid write is sent once and a status read may use the proxy', () => {
    assert.deepEqual(transportAttempts('POST', 'auto'), ['direct']);
    assert.deepEqual(transportAttempts('POST', 'proxy'), ['proxy']);
    assert.deepEqual(transportAttempts('GET', 'auto'), ['direct', 'proxy']);
    const llm = readFileSync(new URL('../lib/llm.js', import.meta.url), 'utf8');
    assert.doesNotMatch(llm, /generateRaw\(\{ prompt: requestText/);
    assert.doesNotMatch(llm, /response_format/);
    const image = readFileSync(new URL('../lib/providers/image.js', import.meta.url), 'utf8');
    assert.doesNotMatch(image, /retry/i);
});

test('shot list parses fenced JSON and the local split quotes the chat', () => {
    const scenes = parseShotList('```json\n{"scenes":[{"title":"Bridge","prompt":"A lantern bridge","duration":5,}]}\n```');
    assert.equal(scenes[0].title, 'Bridge');
    const messages = [1, 2, 3, 4].map((id) => ({ id, name: 'Mara', text: `Beat ${id}`, isUser: false }));
    const local = localShotList(messages, { ...defaultSettings, sceneCount: 0 });
    assert.equal(local.length, 2);
    const built = buildShotListRequest({
        messages,
        cast: { user: { name: 'You', description: '' }, characters: [{ name: 'Mara', description: 'silver hair, green coat', personality: '', scenario: '' }] },
        settings: defaultSettings,
    });
    assert.match(built.prompt, /silver hair, green coat/);
    assert.match(built.systemPrompt, /may be mature/);
});

test('settings pick up new provider fields', () => {
    const bag = {};
    const settings = ensureSettings(bag);
    assert.equal(settings.provider, 'xai');
    assert.equal(settings.xaiModel, 'grok-imagine-video-1.5-lite');
    assert.equal(typeof settings.custom.body, 'string');
    assert.match(settings.suiteOutfitDefaults.woman, /singlet/);
    assert.match(settings.suiteOutfitDefaults.neutral, /t-shirt/);
});

test('xfade offset and frame snap', () => {
    assert.match(buildXfadeFilter([5, 5], 0.4), /offset=4\.600/);
    assert.equal(clipSeconds({ blob: { recordedSeconds: 4 }, duration: 5 }), 4);
    assert.equal(safeFade([4, 4], 0.4), 0.4);
    assert.equal(safeFade([1, 4], 0.8), 0);
    assert.equal(frameCount(5, 16), 81);
    assert.equal(safeFileName('../a b.mp4'), '_a_b.mp4');
    assert.equal(getByPath({ a: { b: [{ c: 7 }] } }, 'a.b[0].c'), 7);
});

test('Wan 2.2 and LTX-2.3 workflows accept a scene', () => {
    const wan = parseWorkflowJson(readFileSync(new URL('../workflows/wan-t2v.api.json', import.meta.url), 'utf8'));
    const ltx = parseWorkflowJson(readFileSync(new URL('../workflows/ltx-2.3-t2v.api.json', import.meta.url), 'utf8'));
    for (const workflow of [wan, ltx]) {
        const applied = applySceneToWorkflow(workflow, {
            prompt: 'A lantern-lit street',
            negativePrompt: 'watermark',
            seed: 99,
            width: 1920,
            height: 1080,
            frames: 121,
            fps: 24,
            steps: 30,
        });
        assert.equal(applied.warnings.length, 0);
        const promptNode = applied.workflow[applied.mapping.prompt.node];
        assert.equal(promptNode.inputs[applied.mapping.prompt.field], 'A lantern-lit street');
        const negativeNode = applied.workflow[applied.mapping.negative.node];
        assert.equal(negativeNode.inputs[applied.mapping.negative.field], 'watermark');
        assert.ok(applied.mapping.seeds.length >= 1);
        assert.equal(applied.workflow[applied.mapping.seeds[0].node].inputs[applied.mapping.seeds[0].field], 99);
        assert.equal(applied.workflow[applied.mapping.width.node].inputs.width, 1920);
        assert.equal(applied.workflow[applied.mapping.frames.node].inputs[applied.mapping.frames.field], 121);
        for (const slot of applied.mapping.rates) {
            assert.equal(applied.workflow[slot.node].inputs[slot.field], 24);
        }
        assert.ok(applied.mapping.steps.length >= 1);
        assert.equal(applied.workflow[applied.mapping.steps[0].node].inputs.steps, 30);
    }
    const ltxMap = detectMapping(ltx);
    assert.ok(ltxMap.rates.some((slot) => slot.field === 'frame_rate'));
    assert.ok(ltxMap.rates.some((slot) => slot.field === 'fps'));
    assert.equal(ltxMap.steps[0].node, '8');
});

test('canvas workflows are rejected and Hunyuan latent size is found', () => {
    assert.throws(() => parseWorkflowJson('{"nodes":[]}'), /API Format/);
    const hunyuan = parseWorkflowJson(JSON.stringify({
        1: { class_type: 'EmptyHunyuanLatentVideo', inputs: { width: 848, height: 480, length: 73, batch_size: 1 } },
        2: { class_type: 'CLIPTextEncode', inputs: { text: 'hello' }, _meta: { title: 'Positive Prompt' } },
    }));
    const mapping = detectMapping(hunyuan);
    assert.equal(mapping.width.node, '1');
    assert.equal(mapping.frames.field, 'length');
    assert.equal(mapping.prompt.node, '2');
});

function json(body) {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}
