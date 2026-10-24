import assert from 'node:assert/strict';
import test from 'node:test';
import { expressionFiles } from '../lib/expressions.js';
import { expressionZipBytes, expressionZipName, spriteExportPlan, uploadExpressionSprites } from '../lib/sprites.js';
import { openZip } from './helpers/zip-open.mjs';

const png = Uint8Array.from([137, 80, 78, 71, 1, 2, 3, 4]);

function pictureResponse() {
    return {
        ok: true,
        status: 200,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => png.buffer,
    };
}

const stored = {
    name: 'Sera Voss',
    stName: 'Sera Voss',
    images: [
        { file: 'user/files/joy.jpg', url: '/user/files/joy.jpg', tags: ['expression'], label: 'happy', stLabel: 'joy', review: 'approved', source: 'generated' },
        { file: 'user/files/sad.jpg', tags: ['expression'], label: 'sadness', stLabel: 'sadness', review: 'unreviewed', source: 'generated' },
        { file: 'user/files/wide.jpg', tags: ['expression'], label: 'Full frame', stLabel: 'joy', frame: 'wide', review: 'approved', source: 'generated' },
    ],
};

test('an approved stored still is exported and a picture still in review is not', async () => {
    const files = expressionFiles(stored, ['joy', 'sadness']);
    assert.equal(files.length, 1);
    assert.equal(files[0].stLabel, 'joy');
    assert.equal(files[0].file, 'user/files/joy.jpg');
    const plan = spriteExportPlan(stored);
    assert.equal(plan.targets.some((item) => item.stLabel === 'sadness'), false);
    assert.equal(plan.targets.some((item) => item.frame === 'wide'), false);
    assert.equal(plan.targets.some((item) => item.stLabel === 'joy'), true);
    assert.equal(expressionZipName(stored), 'Sera Voss-expressions.zip');
    let fetched = '';
    const bytes = await expressionZipBytes(stored, {
        fetchImpl: async (url) => {
            fetched = String(url);
            return pictureResponse();
        },
    });
    assert.equal(fetched, '/user/files/joy.jpg');
    const archive = openZip(bytes);
    const joy = archive.find((file) => file.name === 'Sera Voss/joy.png');
    assert.ok(joy);
    assert.deepEqual(joy.data, png);
    assert.equal(archive.some((file) => /sadness|wide/.test(file.name)), false);
    assert.ok(archive.every((file) => file.size > 0 && file.date[0] >= 1980));
});

test('a data URL zips without fetching, and a failed sprite upload names the expression', async () => {
    let called = false;
    const local = await expressionZipBytes({
        name: 'Sera',
        stName: 'Sera',
        images: [{ dataUrl: `data:image/png;base64,${btoa('png-bytes')}`, tags: ['expression'], label: 'joy', stLabel: 'joy' }],
    }, {
        fetchImpl: async () => {
            called = true;
            return pictureResponse();
        },
    });
    assert.equal(called, false);
    assert.match(Buffer.from(local).toString('latin1'), /Sera\/joy\.png/);
    assert.match(Buffer.from(local).toString('latin1'), /png-bytes/);

    let posted = null;
    await assert.rejects(
        () => uploadExpressionSprites(stored, {
            fetchImpl: async (url, init) => {
                if (String(url).includes('/api/sprites/upload')) {
                    posted = init;
                    return { ok: false, status: 500, text: async () => '' };
                }
                return pictureResponse();
            },
        }),
        /Sprite upload failed for \S+ \(500\)/,
    );
    assert.equal(posted.method, 'POST');
    assert.ok(posted.body instanceof FormData);
    assert.equal(posted.body.get('name'), 'Sera Voss');
    assert.equal(posted.body.get('spriteName'), posted.body.get('label'));
    assert.notEqual(posted.body.get('label'), 'sadness');
    const avatar = posted.body.get('avatar');
    assert.equal(avatar.type, 'image/png');
    assert.match(avatar.name, /\.png$/);
    assert.deepEqual(new Uint8Array(await avatar.arrayBuffer()), png);
});
