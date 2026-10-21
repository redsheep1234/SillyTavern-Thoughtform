import assert from 'node:assert/strict';
import test from 'node:test';
import { attachImageDataUrl } from '../lib/attach.js';
import { defaultSettings } from '../lib/constants.js';

test('a still posts through the same file upload as a video, with an image type', async () => {
    const chat = [{}, { extra: {} }];
    let body;
    const uploaded = await attachImageDataUrl('data:image/jpeg;base64,abc', {
        messageId: 1,
        filename: 'moment',
        context: {
            chat,
            getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
            saveChat: async () => {},
        },
        fetchImpl: async (url, init) => {
            body = JSON.parse(init.body);
            assert.equal(url, '/api/files/upload');
            return {
                ok: true,
                json: async () => ({ path: 'user/files/moment.jpg' }),
                text: async () => '',
            };
        },
    });
    assert.equal(body.name, 'moment.jpg');
    assert.equal(body.data, 'abc');
    assert.equal(chat[1].extra.media[0].type, 'image');
    assert.equal(chat[1].extra.media[0].url, 'user/files/moment.jpg');
    assert.equal(uploaded.path, 'user/files/moment.jpg');
});

test('video stays the output unless images is chosen', () => {
    assert.equal(defaultSettings.outputMode, 'video');
});
