import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAvatarLook, parseAvatarLook, seedLookFields } from '../lib/avatar-look.js';
import { characterAssetUrl, imagesForPrompt, materializeImage, referenceBlock, referencePlan, referenceSummary } from '../lib/library.js';
import { planReferenceSet } from '../lib/refset.js';
import { imagesInMedium } from '../lib/variants.js';

const PHOTO = {
    kind: 'character',
    name: 'Sera',
    sourceMedium: '',
    inferredMedium: 'live-action',
    appearance: '',
    primaryId: 'ava',
    images: [{
        id: 'ava',
        url: '/thumbnail?type=avatar&file=sera.png',
        source: 'avatar',
        avatar: 'sera.png',
        tags: ['face'],
        medium: '',
        label: 'Avatar',
    }],
};

test('a photoreal avatar and an anime style match no filed still', () => {
    assert.equal(imagesInMedium(PHOTO, 'anime').length, 0);
    const plan = referencePlan(PHOTO, { medium: 'anime' });
    assert.equal(plan.matched.length, 0);
    assert.equal(plan.images.length, 1);
    assert.equal(plan.images[0].id, 'ava');
    assert.equal(imagesForPrompt(PHOTO, { medium: 'anime' }).length, 1);
    assert.equal(plan.warning, 'This picture looks photoreal but the style is Anime. Switch style to Live action?');
    assert.equal(plan.switchTo, 'live-action');
    assert.equal(referenceSummary(plan.images), 'Using 1 reference: avatar.');
});

test('a character with no reference image is blocked before a still is sent', () => {
    const record = { kind: 'character', name: 'Sera', images: [], appearance: '' };
    const plan = referencePlan(record, { medium: 'anime' });
    assert.equal(plan.images.length, 0);
    const block = referenceBlock(record);
    assert.match(block.plain, /Sera has no reference image to send/);
    assert.match(block.fix, /upload a face still/i);
    assert.equal(block.act, 'upload-face');
    const unfiled = {
        kind: 'character',
        name: 'Sera',
        sourceMedium: '',
        images: [{ id: 'ava', url: '/characters/sera.png', tags: ['face'], medium: '', label: 'Avatar' }],
    };
    assert.equal(imagesInMedium(unfiled, 'live-action').length, 0);
    assert.equal(imagesForPrompt(unfiled, { medium: 'live-action' }).length, 1);
});

test('an avatar thumbnail is loaded from the full character path', async () => {
    assert.equal(characterAssetUrl('/thumbnail?type=avatar&file=sera.png'), '/characters/sera.png');
    assert.equal(characterAssetUrl('sera.png', 'character'), '/characters/sera.png');
    assert.equal(characterAssetUrl('/docs/examples/sera-neutral.jpg'), '/docs/examples/sera-neutral.jpg');
    assert.equal(characterAssetUrl('http://127.0.0.1:8000/thumbnail?type=avatar&file=sera.png'), 'http://127.0.0.1:8000/characters/sera.png');
    assert.equal(characterAssetUrl('/thumbnail?type=persona&file=me.png', 'persona'), '/user_avatars/me.png');
    let requested = '';
    let init = null;
    await assert.rejects(
        () => materializeImage(
            { url: '/thumbnail?type=avatar&file=sera.png', source: 'avatar' },
            async (url, options) => {
                requested = url;
                init = options;
                return { ok: false, status: 404 };
            },
            { headers: { 'X-CSRF-Token': 'csrf-token', 'Content-Type': 'application/json' } },
        ),
        /Could not load the reference image \(404 \/characters\/sera\.png\)/,
    );
    assert.equal(requested, '/characters/sera.png');
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.headers['X-CSRF-Token'], 'csrf-token');
    assert.equal(init.headers['Content-Type'], undefined);
});

test('empty Must keep and May change fill from the appearance', () => {
    const record = {
        appearance: 'Short silver bob, amber eyes, dark green raincoat. Fixture character, not a real person.',
        mustKeep: '',
        mayChange: '',
    };
    assert.equal(seedLookFields(record), true);
    assert.match(record.mustKeep, /silver bob/i);
    assert.match(record.mustKeep, /amber eyes/i);
    assert.match(record.mustKeep, /green raincoat/i);
    assert.equal(record.mayChange, 'outfit, pose');
    record.mustKeep = '';
    assert.equal(seedLookFields(record), false);
    assert.equal(record.mustKeep, '');
    const custom = { appearance: 'silver bob, amber eyes', mustKeep: 'amber eyes', mayChange: '' };
    assert.equal(seedLookFields(custom), true);
    assert.equal(custom.mustKeep, 'amber eyes');
    assert.equal(custom.mayChange, 'outfit, pose');
});

test('a described avatar fills appearance, Must keep, and the suite prompt', () => {
    const record = {
        name: 'Sera',
        appearance: '',
        mustKeep: '',
        sourceMedium: '',
        primaryId: 'ava',
        images: [{ id: 'ava', source: 'avatar', medium: '', url: '/characters/sera.png' }],
    };
    const look = parseAvatarLook(JSON.stringify({
        medium: 'live-action',
        appearance: 'A woman with a platinum blonde bob and blue-grey eyes, an oval face.',
        mustKeep: 'platinum blonde bob, blue-grey eyes, oval face',
    }));
    assert.equal(applyAvatarLook(record, look), true);
    assert.match(record.appearance, /platinum blonde bob/);
    assert.match(record.mustKeep, /blue-grey eyes/);
    assert.equal(record.inferredMedium, 'live-action');
    assert.equal(record.images[0].medium, 'live-action');
    const [portrait] = planReferenceSet({
        expressions: [{ id: 'neutral', label: 'neutral', st: 'neutral', line: 'Neutral expression.' }],
        includeTurnaround: false,
        appearance: record.appearance,
        mustKeep: record.mustKeep,
    });
    assert.match(portrait.prompt, /platinum blonde bob/);
    assert.match(portrait.prompt, /blue-grey eyes/);
    assert.match(portrait.prompt, /Must keep: platinum blonde bob, blue-grey eyes, oval face/);
});
