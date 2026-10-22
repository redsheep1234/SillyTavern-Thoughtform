import assert from 'node:assert/strict';
import test from 'node:test';
import { readJobUpdate, pollJob, resumableJobs, upsertJob } from '../lib/queue.js';
import { buildDiagnostics, redactSettings } from '../lib/debug.js';
import { ensureLibrary, syncLibrary } from '../lib/library.js';
import { castForMessages, collectCast } from '../lib/messages.js';
import { expressionListText, parseExpressionList, planReferenceSet, turnaroundForPreset } from '../lib/refset.js';
import { stillCost } from '../lib/providers/image.js';
import { buildShotListRequest, linesFromDialogue, localShotList, parseShotList } from '../lib/shotlist.js';
import { speakerCues } from '../lib/subtitles.js';
import { dialogueLines, voiceFor } from '../lib/tts.js';
import { traitLine } from '../lib/keyframes.js';
import { acceptProposal, appearanceBlock, appearanceWithoutClothes, trackOutfits } from '../lib/wardrobe.js';
import { spriteExportPlan, ST_EXPRESSIONS } from '../lib/sprites.js';
import { defaultSettings } from '../lib/constants.js';

const roster = [
    { name: 'Aki Vale', avatar: 'aki.png', description: 'Teal braid, indigo coat.' },
    { name: 'Ren Moss', avatar: 'ren.png', description: 'Copper hair, olive scarf.' },
    { name: 'Sable Orr', avatar: 'sable.png', description: 'Black coat, silver ear cuff.' },
];

function groupContext(chat) {
    return {
        name1: 'Sera Voss',
        groupId: 'market-night',
        groups: [{
            id: 'market-night',
            name: 'Night market',
            members: ['aki.png', 'ren.png', 'sable.png'],
            disabled_members: ['ren.png'],
        }],
        characters: roster,
        chat,
        powerUserSettings: {
            persona_description: 'Moth-cloak and a square lantern.',
            user_avatar: 'sera.png',
            personas: { 'sera.png': 'Sera Voss' },
        },
    };
}

const chat = [
    { name: 'Sera Voss', is_user: true, mes: 'Aki, walk with me.' },
    { name: 'Aki Vale', is_user: false, force_avatar: 'aki.png', mes: 'Aki nods.' },
    { name: 'Ren Moss', is_user: false, force_avatar: 'ren.png', mes: 'Ren keeps the cranes dry.' },
    { name: 'Sera Voss', is_user: true, mes: 'Ren stays muted after this.' },
    { name: 'Aki Vale', is_user: false, force_avatar: 'aki.png', mes: 'Aki puts on the market uniform.' },
    { name: 'Sable Orr', is_user: false, force_avatar: 'sable.png', mes: 'Sable joins and lifts a crane.' },
];

test('a group keeps muted, late, and guest members on separate cards', () => {
    const cast = collectCast(groupContext(chat));
    assert.equal(cast.characters.length, 3);
    assert.equal(cast.characters.find((item) => item.name === 'Ren Moss').muted, true);
    assert.equal(cast.characters.find((item) => item.name === 'Sable Orr').muted, false);
    const early = castForMessages(cast, [
        { name: 'Sera Voss', isUser: true, text: 'Aki, walk with me.' },
        { name: 'Aki Vale', isUser: false, text: 'Aki nods.' },
    ]);
    assert.equal(early.characters.some((item) => item.name === 'Ren Moss'), false);
    assert.equal(early.characters.some((item) => item.name === 'Sable Orr'), true);
    const withRen = castForMessages(cast, [{ name: 'Ren Moss', isUser: false, text: 'Ren keeps the cranes dry.' }]);
    assert.equal(withRen.characters.some((item) => item.name === 'Ren Moss'), true);
    const left = collectCast(groupContext([
        ...chat,
        { name: 'Ivo Pell', is_user: false, mes: 'Ivo already left the group.' },
    ]));
    assert.equal(left.characters.find((item) => item.name === 'Ivo Pell').guest, true);
});

