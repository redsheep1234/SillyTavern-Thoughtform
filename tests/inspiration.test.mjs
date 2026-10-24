import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { addImage, emptyRecord } from '../lib/library.js';
import {
    INSPIRATION_HINT,
    boardCommandTarget,
    imageRole,
    isIdentityPhoto,
    jobForTags,
    parseRoleSuggestion,
    selectJobReferences,
    uploadRoleFromName,
} from '../lib/inspiration.js';
import { renderBoard } from '../lib/ui/board.js';

function photo(id, role, extra = {}) {
    return {
        id,
        url: id,
        source: 'inspiration',
        role,
        identity: false,
        ...extra,
    };
}

function cast() {
    return {
        name: 'Aki',
        kind: 'character',
        mustKeep: 'amber eyes',
        primaryId: 'ava',
        images: [
            { id: 'ava', source: 'avatar', tags: ['face'], url: 'ava', label: 'Avatar' },
            photo('hair', 'hair'),
            photo('body', 'body'),
            photo('dress', 'outfit'),
            photo('pose', 'pose'),
            photo('style', 'style'),
            photo('stranger', 'face'),
        ],
    };
}

test('expressions and close-ups use the identity face and hair, not a stranger', () => {
    const record = cast();
    for (const job of ['expression', 'closeup']) {
        const picked = selectJobReferences(record, { job });
        assert.deepEqual(picked.images.map((image) => image.id), ['ava']);
        assert.equal(picked.used, 'Used: avatar');
        assert.match(picked.useNote, /Must keep wins/i);
        assert.equal(picked.images.some((image) => image.id === 'hair'), false);
        assert.equal(picked.images.some((image) => image.id === 'body' || image.id === 'dress' || image.id === 'pose'), false);
        assert.equal(picked.images.some((image) => image.id === 'stranger'), false);
    }
});

test('full body, turnaround, and poses take face, build, outfit, and pose', () => {
    const record = cast();
    for (const job of ['body', 'turnaround', 'pose', 'outfit']) {
        const picked = selectJobReferences(record, { job });
        assert.deepEqual(picked.images.map((image) => image.id), ['ava', 'body', 'dress', 'pose']);
        assert.equal(picked.images.length, 4);
        assert.equal(picked.used, 'Used: avatar, Body photo, Outfit photo, Pose photo');
        assert.match(picked.useNote, /body type/i);
        assert.match(picked.useNote, /outfit/i);
        assert.match(picked.useNote, /pose/i);
        assert.match(picked.useNote, /face from the first image/i);
    }
});

test('scenes use the main picture, outfit, and style', () => {
    const picked = selectJobReferences(cast(), { job: 'scene' });
    assert.deepEqual(picked.images.map((image) => image.id), ['ava', 'dress', 'style']);
    assert.equal(picked.used, 'Used: avatar, Outfit photo, Style photo');
    assert.match(picked.useNote, /second image only for the outfit/i);
    assert.match(picked.useNote, /third image only for the style/i);
    assert.match(picked.useNote, /Must keep wins/i);
});

test('an identity inspiration face is used when the character has no avatar', () => {
    const record = {
        name: 'Aki',
        kind: 'character',
        primaryId: '',
        images: [
            photo('me', 'face', { identity: true }),
            photo('dress', 'outfit'),
        ],
    };
    const picked = selectJobReferences(record, { job: 'expression' });
    assert.deepEqual(picked.images.map((image) => image.id), ['me']);
    assert.equal(picked.used, 'Used: Face photo');
});

test('an expression redo sends the main avatar before an untagged full-body upload', () => {
    const sheet = {
        id: 'sheet',
        source: 'upload',
        label: 'Upload',
        tags: ['face'],
        url: '/user/files/upload.png',
        medium: 'live-action',
    };
    const record = {
        name: 'Sera',
        kind: 'character',
        sourceMedium: 'anime',
        primaryId: 'ava',
        mustKeep: 'amber eyes',
        images: [
            { id: 'ava', source: 'avatar', tags: ['face'], url: '/characters/sera.png', label: 'Avatar' },
            sheet,
        ],
    };
    assert.equal(uploadRoleFromName('Upload'), '');
    assert.equal(uploadRoleFromName('sera-turnaround-sheet.png'), 'body');
    assert.equal(imageRole(sheet), 'body');
    for (const job of ['expression', 'closeup']) {
        const picked = selectJobReferences(record, { job, medium: 'live-action' });
        assert.equal(picked.images[0]?.id, 'ava');
        assert.equal(picked.images.some((image) => image.id === 'sheet'), false);
        assert.match(picked.used, /^Used: avatar/);
    }
    const named = {
        ...record,
        images: [
            record.images[0],
            { ...sheet, id: 'turn', label: 'sera-turnaround.png', tags: ['face'] },
        ],
    };
    const turn = selectJobReferences(named, { job: 'expression', medium: 'live-action' });
    assert.equal(turn.images[0]?.id, 'ava');
    assert.equal(turn.images.some((image) => image.id === 'turn'), false);
});

