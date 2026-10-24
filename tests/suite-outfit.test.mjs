import assert from 'node:assert/strict';
import test from 'node:test';
import { selectJobReferences } from '../lib/inspiration.js';
import { replacementPrompt } from '../lib/relations.js';
import { EXPRESSION_FRAMING, planReferenceSet, TURNAROUND } from '../lib/refset.js';
import {
    clothingClause,
    defaultOutfitFor,
    locksOutfit,
    resolveSetting,
    seedSuiteOutfit,
    suiteOutfitLabel,
} from '../lib/suite-outfit.js';

function fresh(extra = {}) {
    return {
        name: extra.name || 'Pat',
        appearance: extra.appearance || '',
        pronouns: extra.pronouns || '',
        scenario: extra.scenario || '',
        ...extra,
    };
}

test('no clothing in the picture or the card uses the modest default', () => {
    const record = fresh({ appearance: 'amber eyes' });
    seedSuiteOutfit(record, {});
    assert.equal(record.suiteOutfitFrom, 'default');
    assert.equal(suiteOutfitLabel(record), 'default (none found in picture)');
    assert.match(record.suiteOutfit, /plain fitted athletic wear, modest, non-revealing/);
    assert.match(clothingClause(record.suiteOutfit), /Fully clothed, wearing exactly:/);
    assert.doesNotMatch(record.suiteOutfit, /nude|naked|shirtless/i);
    assert.doesNotMatch(clothingClause(record.suiteOutfit), /nude|naked|shirtless/i);
});

test('pronouns pick the outfit and the name never does', () => {
    const she = fresh({ pronouns: 'she/her', appearance: 'amber eyes' });
    const he = fresh({ pronouns: 'he/him', appearance: 'amber eyes' });
    const they = fresh({ pronouns: 'they/them', appearance: 'amber eyes' });
    seedSuiteOutfit(she, {});
    seedSuiteOutfit(he, {});
    seedSuiteOutfit(they, {});
    assert.match(she.suiteOutfit, /heather-grey fitted singlet/);
    assert.match(she.suiteOutfit, /mid-thigh/);
    assert.match(he.suiteOutfit, /charcoal fitted singlet/);
    assert.match(they.suiteOutfit, /heather-grey fitted plain t-shirt/);
    for (const name of ['Sarah', 'Jessica', 'Derek']) {
        const named = fresh({ name, appearance: 'amber eyes' });
        seedSuiteOutfit(named, {});
        assert.match(named.suiteOutfit, /plain t-shirt/);
        assert.doesNotMatch(named.suiteOutfit, /mid-thigh/);
    }
});

test('a card raincoat is the suite outfit and nude wording is dropped', () => {
    const sera = fresh({ appearance: 'Short silver bob, amber eyes, dark green raincoat. Fixture character, not a real person.' });
    seedSuiteOutfit(sera, {});
    assert.equal(sera.suiteOutfitFrom, 'card');
    assert.match(sera.suiteOutfit, /dark green raincoat/);
    assert.notEqual(suiteOutfitLabel(sera), 'default (none found in picture)');
    const bare = fresh({ appearance: 'amber eyes, shirtless, nude, wearing nothing' });
    seedSuiteOutfit(bare, {});
    assert.equal(bare.suiteOutfitFrom, 'default');
    assert.doesNotMatch(bare.suiteOutfit, /nude|naked|shirtless/i);
    assert.match(clothingClause(bare.suiteOutfit), /Fully clothed, wearing exactly:/);
});

test('fantasy and science fiction stay simple, and one dragon is not a genre', () => {
    const kingdom = fresh({ appearance: 'amber eyes', scenario: 'a medieval kingdom' });
    const ship = fresh({ appearance: 'amber eyes', scenario: 'aboard a spaceship' });
    const dragon = fresh({ appearance: 'amber eyes and a dragon tattoo', scenario: 'the city' });
    assert.match(defaultOutfitFor(kingdom).text, /fitted tunic and leggings/);
    assert.match(defaultOutfitFor(ship).text, /fitted plain bodysuit/);
    assert.equal(resolveSetting(dragon), 'contemporary');
    assert.match(defaultOutfitFor(dragon).text, /athletic wear/);
});

