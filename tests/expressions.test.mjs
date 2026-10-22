import assert from 'node:assert/strict';
import test from 'node:test';
import { EXPRESSION_TABLE, fillExpressionCopies, fullExpressionNames } from '../lib/expressions.js';
import { stillCost } from '../lib/providers/image.js';
import { expressionListText, parseExpressionList, planReferenceSet, resolveSuiteExpressions, suiteQuote, turnaroundForPreset } from '../lib/refset.js';
import { spriteExportPlan, ST_EXPRESSIONS, zipExpressionSet } from '../lib/sprites.js';
import { renderBoard } from '../lib/ui/board.js';

const DRAWN = [
    'neutral', 'joy', 'amusement', 'sadness', 'grief', 'anger', 'surprise', 'fear',
    'embarrassment', 'pride', 'curiosity', 'desire', 'admiration', 'disgust', 'confusion', 'nervousness',
];

const COPIES = {
    love: 'admiration',
    caring: 'admiration',
    gratitude: 'admiration',
    approval: 'joy',
    optimism: 'joy',
    relief: 'joy',
    excitement: 'amusement',
    annoyance: 'anger',
    disapproval: 'anger',
    disappointment: 'sadness',
    remorse: 'sadness',
    realization: 'surprise',
};

function fullPlan(extras = []) {
    return planReferenceSet({
        expressions: resolveSuiteExpressions(expressionListText('full'), { extras, full: true }),
        includeExpressions: true,
        includeTurnaround: true,
        turnaround: turnaroundForPreset('full'),
        includeCloseups: false,
    });
}

test('the expression table covers every SillyTavern label once', () => {
    const names = fullExpressionNames();
    assert.equal(names.length, ST_EXPRESSIONS.length);
    assert.deepEqual([...names].sort(), [...ST_EXPRESSIONS].sort());
    const ids = EXPRESSION_TABLE.map((row) => row.st);
    assert.equal(new Set(ids).size, ids.length);
});

test('full draws the distinct faces and copies the near-duplicates for free', () => {
    const plan = fullPlan();
    const faces = plan.filter((item) => item.tags.includes('expression'));
    assert.equal(faces.length, 28);
    for (const name of DRAWN) {
        const item = faces.find((entry) => entry.stLabel === name);
        assert.equal(item.copyOf, '', name);
        assert.match(item.prompt, /Portrait/);
    }
    assert.match(faces.find((item) => item.stLabel === 'desire').prompt, /face only/i);
    assert.match(faces.find((item) => item.stLabel === 'admiration').prompt, /adoring/i);
    for (const [name, source] of Object.entries(COPIES)) {
        assert.equal(faces.find((item) => item.stLabel === name).copyOf, source, name);
    }
    assert.equal(faces.some((item) => item.stLabel === 'determined' || item.stLabel === 'tired'), false);
    const billed = plan.filter((item) => !item.copyOf);
    assert.equal(billed.length, DRAWN.length + 8);
    const quote = suiteQuote(plan, 'google/gemini-2.5-flash-image');
    assert.equal(quote, `28 expressions, about ${billed.length} new pictures (copies are free) · ${stillCost(billed.length, 'google/gemini-2.5-flash-image').label}`);
    assert.equal(stillCost(faces.length, 'google/gemini-2.5-flash-image').usd > stillCost(billed.filter((item) => item.tags.includes('expression')).length, 'google/gemini-2.5-flash-image').usd, true);
});

test('excitement, disappointment, determined, and tired stay off until asked', () => {
    const plain = fullPlan();
    assert.equal(plain.find((item) => item.stLabel === 'excitement').copyOf, 'amusement');
    assert.equal(plain.find((item) => item.stLabel === 'disappointment').copyOf, 'sadness');
    const unique = fullPlan(['excitement', 'disappointment', 'determined', 'tired']);
    assert.equal(unique.find((item) => item.stLabel === 'excitement').copyOf, '');
    assert.equal(unique.find((item) => item.stLabel === 'disappointment').copyOf, '');
    assert.equal(unique.find((item) => item.stLabel === 'determined').copyOf, '');
    assert.equal(unique.find((item) => item.stLabel === 'tired').copyOf, '');
    assert.match(unique.find((item) => item.stLabel === 'excitement').prompt, /Not a laugh/);
    const faces = unique.filter((item) => item.tags.includes('expression') && !item.copyOf);
    assert.equal(faces.length, DRAWN.length + 4);
});

test('a copy reuses the drawn picture and does not become its own charge', () => {
    const items = [
        { stLabel: 'joy', label: 'joy', dataUrl: 'data:image/png,joy', copyOf: '' },
        { stLabel: 'love', label: 'love', copyOf: 'joy', dataUrl: '' },
        { stLabel: 'approval', label: 'approval', copyOf: 'joy', dataUrl: '' },
        { stLabel: 'admiration', label: 'admiration', copyOf: '', error: 'failed' },
        { stLabel: 'caring', label: 'caring', copyOf: 'admiration', dataUrl: '' },
    ];
    fillExpressionCopies(items);
    assert.equal(items[1].dataUrl, 'data:image/png,joy');
    assert.equal(items[2].dataUrl, 'data:image/png,joy');
    assert.match(items[4].error, /No admiration picture to copy/);
    assert.equal(parseExpressionList('').some((item) => item.label === 'happy'), true);
    assert.equal(parseExpressionList('joy')[0].label, 'joy');
});

test('export writes all 28 SillyTavern files, using copies when that face was not drawn', () => {
    const png = 'data:image/png;base64,aa';
    const images = DRAWN.map((name) => ({
        dataUrl: png,
        tags: ['expression'],
        label: name,
        stLabel: name,
    }));
    const record = { name: 'Sera', stName: 'Sera', images };
    const plan = spriteExportPlan(record);
    assert.equal(plan.empty.length, 0);
    assert.equal(plan.targets.length, 28);
    assert.equal(plan.targets.find((item) => item.stLabel === 'love').copyOf, 'admiration');
    assert.equal(plan.mappings.find((item) => item.to === 'approval').copyOf, 'joy');
    const text = Buffer.from(zipExpressionSet(record)).toString('latin1');
    for (const name of ST_EXPRESSIONS) assert.match(text, new RegExp(`Sera/${name}\\.png`));
});

test('the Full quote and a copied result show the free copy and Make unique', () => {
    const record = {
        key: 'c',
        name: 'Aki',
        kind: 'character',
        appearance: 'amber eyes',
        images: [],
        outfits: [],
        primaryId: '',
    };
    const html = renderBoard({
        personas: [],
        characters: [record],
        places: [],
        proposals: [],
        links: {},
        allBoards: [record],
        boardFor: () => null,
        forms: {},
        studio: {
            stage: 'results',
            recordKey: 'c',
            items: [{
                label: 'love',
                stLabel: 'love',
                copyOf: 'joy',
                dataUrl: 'data:image/png,joy',
                prompt: 'Love.',
                tags: ['expression'],
            }],
        },
        imageModel: 'google/gemini-2.5-flash-image',
        suitePreset: 'full',
        expressionList: expressionListText('full'),
        expressionExtras: [],
    });
    assert.match(html, /28 expressions, about \d+ new pictures \(copies are free\)/);
    assert.match(html, /copy of joy/);
    assert.match(html, /data-act="make-unique"/);
    assert.match(html, /data-extra="determined"/);
    assert.match(html, /data-extra="tired"/);
    assert.doesNotMatch(html, /data-extra="determined"[^>]*checked/);
});
