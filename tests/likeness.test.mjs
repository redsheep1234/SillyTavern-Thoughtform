import assert from 'node:assert/strict';
import test from 'node:test';
import { explainError } from '../lib/debug.js';
import { composeKeyframePrompt, keyframesPending, planKeyframeJob, placementFor } from '../lib/keyframes.js';
import { createRelatedCharacter, familyReferences } from '../lib/relations.js';
import { buildShotListRequest, composeVideoPrompt } from '../lib/shotlist.js';
import { styleLockText } from '../lib/style-lock.js';
import { ensureLibrary } from '../lib/library.js';

test('style lock defaults to the chosen medium and yields to a custom line', () => {
    assert.match(styleLockText({ style: 'anime' }), /2D anime, cel-shaded/);
    assert.equal(styleLockText({ style: 'anime', styleLock: 'ink and flat color only' }), 'ink and flat color only');
    const prompt = composeVideoPrompt({ prompt: 'She walks.' }, { style: 'anime', themeId: 'cel-90s', extraPrompt: '', negativePrompt: '' });
    assert.match(prompt, /^2D anime, cel-shaded/);
});

test('a group keyframe places people and keeps their traits', () => {
    const records = [
        { key: 'a', name: 'Mara', appearance: 'silver bob, amber eyes, about 20' },
        { key: 'b', name: 'Ione', appearance: 'silver bob, amber eyes, visibly older, 50s' },
    ];
    const scene = {
        prompt: 'They walk the beach at sunset.',
        shotType: 'wide',
        cameraMove: 'static',
        cast: [
            { key: 'a', name: 'Mara', outfitId: 'swim' },
            { key: 'b', name: 'Ione', outfitId: 'dress' },
        ],
    };
    records[0].outfits = [{ id: 'swim', name: 'coral wrap', description: 'coral two-piece and a tied wrap' }];
    records[1].outfits = [{ id: 'dress', name: 'white sundress', description: 'white sundress with blue embroidery' }];
    const prompt = composeKeyframePrompt({
        scene: { ...scene, keyframeAdjust: 'visibly older, 50s' },
        settings: { style: 'anime', themeId: 'cel-90s' },
        records,
    });
    assert.match(prompt, /Mara is on the left/);
    assert.match(prompt, /Ione is on the right/);
    assert.match(prompt, /coral wrap/);
    assert.match(prompt, /white sundress/);
    assert.match(prompt, /Adjustment: visibly older, 50s/);
    assert.match(prompt, /Do not swap their face/);
    assert.equal(placementFor(1, 3), 'in the center');
});

test('group keyframes draw each person before the shared still', () => {
    const records = [
        { key: 'a', name: 'Mara', images: [{ id: '1', dataUrl: 'data:image/png,a', tags: ['face'] }] },
        { key: 'b', name: 'Ione', images: [{ id: '2', url: '/ione.png', tags: ['face'], outfitId: 'dress' }] },
    ];
    const scene = {
        cast: [
            { key: 'a', name: 'Mara', outfitId: '' },
            { key: 'b', name: 'Ione', outfitId: 'dress' },
        ],
    };
    const passes = planKeyframeJob(scene, records);
    assert.deepEqual(passes.map((pass) => pass.kind), ['member', 'scene']);
    assert.equal(passes[0].name, 'Mara');
    const ready = planKeyframeJob({ ...scene, memberStills: { a: 'data:image/png,still' } }, records);
    assert.deepEqual(ready.map((pass) => pass.kind), ['scene']);
    assert.deepEqual(planKeyframeJob({ cast: [scene.cast[0]] }, records).map((pass) => pass.kind), ['scene']);
});

test('video waits for an approved keyframe unless the user skipped the gate', () => {
    const scenes = [{ keyframeDataUrl: 'data:image/png,x', keyframeApproved: false }];
    assert.equal(keyframesPending(scenes, { consistency: 'keyframe' }), true);
    assert.equal(keyframesPending([{ keyframeDataUrl: 'data:image/png,x', keyframeApproved: true }], {}), false);
    assert.equal(keyframesPending(scenes, { consistency: 'direct' }), false);
});

test('a related character borrows the source board and an older description', () => {
    const library = ensureLibrary({});
    library.records.source = {
        key: 'source',
        name: 'Mara',
        appearance: 'silver bob, amber eyes, coral wrap',
        images: [{ id: 'face', dataUrl: 'data:image/png,mara', tags: ['face'] }],
    };
    const mother = createRelatedCharacter(library, library.records.source, { relation: 'parent', name: 'Ione' });
    assert.equal(mother.sourceKey, 'source');
    assert.equal(mother.relation, 'parent');
    assert.match(mother.appearance, /Visibly older, about 50s/);
    assert.match(mother.appearance, /silver bob, amber eyes/);
    assert.equal(familyReferences(mother, Object.values(library.records))[0].name, 'Mara');
});

test('shot lists are told to place a group, and a refusal names the outfit', () => {
    const request = buildShotListRequest({
        messages: [{ id: 0, name: 'Mara', text: 'Come on.' }],
        cast: { user: { name: 'Sera' }, characters: [] },
        settings: { style: 'anime', themeId: 'cel-90s', sceneCount: 0, secondsPerScene: 5 },
    });
    assert.match(request.systemPrompt, /on the left/);
    assert.match(request.prompt, /Style lock: 2D anime, cel-shaded/);
    const explained = explainError('safety filter rejected the outfit: bikini');
    assert.match(explained.plain, /refused this outfit prompt/);
    assert.match(explained.fix, /switch provider/);
    const vague = explainError('HTTP 422');
    assert.match(vague.plain, /did not explain why/);
});
