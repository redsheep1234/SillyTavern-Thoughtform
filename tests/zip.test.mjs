import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStoredZip, zipExpressionSet } from '../lib/sprites.js';

test('an expression zip uses SillyTavern file names', () => {
    const png = btoa('png-bytes');
    const bytes = zipExpressionSet({
        name: 'Sera',
        stName: 'Sera',
        images: [
            { dataUrl: `data:image/png;base64,${png}`, tags: ['expression'], label: 'happy', stLabel: 'joy' },
            { dataUrl: `data:image/jpeg;base64,${btoa('jpg')}`, tags: ['expression'], label: 'sadness', stLabel: 'sadness' },
            { dataUrl: 'data:image/png;base64,aa', tags: ['turnaround'], label: 'front' },
        ],
    });
    const text = Buffer.from(bytes).toString('latin1');
    assert.match(text, /Sera\/joy\.png/);
    assert.match(text, /Sera\/sadness\.jpg/);
    assert.doesNotMatch(text, /front\.png/);
    assert.match(text, /png-bytes/);
    assert.equal(bytes[0], 0x50);
    assert.equal(bytes[1], 0x4b);
});

test('a stored zip holds a real-size picture without blowing the stack', () => {
    const data = new Uint8Array(200000);
    data[0] = 7;
    data[199999] = 9;
    const zip = buildStoredZip([{ name: 'Sera/joy.png', bytes: data }]);
    assert.equal(zip[0], 0x50);
    assert.equal(zip[1], 0x4b);
    assert.ok(zip.length > data.length);
    assert.ok(Buffer.from(zip).includes(Buffer.from(data.subarray(0, 1))));
    assert.equal(Buffer.from(zip).includes(Buffer.from([7, 0, 0, 0])), true);
});
