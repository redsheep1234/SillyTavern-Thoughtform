import assert from 'node:assert/strict';
import test from 'node:test';
import { renderBoard } from '../lib/ui/board.js';
import {
    boardPreviewItems,
    lightboxMarkup,
    pictureSrc,
    pinchZoom,
    previewStep,
    storyPreviewItems,
    toggleZoom,
    wheelZoom,
} from '../lib/lightbox.js';

const record = {
    key: 'sera',
    name: 'Sera',
    kind: 'character',
    images: [
        { id: 'wide', label: 'Full frame', stLabel: 'anger', tags: ['expression'], frame: 'wide', file: 'user/files/wide.jpg', source: 'generated', review: 'unreviewed' },
        { id: 'anger', label: 'anger', stLabel: 'anger', tags: ['expression'], file: 'user/files/anger.jpg', source: 'generated', review: 'unreviewed' },
        { id: 'joy', label: 'joy', stLabel: 'joy', tags: ['expression'], url: '/user/files/joy.jpg', source: 'generated', approved: true, review: 'approved' },
        { id: 'side', label: 'side', tags: ['turnaround', 'full body'], url: '/docs/examples/side.jpg', source: 'generated' },
        { id: 'dress', label: 'Outfit', source: 'inspiration', role: 'outfit', url: '/user/files/dress.jpg' },
    ],
};

test('a stored file is the picture the overlay loads', () => {
    assert.equal(pictureSrc({ file: 'user/files/thoughtform_sera_anger.jpg', dataUrl: '', url: '' }), '/user/files/thoughtform_sera_anger.jpg');
    assert.equal(pictureSrc({ url: '/user/files/joy.jpg', file: 'user/files/other.jpg' }), '/user/files/joy.jpg');
    const items = boardPreviewItems(record, 'expressions');
    assert.deepEqual(items.map((item) => item.id), ['anger', 'joy']);
    assert.equal(items[0].src, '/user/files/anger.jpg');
    assert.equal(items[0].label, 'anger');
    assert.deepEqual(items[0].actions.map((action) => action.label), ['Approve', 'Redo', 'Redo — wrong outfit', 'Bin']);
    assert.deepEqual(items[1].actions.map((action) => action.label), ['Redo', 'Redo — wrong outfit', 'Bin']);
    const html = lightboxMarkup(items[0], { index: 0, count: 2 });
    assert.match(html, /src="\/user\/files\/anger\.jpg"/);
    assert.match(html, /anger/);
    assert.match(html, />Approve</);
    assert.match(html, /Redo — wrong outfit/);
    assert.match(html, />Bin</);
    assert.match(html, /Previous picture/);
    assert.match(html, /disabled/);
    assert.match(html, /Close preview/);
});

test('arrows stay inside the set and a wide original is not an expression', () => {
    const items = boardPreviewItems(record, 'expressions');
    const next = previewStep(items, 'anger', 1);
    assert.equal(next.item.id, 'joy');
    assert.equal(previewStep(items, 'joy', 1).item.id, 'joy');
    assert.equal(previewStep(items, 'anger', -1).item.id, 'anger');
    const turn = boardPreviewItems(record, 'turn');
    assert.deepEqual(turn.map((item) => item.label), ['side']);
    assert.equal(turn[0].actions.some((action) => action.label === 'Redo — wrong outfit'), true);
    const inspire = boardPreviewItems(record, 'inspire');
    assert.deepEqual(inspire[0].actions.map((action) => action.label), ['Bin']);
});

test('clicking the picture toggles fit and actual size, and the wheel stays modest', () => {
    const actual = toggleZoom({ mode: 'fit', scale: 1, x: 12, y: 4 });
    assert.equal(actual.mode, 'actual');
    assert.equal(actual.scale, 1);
    assert.equal(actual.x, 0);
    assert.equal(toggleZoom(actual).mode, 'fit');
    const closer = wheelZoom({ mode: 'fit', scale: 1, x: 0, y: 0 }, -10);
    assert.equal(closer.mode, 'custom');
    assert.ok(closer.scale > 1 && closer.scale < 1.2);
    let zoom = { mode: 'custom', scale: 3.8, x: 0, y: 0 };
    zoom = wheelZoom(zoom, -1);
    assert.ok(zoom.scale <= 4);
    zoom = { mode: 'custom', scale: 0.55, x: 0, y: 0 };
    zoom = wheelZoom(zoom, 1);
    assert.ok(zoom.scale >= 0.5);
    assert.equal(pinchZoom({ mode: 'fit', scale: 1, x: 0, y: 0 }, 2).scale, 2);
});

test('a storyboard still and an unapproved studio still can be checked before they are saved', () => {
    const scenes = [
        { title: 'Doorway', keyframeFile: 'user/files/scene-1.jpg', keyframeApproved: false },
        { title: 'Street', keyframeDataUrl: '', keyframeApproved: false },
        { title: 'Rooftop', keyframeDataUrl: '/user/files/scene-3.jpg', keyframeApproved: true },
    ];
    const stills = storyPreviewItems(scenes);
    assert.deepEqual(stills.map((item) => item.label), ['Doorway', 'Rooftop']);
    assert.equal(stills[0].src, '/user/files/scene-1.jpg');
    assert.equal(stills[0].actions[0].label, 'Approve');
    assert.equal(stills[1].actions[0].disabled, true);
    const studio = {
        recordKey: 'sera',
        items: [
            { label: 'anger', stLabel: 'anger', dataUrl: '/user/files/anger.jpg', approved: false, tags: ['expression'] },
            { label: 'joy', dataUrl: '/user/files/joy.jpg', approved: true, copyOf: 'amusement' },
        ],
    };
    const pending = boardPreviewItems(record, 'studio', studio);
    assert.equal(pending[0].actions[0].label, 'Approve');
    assert.equal(pending[1].actions.some((action) => action.label === 'Make unique'), true);
    assert.match(lightboxMarkup(pending[0], { index: 0, count: 2 }), /data-act="approve-item"/);
});

test('expression thumbnails open the large preview', () => {
    const html = renderBoard({
        personas: [],
        characters: [{ ...record }],
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
    assert.match(html, /data-act="open-preview"/);
    assert.match(html, /data-preview-set="expressions"/);
    assert.match(html, /aria-label="View anger large"/);
    assert.match(html, /src="\/user\/files\/anger\.jpg"/);
    assert.match(html, /data-preview-set="turn"/);
    assert.match(html, /data-preview-set="inspire"/);
    const expressions = html.slice(html.indexOf('id="stsv-jump-expressions"'), html.indexOf('id="stsv-jump-turn"'));
    assert.match(expressions, /data-preview-id="anger"/);
    assert.doesNotMatch(expressions, /data-preview-id="wide"/);
});
