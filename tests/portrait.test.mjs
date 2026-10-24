import assert from 'node:assert/strict';
import test from 'node:test';
import { expressionFiles } from '../lib/expressions.js';
import { imagesForPrompt } from '../lib/library.js';
import { cropWidePortrait, portraitCropBox } from '../lib/portrait.js';

test('a wide still crops to a top-centred 3:4 head and shoulders', () => {
    const portrait = portraitCropBox(360, 480);
    assert.equal(portrait, null);
    const square = portraitCropBox(400, 400);
    assert.equal(square.y, 0);
    assert.ok(Math.abs(square.width / square.height - 0.75) < 0.02);
    assert.ok(square.x > 0);
    assert.ok(square.height < 400);
    const wide = portraitCropBox(480, 270);
    assert.equal(wide.y, 0);
    assert.ok(Math.abs(wide.width / wide.height - 0.75) < 0.02);
    assert.ok(wide.height < 270 * 0.6);
    assert.ok(wide.x > 0);
    assert.equal(portraitCropBox(4, 4), null);
});

test('a portrait crop is the sprite and the scene face, and the wide original stays', () => {
    const record = {
        kind: 'character',
        primaryId: 'ava',
        images: [
            { id: 'ava', dataUrl: 'data:image/png,ava', tags: ['face'], source: 'avatar' },
            { id: 'wide', dataUrl: 'data:image/png,wide', tags: ['expression'], frame: 'wide', stLabel: 'joy', label: 'joy', source: 'generated' },
            { id: 'crop', dataUrl: 'data:image/png,crop', tags: ['expression', 'face'], portrait: true, cropOf: 'wide', frame: 'portrait', aspectRatio: '3:4', stLabel: 'joy', label: 'joy', source: 'generated', approved: true },
            { id: 'turn', dataUrl: 'data:image/png,turn', tags: ['turnaround', 'full body'], source: 'generated' },
        ],
    };
    const files = expressionFiles(record, ['joy', 'approval']);
    assert.equal(files.length, 2);
    assert.equal(files[0].id, 'crop');
    assert.equal(files[0].dataUrl, 'data:image/png,crop');
    assert.equal(files[1].stLabel, 'approval');
    assert.equal(files[1].dataUrl, 'data:image/png,crop');
    const refs = imagesForPrompt(record, { cap: 2 });
    assert.equal(refs[0].id, 'crop');
    assert.equal(refs.some((image) => image.id === 'wide'), false);
    assert.equal(record.images.some((image) => image.id === 'wide'), true);
});

test('cropping waits for a canvas and does not invent a picture', async () => {
    assert.equal(await cropWidePortrait('data:image/png,aaaa'), null);
});
