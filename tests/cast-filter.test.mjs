import assert from 'node:assert/strict';
import test from 'node:test';
import { boardsForMember, referenceChoices, referenceMembers } from '../lib/cast-filter.js';
import { collectReferenceImages } from '../lib/scene-request.js';

test('reference boards follow the people named in the shot', () => {
    const records = [
        { key: 'aki', name: 'Aki', kind: 'character', images: [{ id: 'a', dataUrl: 'data:image/png,a', tags: ['face'] }] },
        { key: 'sera', name: 'Sera', kind: 'character', images: [{ id: 's', dataUrl: 'data:image/png,s', tags: ['face'] }] },
        { key: 'mom', name: 'Mara', kind: 'character', sourceKey: '', images: [{ id: 'm', dataUrl: 'data:image/png,m', tags: ['face'] }] },
    ];
    records[0].sourceKey = 'mom';
    const scene = {
        prompt: 'Aki waits by the stall.',
        characters: ['Aki', 'Sera'],
        cast: [
            { key: 'aki', name: 'Aki' },
            { key: 'sera', name: 'Sera' },
        ],
    };
    assert.deepEqual(referenceMembers(scene, records).map((member) => member.name), ['Aki']);
    const images = collectReferenceImages(scene, records);
    assert.deepEqual(images.map((image) => image.id), ['a']);
    const mother = { key: 'mom', name: 'Mara' };
    const child = { key: 'aki', name: 'Aki', sourceKey: 'mom' };
    assert.deepEqual(boardsForMember(child, [child, mother], ['aki']).map((item) => item.key), ['aki']);
    assert.deepEqual(boardsForMember(child, [child, mother], ['aki', 'mom']).map((item) => item.key), ['aki', 'mom']);
    const choices = referenceChoices({ ...scene, referenceOverride: true, referenceKeys: ['sera'] }, records);
    assert.equal(choices.find((item) => item.key === 'sera').checked, true);
    assert.equal(choices.find((item) => item.key === 'aki').checked, false);
});
