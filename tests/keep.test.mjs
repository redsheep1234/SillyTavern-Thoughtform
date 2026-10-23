import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteStoredFile, keepGeneratedPicture, linkCopiedPictures, sessionRestore } from '../lib/keep.js';
import { emptyRecord } from '../lib/library.js';

function memoryFetch() {
    const uploads = [];
    const deletes = [];
    const fetchImpl = async (url, options = {}) => {
        const target = String(url);
        if (target.includes('/api/files/upload')) {
            const body = JSON.parse(options.body);
            uploads.push(body.name);
            return { ok: true, json: async () => ({ path: `user/files/${body.name}` }), text: async () => '' };
        }
        if (target.includes('/api/files/delete')) {
            deletes.push(JSON.parse(options.body).path);
            return { ok: true, json: async () => ({}), text: async () => '' };
        }
        return { ok: false, status: 404, text: async () => 'missing', json: async () => ({}) };
    };
    return { fetchImpl, uploads, deletes };
}

test('a paid picture is stored, flushed, and still there after a JSON reload', async () => {
    const { fetchImpl, uploads } = memoryFetch();
    const record = emptyRecord({ key: 'sera', name: 'Sera Voss', kind: 'character' });
    record.primaryId = 'avatar';
    record.images = [{ id: 'avatar', source: 'avatar', url: '/characters/sera.png', label: 'avatar' }];
    const item = { label: 'joy', stLabel: 'joy', tags: ['expression'], prompt: 'raincoat', cacheKey: 'joy-key' };
    const studio = { stage: 'results', recordKey: record.key, items: [item] };
    let flushed = 0;
    const shown = await keepGeneratedPicture({
        fetchImpl,
        studio: () => studio,
        flush: async () => { flushed += 1; },
    }, record, item, 'data:image/jpeg;base64,aaaa');
    assert.match(item.file, /^user\/files\/thoughtform_sera-voss_joy_/);
    assert.equal(item.review, 'unreviewed');
    assert.match(shown, /\/user\/files\/thoughtform_sera-voss_joy_/);
    const parked = record.images.find((image) => image.stLabel === 'joy');
    assert.equal(parked.dataUrl, '');
    assert.equal(parked.file, item.file);
    assert.equal(parked.review, 'unreviewed');
    assert.equal(record.primaryId, 'avatar');
    assert.equal(record.suiteRun.items[0].file, item.file);
    assert.equal(flushed, 1);
    assert.equal(uploads.length, 1);
    const round = JSON.parse(JSON.stringify(record));
    assert.equal(round.images.find((image) => image.stLabel === 'joy').file, item.file);
    assert.equal(round.suiteRun.items[0].prompt, 'raincoat');
});

test('resume prices only the pictures that are not already stored', () => {
    const items = [
        { label: 'a', file: 'user/files/a.jpg', url: '/user/files/a.jpg' },
        { label: 'b', file: 'user/files/b.jpg', url: '/user/files/b.jpg' },
    ];
    for (let index = 0; index < 6; index += 1) items.push({ label: `left-${index}`, prompt: 'pending' });
    const note = sessionRestore({ items }, { modelId: 'fal-ai/flux-pro/kontext/multi' });
    assert.equal(note.restored, 'Restored 2 pictures from your last session');
    assert.equal(note.resume, 'Resume (6 left, ~A$0.36)');
    assert.equal(note.left, 6);
    assert.equal(note.count, 2);
    const done = items.filter((item) => item.file);
    assert.equal(done.length, 2);
});

test('a copy reuses the stored file and delete removes only user files', async () => {
    const { fetchImpl, uploads, deletes } = memoryFetch();
    const record = emptyRecord({ key: 'sera', name: 'Sera Voss', kind: 'character' });
    const joy = { label: 'joy', stLabel: 'joy', file: 'user/files/thoughtform_sera-voss_joy_abc.jpg', folder: 'thoughtform/sera-voss', dataUrl: '/user/files/thoughtform_sera-voss_joy_abc.jpg' };
    const love = { label: 'love', stLabel: 'love', copyOf: 'joy', tags: ['expression'] };
    assert.equal(linkCopiedPictures(record, [joy, love]), true);
    assert.equal(love.file, joy.file);
    assert.equal(uploads.length, 0);
    assert.equal(record.images.filter((image) => image.copyOf === 'joy').length, 1);
    assert.equal(await deleteStoredFile('/docs/examples/sera-neutral.jpg', { fetchImpl }), false);
    assert.equal(await deleteStoredFile('/characters/sera.png', { fetchImpl }), false);
    assert.equal(deletes.length, 0);
    assert.equal(await deleteStoredFile(joy.file, { fetchImpl }), true);
    assert.deepEqual(deletes, [joy.file]);
});
