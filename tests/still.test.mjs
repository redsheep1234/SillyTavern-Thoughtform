import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { defaultSettings } from '../lib/constants.js';
import { keyframeForVideo, planSceneImages } from '../lib/consistency.js';
import { createJobLock, jobButtonLabel } from '../lib/job-lock.js';
import { imageFromOpenRouter, isImageReference, generateReferenceImage } from '../lib/providers/image.js';
import { buildVideoCall } from '../lib/scene-request.js';

const CARD = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PHOTO = 'https://cdn.example/still.png';

test('OpenRouter prose is not an image', () => {
    assert.equal(imageFromOpenRouter({
        choices: [{ message: { content: 'silver bob in the rain' } }],
    }), '');
    assert.equal(imageFromOpenRouter({
        choices: [{ message: { content: 'A portrait. ![alt](not a url)' } }],
    }), '');
    assert.equal(isImageReference('silver bob in the rain'), false);
    assert.equal(isImageReference(CARD), true);
    assert.equal(isImageReference(PHOTO), true);
});

test('OpenRouter image parts and images payloads are kept', () => {
    assert.equal(imageFromOpenRouter({
        choices: [{ message: { images: [{ image_url: { url: CARD } }] } }],
    }), CARD);
    assert.equal(imageFromOpenRouter({
        choices: [{ message: { content: [{ type: 'text', text: 'prompt' }, { type: 'image_url', image_url: { url: PHOTO } }] } }],
    }), PHOTO);
    assert.equal(imageFromOpenRouter({
        data: [{ b64_json: 'aaaa', media_type: 'image/png' }],
    }), 'data:image/png;base64,aaaa');
    assert.equal(imageFromOpenRouter({
        choices: [{ message: { content: `done ![still](${CARD})` } }],
    }), CARD);
});

test('a text-only OpenRouter still is one request and an error', async () => {
    let calls = 0;
    await assert.rejects(
        () => generateReferenceImage({
            modelId: 'google/gemini-2.5-flash-image',
            prompt: 'silver bob in the rain',
            settings: { openrouterKey: 'test-key', corsMode: 'direct' },
            corsMode: 'direct',
            fetchImpl: async () => {
                calls += 1;
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ choices: [{ message: { content: 'silver bob in the rain' } }] }),
                    text: async () => '',
                };
            },
        }),
        /no image/i,
    );
    assert.equal(calls, 1);
});

test('mock text cards stay out of paid video calls', () => {
    assert.deepEqual(keyframeForVideo({ providerId: 'fal', keyframe: CARD, keyframeMock: true }), {
        imageDataUrl: '',
        dropped: 'mock',
    });
    assert.equal(keyframeForVideo({ providerId: 'mock', keyframe: CARD, keyframeMock: true }).imageDataUrl, CARD);
    assert.equal(keyframeForVideo({ providerId: 'xai', keyframe: 'silver bob in the rain', keyframeMock: false }).dropped, 'text');
    const dropped = planSceneImages({
        providerId: 'openrouter',
        modelId: 'google/veo-3.1',
        mode: 'keyframe',
        keyframe: CARD,
        keyframeMock: true,
    });
    assert.equal(dropped.imageDataUrl, '');
    assert.match(dropped.note, /mock text card/);
    const kept = planSceneImages({
        providerId: 'fal',
        modelId: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
        mode: 'keyframe',
        keyframe: CARD,
        keyframeMock: true,
        references: [PHOTO],
    });
    assert.equal(kept.imageDataUrl, PHOTO);
    assert.doesNotMatch(kept.imageDataUrl, /silver bob/);
    const call = buildVideoCall({
        scene: {
            keyframeApproved: true,
            keyframeDataUrl: CARD,
            keyframeMock: true,
            cast: [],
            prompt: 'rain on the bridge',
            title: 'Rain',
            duration: 5,
        },
        settings: { ...defaultSettings, consistency: 'keyframe', imageModel: 'mock', provider: 'fal' },
        records: [],
        providerId: 'fal',
        modelId: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
    });
    assert.equal(call.imageDataUrl, '');
    assert.match(call.note, /mock text card/);
});

test('a second click does not start another job', () => {
    const lock = createJobLock();
    assert.equal(lock.hold('keyframe'), true);
    assert.equal(lock.hold('video'), false);
    assert.equal(lock.state.phase, 'keyframe');
    assert.equal(lock.state.running, true);
    assert.equal(lock.hold('video', { owned: true }), true);
    assert.equal(lock.state.phase, 'video');
    assert.equal(lock.state.running, true);
    lock.release({ owned: true });
    assert.equal(lock.state.running, true);
    assert.equal(jobButtonLabel(lock.state.phase), 'Generating video…');
    assert.equal(jobButtonLabel('keyframe'), 'Generating keyframe…');
    lock.release();
    assert.equal(lock.state.running, false);
    assert.equal(lock.hold('keyframe'), true);
});

test('panels scroll on their own and the price line stays compact', () => {
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const panel = readFileSync(new URL('../lib/panel.js', import.meta.url), 'utf8');
    const lock = readFileSync(new URL('../lib/job-lock.js', import.meta.url), 'utf8');
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    assert.match(css, /\.stsv-body\s*\{[^}]*overflow-y:\s*auto/);
    assert.match(css, /\.stsv-footer\s*\{[^}]*max-height:\s*52px/);
    assert.match(css, /\.stsv-footer\s*\{[^}]*flex-direction:\s*row/);
    assert.match(css, /\.stsv-keyframe-prompt\s*\{[^}]*max-height:\s*8\.5rem/);
    assert.match(css, /\.stsv-error,\s*\n\.stsv-status[\s\S]*max-height:\s*6\.5rem/);
    assert.match(panel, /<details class="stsv-cost-details">/);
    assert.match(panel, /id="stsv-cost"/);
    assert.match(lock, /Generating keyframe/);
    assert.match(readme, /Where do my videos show up\?/);
    assert.match(panel, /Your clip is in Review — attach it to the chat/);
    assert.match(panel, /id="stsv-cancel"/);
    assert.match(css, /\.stsv-footer-actions/);
    const footerAt = panel.indexOf('<footer class="stsv-footer">');
    assert.ok(panel.indexOf('id="stsv-status"') < footerAt);
    assert.ok(panel.indexOf('id="stsv-local"') < footerAt);
    assert.match(panel, /<summary title="Price details">Price<\/summary>/);
    assert.match(css, /\.stsv-footer-actions\s*\{[^}]*overflow:\s*hidden/);
    assert.match(panel, /Local split/);
});