test('local shots and subtitles keep each speaker', () => {
    const messages = chat.map((message, id) => ({
        id,
        name: message.name,
        text: message.mes,
        isUser: message.is_user,
        isSystem: false,
        avatar: message.force_avatar || '',
    }));
    const scenes = localShotList(messages, { ...defaultSettings, sceneCount: 3 });
    const speakers = scenes.flatMap((scene) => scene.lines.map((line) => line.speaker));
    assert.deepEqual([...new Set(speakers)], ['Sera Voss', 'Aki Vale', 'Ren Moss', 'Sable Orr']);
    const join = scenes.find((scene) => scene.lines.some((line) => line.speaker === 'Sable Orr'));
    assert.equal(join.characters.includes('Ren Moss'), false);
    assert.equal(join.characters.includes('Sable Orr'), true);
    const early = scenes[0];
    assert.equal(early.characters.includes('Sable Orr'), false);
    const cues = speakerCues(scenes);
    assert.ok(cues.some((cue) => cue.text.startsWith('Aki Vale:')));
    assert.ok(cues.some((cue) => cue.text.startsWith('Sable Orr:')));
    assert.ok(cues.some((cue) => cue.text.startsWith('Sera Voss:')));
    const parsed = parseShotList(JSON.stringify({
        scenes: [{
            title: 'Stall',
            prompt: 'Two people',
            duration: 5,
            dialogue: 'Aki Vale: I have the crane.\nSable Orr: It was on the stall.',
            characters: ['Aki Vale', 'Sable Orr'],
        }],
    }));
    assert.deepEqual(parsed[0].lines.map((line) => line.speaker), ['Aki Vale', 'Sable Orr']);
    const voices = { voiceMap: { 'Aki Vale': 'aki-low', 'Sable Orr': 'sable-bright', 'Sera Voss': 'sera-warm' } };
    const lines = dialogueLines(parsed);
    assert.deepEqual(lines.map((line) => voiceFor(line.speaker, voices)), ['aki-low', 'sable-bright']);
    const built = buildShotListRequest({
        messages,
        cast: { ...castForMessages(collectCast(groupContext(chat)), messages), muted: [] },
        settings: defaultSettings,
    });
    assert.match(built.systemPrompt, /one speaker per line/);
    assert.match(built.prompt, /Ren Moss \(muted\)/);
    assert.match(built.prompt, /Sable Orr \(first speaks at #5\)/);
});

test('the same outfit name stays on the character who changed', () => {
    const settings = { library: { records: {}, links: {} } };
    const library = ensureLibrary(settings);
    syncLibrary(library, { characters: roster, personas: [] });
    const aki = Object.values(library.records).find((record) => record.name === 'Aki Vale');
    const sable = Object.values(library.records).find((record) => record.name === 'Sable Orr');
    aki.outfits.push({ id: 'aki-coat', name: 'indigo coat', description: 'Aki coat' });
    aki.outfits.push({ id: 'aki-uniform', name: 'market uniform', description: 'Ochre apron, Aki' });
    aki.defaultOutfitId = 'aki-coat';
    sable.outfits.push({ id: 'sable-uniform', name: 'market uniform', description: 'Black apron, Sable' });
    sable.defaultOutfitId = 'sable-uniform';
    const scenes = [
        {
            title: 'Walk',
            prompt: 'Aki Vale walks with Sera.',
            characters: ['Aki Vale', 'Sera Voss'],
            outfits: [],
        },
        {
            title: 'Change',
            prompt: 'Aki Vale puts on the market uniform. Sable Orr keeps the crane.',
            characters: ['Aki Vale', 'Sable Orr'],
            outfits: [],
        },
    ];
    const tracked = trackOutfits(scenes, Object.values(library.records), {
        persona: { id: 'sera.png', name: 'Sera Voss', boardKey: 'persona:sera.png' },
        userName: 'Sera Voss',
    });
    const akiFirst = tracked.scenes[0].cast.find((member) => member.name === 'Aki Vale');
    const akiSecond = tracked.scenes[1].cast.find((member) => member.name === 'Aki Vale');
    const sableSecond = tracked.scenes[1].cast.find((member) => member.name === 'Sable Orr');
    assert.equal(akiFirst.outfitId, 'aki-coat');
    assert.equal(akiSecond.outfitId, 'aki-uniform');
    assert.equal(sableSecond.outfitId, 'sable-uniform');
    assert.equal(tracked.proposals.length, 0);
    const proposed = trackOutfits([{
        title: 'New',
        prompt: 'Sable Orr puts on a paper cape.',
        characters: ['Sable Orr', 'Aki Vale'],
        outfits: [],
    }], Object.values(library.records));
    assert.equal(proposed.proposals.length, 1);
    assert.equal(proposed.proposals[0].characterName, 'Sable Orr');
    assert.equal(sable.outfits.some((outfit) => outfit.name === proposed.proposals[0].name), false);
    const saved = acceptProposal(sable, proposed.proposals[0]);
    assert.equal(sable.outfits.some((outfit) => outfit.id === saved.id), true);
});

test('reference set maps happy to joy and prices the mock at zero', () => {
    const plan = planReferenceSet({ includeExpressions: true, includeTurnaround: false, includeCloseups: false });
    assert.equal(plan.find((item) => item.label === 'happy').stLabel, 'joy');
    assert.match(plan.find((item) => item.id === 'expr-happy').prompt, /3:4/);
    assert.doesNotMatch(plan.find((item) => item.id === 'expr-happy').prompt, /sheet/i);
    assert.equal(plan.find((item) => item.id === 'expr-happy').aspectRatio, '3:4');
    const cost = stillCost(plan.length, 'mock');
    assert.equal(cost.usd, 0);
    const gemini = stillCost(12, 'google/gemini-2.5-flash-image');
    assert.equal(gemini.quote, '12 images ≈ US$0.47 / A$0.71');
    const quick = planReferenceSet({
        expressions: parseExpressionList(expressionListText('quick')),
        includeExpressions: true,
        includeTurnaround: true,
        turnaround: turnaroundForPreset('quick'),
    });
    assert.equal(quick.filter((item) => item.tags.includes('expression')).length, 4);
    assert.equal(quick.find((item) => item.id === 'turn-front').aspectRatio, '16:9');
    assert.match(quick.find((item) => item.id === 'turn-front').prompt, /single full-body figure/);
    assert.equal(parseExpressionList('joy')[0].label, 'joy');
    assert.equal(appearanceWithoutClothes('Short silver bob, amber eyes, dark green raincoat.'), 'Short silver bob, amber eyes');
    const worn = traitLine({
        appearance: 'Short silver bob, amber eyes, dark green raincoat.',
        mustKeep: 'silver bob, amber eyes',
    }, { id: 'dress', name: 'Emerald dress', description: 'a floor-length emerald dress' }, null);
    assert.match(worn, /emerald dress/i);
    assert.match(worn, /silver bob/);
    assert.doesNotMatch(worn, /raincoat/);
    const block = appearanceBlock({
        cast: [{ key: 's', name: 'Sera', outfitId: 'dress' }],
    }, [{
        key: 's',
        name: 'Sera',
        appearance: 'Short silver bob, amber eyes, dark green raincoat.',
        outfits: [{ id: 'dress', name: 'Emerald dress', description: 'a floor-length emerald dress' }],
    }]);
    assert.match(block, /emerald dress/i);
    assert.doesNotMatch(block, /raincoat/);
    const record = {
        images: [
            { dataUrl: 'data:image/png,a', tags: ['expression'], label: 'joy', stLabel: 'joy' },
            { dataUrl: 'data:image/png,b', tags: ['expression'], label: 'sadness', stLabel: 'sadness' },
            { dataUrl: 'data:image/png,c', tags: ['expression'], label: 'anger', stLabel: 'anger' },
            { dataUrl: 'data:image/png,d', tags: ['expression'], label: 'neutral', stLabel: 'neutral' },
            { dataUrl: 'data:image/png,e', tags: ['expression'], label: 'happy', stLabel: 'joy' },
        ],
    };
    const exported = spriteExportPlan(record);
    assert.equal(exported.mappings.find((item) => item.from === 'happy').to, 'joy');
    assert.equal(exported.empty.length, ST_EXPRESSIONS.length - 4);
});

test('job resume reads a mocked provider payload and diagnostics hide keys', async () => {
    const job = {
        id: 'job-1',
        provider: 'xai',
        state: 'running',
        statusUrl: 'https://api.x.ai/v1/videos/req_9',
        title: 'Bridge',
    };
    assert.equal(resumableJobs([job, { id: 'done', state: 'done', statusUrl: 'https://example.invalid' }]).length, 1);
    let calls = 0;
    const update = await pollJob(job, {
        attempts: 3,
        sleep: async () => {},
        fetchImpl: async () => {
            calls += 1;
            const body = calls === 1 ? { status: 'pending' } : { status: 'done', video: { url: 'https://cdn.example/clip.mp4' } };
            return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
        },
    });
    assert.equal(update.done, true);
    assert.equal(update.url, 'https://cdn.example/clip.mp4');
    assert.equal(readJobUpdate('fal', { status: 'FAILED', error: 'bad key sk-secret' }).failed, true);
    const stored = upsertJob([], { id: 'job-1', state: 'running', statusUrl: job.statusUrl });
    assert.equal(stored[0].id, 'job-1');
    const diagnostics = buildDiagnostics({
        version: '1.0.0',
        settings: redactSettings({ xaiKey: 'sk-live-secret', provider: 'xai', library: { records: {}, links: {} } }),
    });
    assert.equal(diagnostics.settings.xaiKey, '[redacted]');
    assert.equal(JSON.stringify(diagnostics).includes('sk-live-secret'), false);
});

test('linesFromDialogue does not invent a speaker for a bare sentence', () => {
    const lines = linesFromDialogue('Aki Vale: Hello.\nJust the picture.', 'Ren Moss');
    assert.equal(lines[0].speaker, 'Aki Vale');
    assert.equal(lines[1].speaker, 'Ren Moss');
});
