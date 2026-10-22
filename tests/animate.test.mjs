import assert from 'node:assert/strict';
import test from 'node:test';
import { animatePrompt } from '../lib/animate.js';
import { defaultSettings } from '../lib/constants.js';
import { buildVideoCall } from '../lib/scene-request.js';

test('animate this still sends the picture as the keyframe', () => {
    const prompt = animatePrompt('Aki at the stall');
    assert.match(prompt, /Aki at the stall/);
    assert.match(prompt, /keyframe/);
    const call = buildVideoCall({
        scene: {
            prompt,
            keyframeDataUrl: 'data:image/png;base64,abc',
            keyframeApproved: true,
            keyframeMock: false,
            duration: 5,
            cast: [],
        },
        settings: { ...defaultSettings, consistency: 'keyframe', imageModel: 'openrouter', seed: '' },
        records: [],
        providerId: 'xai',
        modelId: 'grok-imagine-video-1.5-lite',
    });
    assert.equal(call.imageDataUrl, 'data:image/png;base64,abc');
});
