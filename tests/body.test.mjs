import assert from 'node:assert/strict';
import test from 'node:test';
import { bodyClause, buildPhrase } from '../lib/body.js';
import { traitLine } from '../lib/keyframes.js';
import { emptyRecord, removeImage } from '../lib/library.js';
import {
    assignBodyReference,
    bodyReferenceImage,
    isBodySample,
    selectJobReferences,
} from '../lib/inspiration.js';
import { planReferenceSet, TURNAROUND } from '../lib/refset.js';
import { replacementPrompt } from '../lib/relations.js';
import { renderBoard, onBoardInput } from '../lib/ui/board.js';
import { appearanceBlock, outfitPreviewPrompt } from '../lib/wardrobe.js';

function photo(id, role, extra = {}) {
    return {
        id,
        url: `/${id}.jpg`,
        source: 'inspiration',
        role,
        identity: false,
        label: role === 'body' ? 'Body/build' : role,
        ...extra,
    };
}

function person() {
    return {
        key: 'sera',
        name: 'Sera',
        kind: 'character',
        primaryId: 'ava',
        bodyLine: 'athletic, narrow waist, long legs',
        bodyRefId: 'broad',
        mustKeep: 'short silver bob, amber eyes',
        images: [
            { id: 'ava', source: 'avatar', tags: ['face'], url: '/ava.jpg', label: 'Avatar' },
            photo('slim', 'body', { label: 'Slim' }),
            photo('broad', 'body', { label: 'Broad' }),
            photo('coral', 'outfit', { outfitId: 'coral', label: 'Outfit' }),
            photo('pose', 'pose'),
            { id: 'front', source: 'generated', tags: ['turnaround', 'full body'], url: '/front.jpg', label: 'front' },
        ],
    };
}

test('the body line is a build sentence, and a portrait only uses the shoulders', () => {
    assert.equal(buildPhrase('  athletic, narrow waist, long legs. '), 'Build: athletic, narrow waist, long legs');
    assert.equal(bodyClause('athletic, narrow waist, long legs'), 'Build: athletic, narrow waist, long legs.');
    assert.match(bodyClause('athletic, narrow waist, long legs', 'portrait'), /Figure, at the shoulders and neckline only: athletic, narrow waist, long legs/);
    assert.match(bodyClause('athletic, narrow waist, long legs', 'portrait'), /The face stays dominant/);
    assert.equal(bodyClause('   '), '');
    assert.doesNotMatch(bodyClause('athletic, narrow waist, long legs', 'portrait'), /Build:/);
});

test('suite prompts keep the figure on full-body work and a light touch on expressions', () => {
    const plan = planReferenceSet({
        expressions: [{ id: 'happy', label: 'happy', st: 'joy', line: 'Happy expression, a genuine smile.' }],
        includeExpressions: true,
        includeTurnaround: true,
        includeCloseups: true,
        turnaround: [
            TURNAROUND.find((view) => view.id === 'front'),
            TURNAROUND.find((view) => view.kind === 'pose'),
        ],
        appearance: 'Short silver bob, amber eyes, dark green raincoat.',
        mustKeep: 'short silver bob, amber eyes',
        suiteOutfit: 'a dark green raincoat',
        lockOutfit: true,
        bodyLine: 'athletic, narrow waist, long legs',
    });
    const joy = plan.find((item) => item.stLabel === 'joy');
    const front = plan.find((item) => item.id === 'turn-front');
    const pose = plan.find((item) => item.tags.includes('pose'));
    const close = plan.find((item) => item.tags.includes('closeup'));
    assert.match(joy.prompt, /Figure, at the shoulders and neckline only: athletic, narrow waist, long legs/);
    assert.match(joy.prompt, /The face stays dominant/);
    assert.match(joy.prompt, /head-and-shoulders portrait/i);
    assert.doesNotMatch(joy.prompt, /Build:/);
    assert.match(joy.prompt, /Must keep: short silver bob, amber eyes/);
    assert.doesNotMatch(joy.prompt, /Must keep: athletic/);
    assert.ok(joy.prompt.indexOf('Must keep:') > joy.prompt.indexOf('shoulders and neckline'));
    for (const item of [front, pose]) {
        assert.match(item.prompt, /Build: athletic, narrow waist, long legs/);
        assert.match(item.prompt, /wearing exactly: a dark green raincoat/);
        assert.match(item.prompt, /Must keep: short silver bob, amber eyes/);
        assert.ok(item.prompt.indexOf('Must keep:') > item.prompt.indexOf('Build:'));
    }
    assert.match(close.prompt, /shoulders and neckline only/);
    assert.doesNotMatch(close.prompt, /Build:/);
    const plain = planReferenceSet({
        expressions: [{ id: 'happy', label: 'happy', st: 'joy', line: 'Happy expression.' }],
        includeTurnaround: true,
        turnaround: [TURNAROUND.find((view) => view.id === 'front')],
        mustKeep: 'amber eyes',
    });
    assert.doesNotMatch(plain[0].prompt, /Build:|shoulders and neckline only/);
    assert.match(plain.find((item) => item.id === 'turn-front').prompt, /Must keep: amber eyes/);
});