test('an expression sends the main picture and at most two approved portraits', () => {
    const record = {
        name: 'Sera',
        kind: 'character',
        primaryId: 'ava',
        images: [
            { id: 'ava', source: 'avatar', url: 'ava', tags: ['face'], label: 'Avatar' },
            { id: 'turn', source: 'generated', url: 'turn', tags: ['turnaround', 'full body'], approved: true },
            { id: 'outfit', source: 'generated', url: 'outfit', tags: ['outfit', 'full body'], outfitId: 'coral', approved: true },
            { id: 'pose', source: 'upload', url: 'pose', tags: ['pose'], label: 'pose.png' },
            { id: 'joy', source: 'generated', url: 'joy', tags: ['expression', 'face'], stLabel: 'joy', approved: true, aspectRatio: '3:4' },
            { id: 'sad', source: 'generated', url: 'sad', tags: ['expression', 'face'], stLabel: 'sadness', approved: true, aspectRatio: '3:4' },
            { id: 'anger', source: 'generated', url: 'anger', tags: ['expression'], stLabel: 'anger', review: 'unreviewed', aspectRatio: '3:4' },
            { id: 'wide', source: 'generated', url: 'wide', tags: ['expression'], frame: 'wide', stLabel: 'joy', approved: true },
            { id: 'crop', source: 'generated', url: 'crop', tags: ['expression', 'face'], portrait: true, cropOf: 'wide', frame: 'portrait', stLabel: 'joy', approved: true, aspectRatio: '3:4' },
        ],
    };
    const picked = selectJobReferences(record, { job: 'expression', lockOutfit: true });
    assert.deepEqual(picked.images.map((image) => image.id), ['ava', 'crop', 'joy']);
    assert.match(picked.useNote, /neckline/i);
    assert.match(picked.useNote, /Do not change clothing/);
});

test('the avatar wins when an identity face photo is also on the board', () => {
    const record = cast();
    record.images.push(photo('me', 'face', { identity: true }));
    const picked = selectJobReferences(record, { job: 'expression' });
    assert.equal(picked.images[0].id, 'ava');
    assert.equal(picked.images.filter((image) => image.id === 'me').length, 0);
});

test('a generated expression stays an identity face unless inspiration says otherwise', () => {
    const record = emptyRecord({ key: 'c', name: 'Aki', kind: 'character' });
    const saved = addImage(record, { url: 'face.png', tags: ['expression', 'face'], source: 'generated', label: 'joy' });
    assert.equal(Object.hasOwn(saved, 'identity'), false);
    assert.equal(isIdentityPhoto(saved, record), true);
    const stranger = addImage(record, { url: 'x.png', role: 'face', source: 'inspiration', identity: false, label: 'Face' });
    assert.equal(stranger.identity, false);
    assert.equal(isIdentityPhoto(stranger, record), false);
});

test('role text and the board command name', () => {
    assert.equal(parseRoleSuggestion('{"role":"outfit"}'), 'outfit');
    assert.equal(parseRoleSuggestion('This is about hair.'), 'hair');
    assert.equal(parseRoleSuggestion('no idea'), '');
    assert.equal(jobForTags(['closeup']), 'closeup');
    assert.equal(jobForTags(['expression', 'face']), 'expression');
    assert.equal(jobForTags(['turnaround']), 'turnaround');
    assert.equal(jobForTags(['pose']), 'pose');
    assert.equal(jobForTags(['full body']), 'body');
    assert.equal(boardCommandTarget('', 'Aki Vale'), 'Aki Vale');
    assert.equal(boardCommandTarget('Sera', 'Aki Vale'), 'Sera');
});

test('the character page keeps one scroll and the inspiration hint', () => {
    const record = {
        key: 'c',
        name: 'Aki',
        kind: 'character',
        appearance: 'amber eyes',
        mustKeep: 'amber eyes',
        mayChange: 'outfit',
        images: [{
            id: 'dress',
            url: 'dress',
            source: 'inspiration',
            role: 'outfit',
            identity: false,
            label: 'Outfit',
        }],
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
        studio: null,
        imageModel: 'mock',
        suitePreset: 'quick',
        expressionList: '',
        activeName: 'Aki',
        focusKey: 'c',
        openDetails: [],
        medium: () => '',
        voiceFor: () => '',
        placeName: '',
        placeKind: 'location',
    });
    assert.match(html, new RegExp(INSPIRATION_HINT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(html, /Is this the character themself\?/);
    assert.match(html, /data-act="add-inspiration"/);
    assert.match(html, /0 of 28/);
    assert.match(html, /No expressions yet/);
    assert.match(html, /No turnaround yet/);
    assert.match(html, /id="stsv-jump-look"/);
    assert.match(html, /id="stsv-jump-board"/);
    assert.match(html, /data-target="stsv-jump-board">All pictures</);
    assert.match(html, /data-target="stsv-jump-suite">Build suite</);
    assert.match(html, /Describe from picture/);
    const look = html.indexOf('id="stsv-jump-look"');
    const board = html.indexOf('id="stsv-jump-board"');
    assert.ok(look >= 0 && look < board);
    const boot = readFileSync(new URL('../lib/boot.js', import.meta.url), 'utf8');
    const panel = readFileSync(new URL('../lib/panel.js', import.meta.url), 'utf8');
    const inspiration = readFileSync(new URL('../lib/inspiration.js', import.meta.url), 'utf8');
    assert.match(inspiration, /Open Thoughtform board/);
    assert.match(boot, /BOARD_BUTTON_TITLE/);
    assert.match(boot, /name: 'board'/);
    assert.match(panel, /data-act="open-board"/);
    assert.match(panel, /cost\?\.used \|\| referenceSummary/);
    assert.match(panel, /id="stsv-look-settings"/);
    assert.match(panel, /collapseLook/);
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    assert.match(css, /\.stsv-extras label \{[^}]*flex-direction:\s*row/);
    assert.match(css, /input\[type="checkbox"\][^}]*appearance:\s*auto/);
});
