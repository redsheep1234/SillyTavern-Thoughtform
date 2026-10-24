import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStoredZip, zipExpressionSet } from '../lib/sprites.js';
import { openZip } from './helpers/zip-open.mjs';

const png = Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
));
const jpg = Uint8Array.from(Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxISEhUQEhIVFhUVFRUVFRUVFRUVFRUWFxUVFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGhAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAQABAAMBIgACEQEDEQH/xAAnAAEBAAAAAAAAAAAAAAAAAAAABwEBAQAAAAAAAAAAAAAAAAAAAAH/2gAMAwEAAhEDEQA/AKpQf/Z',
    'base64',
));

test('an expression zip uses SillyTavern file names', () => {
    const bytes = zipExpressionSet({
        name: 'Sera',
        stName: 'Sera',
        images: [
            { dataUrl: `data:image/png;base64,${Buffer.from(png).toString('base64')}`, tags: ['expression'], label: 'happy', stLabel: 'joy' },
            { dataUrl: `data:image/jpeg;base64,${Buffer.from(jpg).toString('base64')}`, tags: ['expression'], label: 'sadness', stLabel: 'sadness' },
            { dataUrl: 'data:image/png;base64,aa', tags: ['turnaround'], label: 'front' },
        ],
    });
    const files = openZip(bytes);
    const joy = files.find((file) => file.name === 'Sera/joy.png');
    const sadness = files.find((file) => file.name === 'Sera/sadness.jpg');
    assert.ok(joy);
    assert.ok(sadness);
    assert.equal(files.some((file) => file.name.endsWith('front.png')), false);
    assert.deepEqual(joy.data, png);
    assert.equal(joy.data[0], 0x89);
    assert.equal(joy.data[1], 0x50);
    assert.equal(sadness.data[0], 0xff);
    assert.equal(sadness.data[1], 0xd8);
    assert.ok(joy.size > 0);
    assert.ok(joy.date[0] >= 1980 && joy.date[1] >= 1 && joy.date[2] >= 1);
});

test('a stored zip holds a real-size picture and still opens', () => {
    const data = new Uint8Array(200000);
    data[0] = 7;
    data[199999] = 9;
    const files = openZip(buildStoredZip([{ name: 'Sera/joy.png', bytes: data }]));
    assert.equal(files.length, 1);
    assert.equal(files[0].name, 'Sera/joy.png');
    assert.equal(files[0].size, data.length);
    assert.equal(files[0].data[0], 7);
    assert.equal(files[0].data[199999], 9);
});