test('a redo and an outfit preview keep the figure without rewriting must keep', () => {
    const record = { bodyLine: 'athletic, narrow waist, long legs', mustKeep: 'amber eyes', suiteOutfit: 'a light grey tee and shorts', varyOutfit: false };
    const pose = replacementPrompt(record, { label: 'sitting', tags: ['pose', 'full body'] }, { lockOutfit: true, suiteOutfit: record.suiteOutfit });
    assert.match(pose, /Build: athletic, narrow waist, long legs/);
    assert.match(pose, /Must keep: amber eyes/);
    assert.match(pose, /wearing exactly: a light grey tee and shorts/);
    assert.ok(pose.indexOf('Must keep:') > pose.indexOf('Build:'));
    const expression = replacementPrompt(record, { label: 'joy', tags: ['expression'] }, { lockOutfit: true, suiteOutfit: record.suiteOutfit });
    assert.match(expression, /shoulders and neckline only/);
    assert.doesNotMatch(expression, /Build:/);
    const preview = outfitPreviewPrompt({
        appearance: 'amber eyes, dark green raincoat',
        outfit: { name: 'Raincoat', description: 'a dark green raincoat' },
        mustKeep: 'amber eyes',
        bodyLine: record.bodyLine,
    });
    assert.match(preview, /Build: athletic, narrow waist, long legs/);
    assert.match(preview, /Must keep: amber eyes/);
    assert.match(preview, /full-body figure/);
    assert.ok(preview.indexOf('Must keep:') > preview.indexOf('Build:'));
    const line = traitLine({ appearance: 'amber eyes', bodyLine: 'long legs', mustKeep: 'amber eyes' }, null, null);
    assert.match(line, /Build: long legs/);
    assert.match(line, /Must keep: amber eyes/);
    const block = appearanceBlock({ cast: [{ key: 's', name: 'Sera' }] }, [{ key: 's', name: 'Sera', appearance: 'amber eyes', bodyLine: 'long legs', mustKeep: 'amber eyes', outfits: [] }]);
    assert.match(block, /Build: long legs/);
    assert.match(block, /Must keep: amber eyes/);
});

