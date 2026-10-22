import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderBoard } from '../lib/ui/board.js';
import { expressionCoverage } from '../lib/refset.js';
import { replacementPrompt } from '../lib/relations.js';
import { stillAssetKey } from '../lib/simple.js';

function model(extra = {}) {
    const record = {
        key: 'c',
        name: 'Aki',
        kind: 'character',
        appearance: 'amber eyes',
        mustKeep: 'amber eyes',
        mayChange: 'outfit',
        images: [{
            id: 'h',
            label: 'happy',
            stLabel: 'joy',
            tags: ['expression', 'face'],
            source: 'generated',
            dataUrl: 'data:image/png,x',
            prompt: 'smile',
        }],
        outfits: [{ id: 'coat', name: 'coat', description: 'wool coat' }],
        primaryId: 'h',
    };
    return {
        personas: [],
        characters: [record],
        places: [],
        proposals: [],
        links: {},
        allBoards: [record],
        boardFor: () => null,
        forms: {},
        studio: null,
        imageModel: 'google/gemini-2.5-flash-image',
        suitePreset: 'quick',
        expressionList: '',
        activeName: 'Aki',
        focusKey: 'c',
        openDetails: [],
        medium: () => '',
        voiceFor: () => '',
        placeName: '',
        placeKind: 'location',
        ...extra,
    };
}

test('the board shows Quick, a main-picture star, and an Approved badge', () => {
    const html = renderBoard(model());
    assert.match(html, /data-preset="quick"[^>]*aria-pressed="true"/);
    assert.match(html, /data-preset="custom"[^>]*aria-pressed="false"/);
    assert.match(html, /aria-label="Main picture"/);
    assert.match(html, /stsv-approved-badge">Approved/);
    assert.match(html, /id="stsv-jump-look"/);
    assert.match(html, /Must keep/);
    assert.match(html, /May change/);
    assert.doesNotMatch(html, /· primary/);
    assert.match(html, /Export to SillyTavern expressions uploads into the character/);
    assert.match(html, />joy</);
    assert.match(html, /joy <span>done<\/span>/);
});

test('a custom expression list selects Custom', () => {
    const html = renderBoard(model({ expressionList: 'joy\nwonder', suitePreset: 'custom' }));
    assert.match(html, /data-preset="custom"[^>]*aria-pressed="true"/);
    assert.match(html, /data-preset="quick"[^>]*aria-pressed="false"/);
    assert.match(html, /data-preset="full"[^>]*aria-pressed="false"/);
});

test('redo renders on the card with the charge and Use new', () => {
    const html = renderBoard(model({
        studio: {
            stage: 'replace',
            recordKey: 'c',
            imageId: 'h',
            busy: false,
            charge: 'A$0.06',
            aspectRatio: '3:4',
            previousDataUrl: 'data:image/png,old',
            items: [{ label: 'happy', dataUrl: 'data:image/png,new', tags: ['expression'], prompt: 'portrait' }],
        },
    }));
    assert.match(html, /class="stsv-redo stsv-redo-portrait"/);
    assert.match(html, /Use new/);
    assert.match(html, /Keep current/);
    assert.match(html, /Charged A\$0\.06/);
    assert.match(html, /alt="New still"/);
});

test('a busy redo shows on the card before the new still exists', () => {
    const html = renderBoard(model({
        studio: {
            stage: 'replace',
            recordKey: 'c',
            imageId: 'h',
            busy: true,
            quoted: 'A$0.06',
            aspectRatio: '3:4',
            previousDataUrl: 'data:image/png,old',
            items: [{ label: 'happy', dataUrl: '', tags: ['expression'], prompt: 'portrait', error: '' }],
        },
    }));
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /Redrawing happy/);
    assert.match(html, /About A\$0\.06/);
    assert.doesNotMatch(html, /data-act="approve-staged"/);
});

test('existing happy, sad, and surprised stills count as the SillyTavern names', () => {
    const rows = expressionCoverage({
        images: [
            { tags: ['expression'], label: 'happy', stLabel: 'joy' },
            { tags: ['expression'], label: 'sad', stLabel: 'sadness' },
            { tags: ['expression'], label: 'surprised', stLabel: 'surprise' },
        ],
    }, ['neutral', 'joy', 'sadness', 'anger']);
    const byName = Object.fromEntries(rows.map((row) => [row.name, row.done]));
    assert.equal(byName.joy, true);
    assert.equal(byName.sadness, true);
    assert.equal(byName.surprise, true);
    assert.equal(byName.anger, false);
    assert.equal(byName.neutral, false);
});

test('an expression redo asks for a portrait and a different seed changes the cache key', () => {
    const prompt = replacementPrompt(
        { appearance: 'amber eyes' },
        { label: 'happy', tags: ['expression'], prompt: 'smile' },
        { vary: true, seed: 7 },
    );
    assert.match(prompt, /Portrait framing/);
    assert.match(prompt, /3:4/);
    assert.match(prompt, /Variation 7/);
    const base = { prompt: 'same', modelId: 'mock', aspectRatio: '3:4' };
    assert.notEqual(stillAssetKey({ ...base, seed: 1 }), stillAssetKey({ ...base, seed: 2 }));
    assert.equal(stillAssetKey(base), stillAssetKey({ ...base, seed: '' }));
});

test('the mock clip stays a title card', () => {
    const mock = readFileSync(new URL('../lib/providers/mock.js', import.meta.url), 'utf8');
    assert.doesNotMatch(mock, /drawImage/);
    assert.match(mock, /Thoughtform mock/);
});
