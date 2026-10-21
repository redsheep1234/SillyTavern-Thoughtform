import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureLibrary } from '../lib/library.js';
import {
    applyTraitEdit,
    approveReplacement,
    assignRelation,
    createRelatedCharacter,
    remixDraft,
    replacementPrompt,
    updateOutfitText,
} from '../lib/relations.js';

function parentLibrary() {
    const library = ensureLibrary({});
    library.records.source = {
        key: 'source',
        name: 'Mara',
        appearance: 'silver bob, amber eyes, coral wrap',
        images: [{ id: 'face', dataUrl: 'data:image/png,mara', tags: ['face'] }],
        outfits: [{ id: 'wrap', name: 'coral wrap', description: 'coral wrap' }],
    };
    return library;
}

function snapshot(value) {
    return JSON.parse(JSON.stringify(value));
}

test('a related character keeps editable traits and never writes the parent', () => {
    const library = parentLibrary();
    const source = library.records.source;
    const before = snapshot(source);
    const sister = createRelatedCharacter(library, source, { relation: 'sibling', name: 'Nia' });
    assert.equal(sister.traits.hair, 'silver bob');
    assert.equal(sister.traits.eyes, 'amber eyes');
    assert.match(sister.appearance, /Sibling of Mara/);
    applyTraitEdit(sister, source, { hair: '', eyes: 'green eyes', height: 'tall' });
    assert.equal(sister.traits.hair, '');
    assert.match(sister.appearance, /green eyes/);
    assert.doesNotMatch(sister.appearance, /silver bob/);
    assert.match(sister.appearance, /tall/);
    assignRelation(sister, source, 'parent');
    assert.equal(sister.relation, 'parent');
    assert.equal(sister.name, 'Nia');
    assert.match(sister.appearance, /Older parent of Mara/);
    assert.deepEqual(source, before);
});

test('remix and a single still stay pending until approval', () => {
    const library = parentLibrary();
    const source = library.records.source;
    const before = snapshot(source);
    const mum = createRelatedCharacter(library, source, { relation: 'parent', name: 'Ione' });
    mum.images = [{ id: 'expr', dataUrl: 'data:image/png,old', tags: ['expression'], label: 'happy', prompt: 'smile' }];
    mum.outfits = [{ id: 'coat', name: 'coat', description: 'wool coat' }];
    const draft = remixDraft(mum, source);
    assert.match(draft.prompt, /Ione/);
    assert.match(draft.prompt, /about 50s/);
    assert.equal(mum.images[0].dataUrl, 'data:image/png,old');
    assert.match(replacementPrompt(mum, mum.images[0]), /Expression: happy/);
    updateOutfitText(mum, 'coat', 'linen coat');
    assert.equal(mum.outfits[0].description, 'linen coat');
    assert.equal(source.outfits[0].description, 'coral wrap');
    const image = approveReplacement(mum, 'expr', { dataUrl: 'data:image/png,new', prompt: 'new smile' });
    assert.equal(image.dataUrl, 'data:image/png,new');
    assert.equal(image.previousDataUrl, 'data:image/png,old');
    assert.equal(mum.images.length, 1);
    assert.deepEqual(source, before);
});

test('deleting the parent leaves the related board editable', () => {
    const library = parentLibrary();
    const sister = createRelatedCharacter(library, library.records.source, { relation: 'sibling', name: 'Nia' });
    delete library.records.source;
    assert.doesNotThrow(() => applyTraitEdit(sister, undefined, { hair: 'black bob' }));
    assert.match(sister.appearance, /black bob/);
    assert.match(sister.appearance, /the source character/);
    const draft = remixDraft(sister, undefined);
    assert.match(draft.prompt, /Nia/);
    assert.match(draft.prompt, /the original/);
    assignRelation(sister, undefined, 'child');
    assert.equal(sister.relation, 'child');
    assert.equal(library.records.source, undefined);
});