test('expressions, turnarounds, and poses lock one outfit', () => {
    const plan = planReferenceSet({
        expressions: [
            { id: 'happy', label: 'happy', st: 'joy', line: 'Happy expression, a genuine smile.' },
            { id: 'sad', label: 'sad', st: 'sadness', line: 'Sad expression, downturned mouth.' },
        ],
        includeExpressions: true,
        includeTurnaround: true,
        includeCloseups: false,
        turnaround: [
            TURNAROUND.find((view) => view.id === 'front'),
            TURNAROUND.find((view) => view.id === 'side'),
            TURNAROUND.find((view) => view.kind === 'pose'),
        ],
        appearance: 'Short silver bob, amber eyes, dark green raincoat.',
        mustKeep: 'short silver bob, amber eyes',
        suiteOutfit: 'a dark green raincoat',
        lockOutfit: true,
    });
    const joy = plan.find((item) => item.stLabel === 'joy');
    const sadness = plan.find((item) => item.stLabel === 'sadness');
    assert.match(joy.prompt, /Fully clothed, wearing exactly: a dark green raincoat/);
    assert.match(joy.prompt, /Do not change clothing/);
    assert.match(joy.prompt, /Must keep: short silver bob, amber eyes/);
    assert.ok(joy.prompt.includes(EXPRESSION_FRAMING));
    assert.ok(sadness.prompt.includes(EXPRESSION_FRAMING));
    for (const id of ['turn-front', 'turn-side']) {
        const view = plan.find((item) => item.id === id);
        assert.match(view.prompt, /dark green raincoat/);
        assert.match(view.prompt, /same outfit in every image/);
    }
    const pose = plan.find((item) => item.tags.includes('pose'));
    assert.match(pose.prompt, /Fully clothed, wearing exactly: a dark green raincoat/);
    assert.match(pose.prompt, /same outfit in every image/);
    assert.match(pose.prompt, /Do not change clothing/);
    const loose = planReferenceSet({
        expressions: [{ id: 'happy', label: 'happy', st: 'joy', line: 'Happy expression.' }],
        includeExpressions: true,
        includeTurnaround: true,
        turnaround: [TURNAROUND.find((view) => view.kind === 'pose')],
        suiteOutfit: 'a dark green raincoat',
        lockOutfit: false,
    });
    assert.match(loose[0].prompt, /Fully clothed/);
    assert.doesNotMatch(loose[0].prompt, /Do not change clothing/);
    const loosePose = loose.find((item) => item.tags.includes('pose'));
    assert.match(loosePose.prompt, /The outfit may vary/);
    assert.doesNotMatch(loosePose.prompt, /same outfit in every image/);
    const record = { varyOutfit: false, suiteOutfit: 'a light grey tee and shorts' };
    assert.equal(locksOutfit(record, ['pose', 'full body']), true);
    assert.equal(locksOutfit({ ...record, varyOutfit: true }, ['pose', 'full body']), false);
    const redo = replacementPrompt(record, { label: 'sitting', tags: ['pose', 'full body'] }, {
        lockOutfit: true,
        suiteOutfit: record.suiteOutfit,
    });
    assert.match(redo, /wearing exactly: a light grey tee and shorts/);
    assert.match(redo, /same outfit in every image/);
});

test('a locked expression sends the main picture and not a random wardrobe outfit', () => {
    const record = {
        name: 'Sera Voss',
        primaryId: 'ava',
        suiteOutfitId: '',
        images: [
            { id: 'ava', source: 'avatar', url: '/characters/sera.png', tags: ['face'], label: 'avatar' },
            { id: 'coral', source: 'inspiration', role: 'outfit', url: '/user/files/coral.jpg', tags: ['outfit'], outfitId: 'coral', label: 'Outfit' },
            { id: 'coat', source: 'generated', url: '/user/files/coat.jpg', tags: ['outfit'], outfitId: 'raincoat', label: 'Outfit' },
        ],
    };
    const locked = selectJobReferences(record, { job: 'expression', lockOutfit: true });
    assert.equal(locked.images[0].id, 'ava');
    assert.equal(locked.images.some((image) => image.outfitId === 'coral'), false);
    assert.match(locked.useNote, /Do not change clothing/);
    const named = selectJobReferences(record, { job: 'turnaround', lockOutfit: true, outfitId: 'raincoat' });
    assert.equal(named.images.some((image) => image.id === 'coat'), true);
    assert.equal(named.images.some((image) => image.outfitId === 'coral'), false);
    const open = selectJobReferences(record, { job: 'turnaround', lockOutfit: false });
    assert.equal(open.images.some((image) => image.id === 'coral' || image.id === 'coat'), true);
    const pose = selectJobReferences(record, { job: 'pose', lockOutfit: true });
    assert.equal(pose.images[0].id, 'ava');
    assert.equal(pose.images.some((image) => image.outfitId === 'coral'), false);
    assert.match(pose.useNote, /Do not change clothing/);
    const namedPose = selectJobReferences(record, { job: 'pose', lockOutfit: true, outfitId: 'raincoat' });
    assert.equal(namedPose.images.some((image) => image.id === 'coat'), true);
    assert.equal(namedPose.images.some((image) => image.outfitId === 'coral'), false);
    const openPose = selectJobReferences(record, { job: 'pose', lockOutfit: false });
    assert.equal(openPose.images.some((image) => image.id === 'coral' || image.id === 'coat'), true);
});
