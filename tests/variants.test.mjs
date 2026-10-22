import assert from 'node:assert/strict';
import test from 'node:test';
import { imagesForPrompt } from '../lib/library.js';
import { appearanceBlock } from '../lib/wardrobe.js';
import { projectMedium, styleMismatchNote, usableFeatureBrief, variantImageRequest } from '../lib/variants.js';

test('a live-action variant is text only and photographic', () => {
    const request = variantImageRequest({
        medium: 'live-action',
        description: 'woman in her 50s, silver bob, amber eyes, white sundress',
        name: 'Ione',
    });
    assert.deepEqual(request.referenceImages, []);
    assert.match(request.prompt, /Photoreal live-action photograph/);
    assert.match(request.prompt, /not a 3D render/i);
    assert.match(request.prompt, /not glossy plastic/i);
    assert.match(request.prompt, /silver bob/);
    const anime = variantImageRequest({ medium: 'anime', description: 'silver bob, amber eyes', name: 'Mara' });
    assert.deepEqual(anime.referenceImages, []);
    assert.match(anime.prompt, /cel-shaded/);
    assert.match(anime.prompt, /Not a photograph/);
});

test('the project style picks its own reference set', () => {
    const record = {
        kind: 'character',
        sourceMedium: 'anime',
        primaryId: 'draw',
        variantPrimary: { 'live-action': 'photo' },
        variantText: { 'live-action': 'woman in her 50s, silver bob, amber eyes, natural skin' },
        images: [
            { id: 'draw', dataUrl: 'data:image/png,anime', tags: ['face'], medium: '' },
            { id: 'photo', dataUrl: 'data:image/png,photo', tags: ['face'], medium: 'live-action' },
        ],
    };
    const live = imagesForPrompt(record, { medium: 'live-action', cap: 4 });
    assert.deepEqual(live.map((image) => image.id), ['photo']);
    const drawn = imagesForPrompt(record, { medium: 'anime', cap: 4 });
    assert.deepEqual(drawn.map((image) => image.id), ['draw']);
    assert.equal(projectMedium({ style: 'live-action' }), 'live-action');
    const block = appearanceBlock({
        cast: [{ key: 'a', name: 'Ione' }],
    }, [{ ...record, key: 'a', name: 'Ione', appearance: 'silver bob, amber eyes' }], [], 'live-action');
    assert.match(block, /woman in her 50s/);
});

test('a shot-list reply is not used as the feature description', () => {
    assert.equal(usableFeatureBrief('{"scenes":[]}', 'silver bob'), 'silver bob');
    assert.equal(usableFeatureBrief('Amber eyes, silver bob, about 50.', ''), 'Amber eyes, silver bob, about 50.');
});

test('switching style mid-project warns until a matching avatar exists', () => {
    const record = {
        sourceMedium: 'anime',
        images: [{ id: 'draw', dataUrl: 'data:image/png,a', medium: 'anime' }],
    };
    assert.match(styleMismatchNote(record, 'live-action'), /looks anime but the style is Live action/);
    assert.match(styleMismatchNote(record, 'live-action'), /Switch style to Anime/);
    assert.equal(styleMismatchNote(record, 'anime'), '');
    assert.equal(styleMismatchNote({ images: [] }, 'live-action'), '');
});