test('the chosen body photo is sent for full-body jobs and does not replace the face', () => {
    const record = person();
    assert.equal(isBodySample(record.images.find((image) => image.id === 'front')), false);
    assert.equal(isBodySample(record.images.find((image) => image.id === 'coral')), false);
    assert.equal(bodyReferenceImage(record).id, 'broad');
    assert.equal(assignBodyReference(record, 'coral'), 'broad');
    assert.equal(record.bodyRefId, 'broad');
    for (const job of ['pose', 'turnaround']) {
        const picked = selectJobReferences(record, { job, lockOutfit: true });
        assert.deepEqual(picked.images.map((image) => image.id), ['ava', 'broad'], job);
        assert.match(picked.useNote, /only for proportions/);
        assert.match(picked.useNote, /Do not take the face or the clothes/);
        assert.match(picked.useNote, /Do not change clothing/);
    }
    const matched = selectJobReferences(record, { job: 'turnaround', lockOutfit: true, outfitId: 'coral' });
    assert.deepEqual(matched.images.map((image) => image.id), ['ava', 'broad', 'coral']);
    const named = selectJobReferences(record, { job: 'pose', lockOutfit: true, outfitId: 'raincoat' });
    assert.deepEqual(named.images.map((image) => image.id), ['ava', 'broad']);
    const outfit = selectJobReferences(record, { job: 'outfit', lockOutfit: false });
    assert.equal(outfit.images[0].id, 'ava');
    assert.equal(outfit.images[1].id, 'broad');
    assert.equal(outfit.images.some((image) => image.id === 'slim'), false);
    assert.match(outfit.useNote, /only for proportions/);
    const open = selectJobReferences(record, { job: 'pose', lockOutfit: false });
    assert.deepEqual(open.images.map((image) => image.id), ['ava', 'broad', 'coral', 'pose']);
    const expression = selectJobReferences(record, { job: 'expression', lockOutfit: true });
    assert.deepEqual(expression.images.map((image) => image.id), ['ava']);
    const unset = selectJobReferences({ ...record, bodyRefId: '' }, { job: 'pose', lockOutfit: true });
    assert.deepEqual(unset.images.map((image) => image.id), ['ava']);
    assert.doesNotMatch(unset.useNote, /proportions/);
});

test('clearing the picture clears the body reference', () => {
    const record = emptyRecord({ key: 's', name: 'Sera', kind: 'character' });
    record.images.push(photo('broad', 'body'));
    record.bodyRefId = 'broad';
    record.bodyLine = 'athletic, narrow waist, long legs';
    removeImage(record, 'broad');
    assert.equal(record.bodyRefId, '');
    assert.equal(record.bodyLine, 'athletic, narrow waist, long legs');
    const saved = { key: 's', bodyLine: '' };
    onBoardInput({ target: { dataset: { field: 'bodyLine', key: 's' }, value: 'athletic, narrow waist, long legs' } }, {
        record: () => saved,
        save() {},
    });
    assert.equal(saved.bodyLine, 'athletic, narrow waist, long legs');
});

test('the character page has one body line and one body reference picker', () => {
    const record = person();
    const html = renderBoard({
        personas: [],
        characters: [record],
        places: [],
        proposals: [],
        links: {},
        allBoards: [record],
        boardFor: () => null,
        forms: {},
        studio: null,
        imageModel: 'mock',
        suitePreset: 'quick',
        expressionList: '',
        activeName: 'Sera',
        focusKey: 'sera',
        openDetails: [],
        medium: () => '',
        voiceFor: () => '',
        placeName: '',
        placeKind: 'location',
        charLookOpen: false,
    });
    const lookStart = html.indexOf('id="stsv-char-look"');
    const lookEnd = html.indexOf('</details>', lookStart);
    const look = html.slice(lookStart, lookEnd);
    assert.match(look, /data-field="mustKeep"/);
    assert.doesNotMatch(look, /data-field="bodyLine"/);
    assert.match(html, /Body \/ proportions/);
    assert.match(html, /placeholder="athletic, narrow waist, long legs"/);
    assert.match(html, /data-field="bodyLine"/);
    assert.match(html, /value="athletic, narrow waist, long legs"/);
    assert.match(html, /The character's figure, not their clothes/);
    assert.match(html, /aria-label="Body reference"/);
    assert.match(html, /data-act="pick-body-ref"/);
    assert.match(html, /data-act="add-body-ref"/);
    assert.match(html, /data-act="clear-body-ref"/);
    assert.match(html, /One photo of a body type/);
    assert.match(html, /The face still comes from the main picture/);
    assert.match(html, /<option value="broad"[^>]*>Broad<\/option>/);
    assert.match(html, /<option value="slim"[^>]*>Slim<\/option>/);
    assert.doesNotMatch(html, /<option value="coral"/);
    assert.doesNotMatch(html, /<option value="front"/);
    assert.match(html, /alt="Body reference"/);
    assert.match(html, /Figure: athletic, narrow waist, long legs · Broad/);
    const field = html.indexOf('data-field="bodyLine"');
    const outfit = html.indexOf('id="stsv-suite-outfit"');
    assert.ok(field >= 0 && field < outfit);
});
