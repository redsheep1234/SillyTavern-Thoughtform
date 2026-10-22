import assert from 'node:assert/strict';
import test from 'node:test';
import { appendMessageMedia, uploadDataUrl } from '../lib/attach.js';
import { fileSrc, messageIdForScene, restoreSceneMedia, sceneForChat } from '../lib/media.js';
import { releaseMissingClips } from '../lib/simple.js';

test('a stored still drops the data URL and comes back as a file path', () => {
    const stored = sceneForChat({
        prompt: 'The stall',
        keyframeDataUrl: 'data:image/jpeg;base64,abc',
        keyframeFile: 'user/files/scene-1.jpg',
        memberStills: { aki: 'data:image/jpeg;base64,zzz' },
        memberStillFiles: { aki: 'user/files/aki.jpg' },
    });
    assert.equal(stored.keyframeDataUrl, undefined);
    assert.equal(stored.memberStills, undefined);
    assert.equal(stored.keyframeFile, 'user/files/scene-1.jpg');
    const restored = restoreSceneMedia(stored);
    assert.equal(restored.keyframeDataUrl, '/user/files/scene-1.jpg');
    assert.equal(restored.memberStills.aki, '/user/files/aki.jpg');
    assert.equal(fileSrc('https://cdn.example/a.jpg'), 'https://cdn.example/a.jpg');
});

test('a clip file survives reload without its blob', () => {
    const kept = releaseMissingClips([{ clipHash: 'abc', clipFile: 'user/files/clip.mp4', prompt: 'keep' }], {});
    assert.equal(kept.released, 0);
    assert.equal(kept.scenes[0].clipHash, 'abc');
});

test('a still upload is attached to the scene message and not twice', async () => {
    const chat = [{}, { extra: { media: [] } }];
    const uploaded = await uploadDataUrl('data:image/jpeg;base64,abc', 'scene-still', {
        getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    }, async (url, init) => {
        assert.equal(url, '/api/files/upload');
        assert.equal(JSON.parse(init.body).name, 'scene-still.jpg');
        return { ok: true, json: async () => ({ path: 'user/files/scene-still.jpg' }), text: async () => '' };
    });
    const scene = { lines: [{ messageId: 1, speaker: 'Aki', text: 'Wait.' }] };
    assert.equal(messageIdForScene(scene, 0), 1);
    const message = chat[messageIdForScene(scene)];
    assert.equal(appendMessageMedia(message, { url: uploaded.path, type: 'image', title: uploaded.name }), true);
    assert.equal(appendMessageMedia(message, { url: uploaded.path, type: 'image', title: uploaded.name }), false);
    assert.equal(message.extra.media.length, 1);
    assert.equal(message.extra.media[0].source, 'api');
});
