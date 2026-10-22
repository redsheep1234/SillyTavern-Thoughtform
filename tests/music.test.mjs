import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSettings } from '../lib/constants.js';
import { musicForAnimatic, pickTrack } from '../lib/sound.js';

test('music stays off unless the user picks a track or a tag', () => {
    const library = [
        { id: 'rain', name: 'Night rain', url: 'data:audio/mpeg,aaa', tags: ['rain', 'tense'] },
        { id: 'room', name: 'Room tone', url: 'data:audio/mpeg,bbb', tags: ['quiet'] },
    ];
    assert.equal(defaultSettings.musicEnabled, false);
    assert.deepEqual(defaultSettings.audioLibrary, []);
    assert.equal(musicForAnimatic({ enabled: false, library, trackId: 'rain' }), null);
    assert.equal(musicForAnimatic({ enabled: true, library, trackId: 'rain' }).name, 'Night rain');
    assert.equal(pickTrack(library, { tag: 'quiet' }).id, 'room');
    assert.equal(musicForAnimatic({ enabled: true, library: [], tag: 'rain' }), null);
});
