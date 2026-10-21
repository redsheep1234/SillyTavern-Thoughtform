import assert from 'node:assert/strict';
import test from 'node:test';
import { applyQualityPreset } from '../lib/presets.js';
import { defaultSettings } from '../lib/constants.js';
import {
    audToUsd,
    beatsToMessages,
    clipAssetKey,
    condenseBeats,
    fitPlan,
    formatClock,
    overCapMessage,
    usdToAud,
} from '../lib/simple.js';

test('AUD figures use the documented rough rate', () => {
    assert.equal(audToUsd(5), 3.3);
    assert.equal(usdToAud(3.3), 5);
    assert.equal(formatClock(70), '~1m10s');
});

test('a dollar cap drops Showcase to Standard before it shortens the film', () => {
    const plan = fitPlan({
        mode: 'cap',
        capAud: 8,
        providerId: 'xai',
        providerLabel: 'xAI Grok Imagine',
        quality: 'showcase',
        xaiModel: 'grok-imagine-video-1.5-lite',
        messageCount: 20,
        derive: true,
        secondsPerScene: 5,
        stillUsdEach: 0,
        stillsFirst: true,
    });
    assert.equal(plan.quality, 'standard');
    assert.equal(plan.sceneCount, 10);
    assert.equal(plan.secondsPerScene, 5);
    assert.equal(plan.usd, 1.5);
    assert.match(plan.summary, /\$2\.27 AUD/);
    assert.match(plan.summary, /10 scenes/);
    assert.match(plan.summary, /~50s/);
    assert.match(plan.note, /Moving stills first/);
    assert.equal(plan.fits, true);
});

test('length mode aims at the requested runtime', () => {
    const plan = fitPlan({
        mode: 'length',
        targetSeconds: 70,
        providerId: 'mock',
        providerLabel: 'Mock',
        quality: 'draft',
        messageCount: 12,
        derive: true,
        stillUsdEach: 0,
        stillsFirst: false,
    });
    assert.equal(plan.sceneCount, 7);
    assert.equal(plan.secondsPerScene, 10);
    assert.equal(plan.totalSeconds, 70);
    assert.match(plan.summary, /~1m10s/);
});

test('cached scenes are free and a higher look is a different clip', () => {
    const plan = fitPlan({
        providerId: 'xai',
        providerLabel: 'xAI',
        quality: 'standard',
        xaiModel: 'grok-imagine-video-1.5-lite',
        capAud: 0,
        stillsFirst: true,
        stillUsdEach: 0.04,
        scenes: [
            { seconds: 5, asVideo: true, cachedClip: true, cachedStill: true, stills: 1 },
            { seconds: 5, asVideo: false, cachedStill: false, stills: 1 },
        ],
    });
    assert.equal(plan.lines[0].label, 'cached, $0');
    assert.equal(plan.lines[0].usd, 0);
    assert.equal(plan.lines[1].usd, 0.04);
    assert.match(plan.summary, /cached, \$0/);
    const draft = clipAssetKey({ prompt: 'same', provider: 'xai', modelId: 'lite', resolution: '480p', fps: 16, seconds: 5, quality: 'draft', stillKey: 'k' });
    const again = clipAssetKey({ prompt: 'same', provider: 'xai', modelId: 'lite', resolution: '480p', fps: 16, seconds: 5, quality: 'draft', stillKey: 'k' });
    const showcase = clipAssetKey({ prompt: 'same', provider: 'xai', modelId: 'lite', resolution: '1080p', fps: 24, seconds: 5, quality: 'showcase', stillKey: 'k' });
    assert.equal(draft, again);
    assert.notEqual(draft, showcase);
});

test('short medium and full beat lists shrink a long chat', () => {
    const messages = Array.from({ length: 12 }, (_, index) => ({
        id: index,
        name: index % 2 ? 'Aki' : 'Lumen',
        text: `Line ${index}. The bridge is wet.`,
    }));
    const full = condenseBeats(messages, 'full');
    const medium = condenseBeats(messages, 'medium');
    const short = condenseBeats(messages, 'short');
    assert.equal(full.length, 12);
    assert.equal(medium.length, 4);
    assert.equal(short.length, 2);
    medium[0].text = 'Edited beat';
    assert.equal(beatsToMessages(medium)[0].text, 'Edited beat');
});

test('passing the cap asks before it continues', () => {
    const message = overCapMessage({ projectedUsd: 4.2, capAud: 5 });
    assert.match(message, /5\.00 AUD/);
    assert.match(message, /\$4\.20 USD/);
    assert.match(message, /Continue past the cap/);
});

test('showcase is the sharp preset and draft stays 480p', () => {
    const settings = structuredClone(defaultSettings);
    applyQualityPreset(settings, 'showcase');
    assert.equal(settings.quality, 'showcase');
    assert.equal(settings.resolution, '1080p');
    assert.equal(settings.xaiModel, 'grok-imagine-video-1.5-lite');
    applyQualityPreset(settings, 'draft');
    assert.equal(settings.resolution, '480p');
});
