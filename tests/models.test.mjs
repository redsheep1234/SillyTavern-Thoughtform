import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSettings } from '../lib/constants.js';
import { applySameProvider, choiceLine, keyStatuses, modelRows, modelWarnings, textSettingsFor } from '../lib/models.js';
import { GEMINI_IMAGE_ID } from '../lib/providers/image.js';
import { preferStillModel } from '../lib/settings.js';

function settings(extra = {}) {
    return { ...defaultSettings, ...extra };
}

test('the model table keeps the choices already saved', () => {
    const saved = settings({
        imageModel: GEMINI_IMAGE_ID,
        imageModelChosen: true,
        provider: 'fal',
        falModel: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video',
        llmSource: 'openai',
        openaiModel: 'local-writer',
        ttsProvider: 'elevenlabs',
        openrouterKey: 'sk-or-secretvalue',
    });
    const before = JSON.stringify(saved);
    const rows = modelRows(saved);
    assert.equal(JSON.stringify(saved), before);
    const pictures = rows.find((row) => row.id === 'pictures');
    const video = rows.find((row) => row.id === 'video');
    const shots = rows.find((row) => row.id === 'shots');
    assert.equal(pictures.modelId, GEMINI_IMAGE_ID);
    assert.equal(pictures.providerLabel, 'OpenRouter');
    assert.equal(pictures.key.state, 'ok');
    assert.equal(video.providerId, 'fal');
    assert.equal(shots.modelLabel, 'local-writer');
    assert.equal(choiceLine(saved, 'pictures'), 'Pictures: Gemini image (OpenRouter)');
    assert.equal(JSON.stringify(rows).includes('sk-or-secretvalue'), false);
    assert.equal(JSON.stringify(keyStatuses(saved)).includes('sk-or-secretvalue'), false);
});

test('mock pictures warn that a suite cannot keep a likeness', () => {
    const notes = modelWarnings(settings());
    assert.match(notes.find((item) => item.id === 'pictures').text, /text card/);
    assert.match(notes.find((item) => item.id === 'pictures').text, /reference photos/);
    const video = modelWarnings(settings({ provider: 'mock' }));
    assert.match(video.find((item) => item.id === 'video').text, /title card/);
});

test('a picture model names the missing key and hides a saved one', () => {
    const missing = modelRows(settings({ imageModel: GEMINI_IMAGE_ID, imageModelChosen: true }));
    assert.equal(missing.find((row) => row.id === 'pictures').key.state, 'needs');
    assert.match(missing.find((row) => row.id === 'pictures').warnings.join(' '), /OpenRouter key/);
    const ready = modelRows(settings({ imageModel: GEMINI_IMAGE_ID, imageModelChosen: true, openrouterKey: 'sk-or-secretvalue' }));
    assert.equal(ready.find((row) => row.id === 'pictures').key.state, 'ok');
    assert.equal(ready.find((row) => row.id === 'pictures').warnings.some((text) => /OpenRouter key/.test(text)), false);
});

test('one provider fills the tasks it can do and leaves the rest', () => {
    const openrouter = settings({ openrouterKey: 'sk-or-secretvalue', ttsProvider: 'elevenlabs', musicTrackId: 'rain' });
    const applied = applySameProvider(openrouter, 'openrouter');
    assert.equal(openrouter.imageModel, GEMINI_IMAGE_ID);
    assert.equal(openrouter.imageModelChosen, true);
    assert.equal(openrouter.provider, 'openrouter');
    assert.equal(openrouter.llmSource, 'openrouter');
    assert.equal(openrouter.describeSource, '');
    assert.equal(openrouter.ttsProvider, 'elevenlabs');
    assert.equal(openrouter.openrouterKey, 'sk-or-secretvalue');
    assert.match(applied.skipped.join(' '), /Voice stays/);
    assert.match(applied.skipped.join(' '), /Lip-sync stays/);

    const local = settings();
    applySameProvider(local, 'comfyui');
    assert.equal(local.imageModel, 'comfy');
    assert.equal(local.provider, 'comfyui');
    assert.equal(local.lipSyncModel, 'comfy');
    assert.equal(local.llmSource, 'sillytavern');

    const hosted = settings();
    applySameProvider(hosted, 'fal');
    assert.equal(hosted.imageModel, 'fal-ai/flux-pro/kontext/multi');
    assert.equal(hosted.provider, 'fal');
    assert.equal(hosted.lipSyncModel, 'fal-ai/sync-lipsync/v3');

    const preview = settings({ openrouterKey: 'sk-or-secretvalue' });
    applySameProvider(preview, 'mock');
    assert.equal(preview.imageModel, 'mock');
    assert.equal(preview.provider, 'mock');
    assert.equal(preview.ttsProvider, 'mock');
    assert.equal(preferStillModel(preview), false);
    assert.equal(preview.imageModel, 'mock');
});

test('describe a picture can follow the shot list or use its own model', () => {
    const followed = settings({ llmSource: 'openrouter' });
    assert.match(choiceLine(followed, 'describe'), /Same as shot list/);
    assert.equal(textSettingsFor(followed, { image: 'data:image/png,x' }), followed);
    const own = settings({ llmSource: 'sillytavern', describeSource: 'openrouter' });
    const seeing = textSettingsFor(own, { image: 'data:image/png,x' });
    assert.equal(seeing.llmSource, 'openrouter');
    assert.equal(textSettingsFor(own).llmSource, 'sillytavern');
    assert.match(modelRows(own).find((row) => row.id === 'describe').warnings.join(' '), /OpenRouter key/);
});
