import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { testProviderConnection } from '../lib/connect.js';
import { explainError, formatFailure } from '../lib/debug.js';
import { generateReferenceImage } from '../lib/providers/image.js';
import { generateOpenRouterVideo } from '../lib/providers/openrouter.js';

const SECRET = 'sk-or-v1-supersecretvalue';

function jsonResponse(status, message) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify({ error: { message } }),
        json: async () => ({ error: { message } }),
    };
}

test('an empty OpenRouter key is refused before the still or the video', async () => {
    let calls = 0;
    const fetchImpl = async () => {
        calls += 1;
        throw new Error('fetch should not run');
    };
    await assert.rejects(
        () => generateReferenceImage({
            modelId: 'google/gemini-2.5-flash-image',
            prompt: 'rain',
            settings: { openrouterKey: '   ', corsMode: 'direct' },
            corsMode: 'direct',
            fetchImpl,
        }),
        (error) => {
            assert.equal(error.message, 'No OpenRouter key yet.');
            assert.equal(error.provider, 'openrouter');
            assert.equal(error.step, 'still');
            return true;
        },
    );
    await assert.rejects(
        () => generateOpenRouterVideo({
            settings: { openrouterKey: '' },
            fetchImpl,
        }),
        /No OpenRouter key yet/,
    );
    assert.equal(calls, 0);
    const explained = explainError({ message: 'No OpenRouter key yet.', provider: 'openrouter', step: 'still', emptyKey: true });
    assert.match(explained.plain, /No OpenRouter key yet/);
    assert.doesNotMatch(explained.plain, /rejected the credentials/);
    assert.match(explained.fix, /Extensions → Thoughtform/);
});

test('OpenRouter 401 names the still and does not echo the key', async () => {
    await assert.rejects(
        () => generateReferenceImage({
            modelId: 'google/gemini-2.5-flash-image',
            prompt: 'rain',
            settings: { openrouterKey: SECRET, corsMode: 'direct' },
            corsMode: 'direct',
            fetchImpl: async () => jsonResponse(401, `Invalid API key ${SECRET}`),
        }),
        (error) => {
            assert.equal(error.status, 401);
            assert.equal(error.step, 'still');
            const explained = formatFailure(error);
            assert.match(explained.plain, /OpenRouter rejected the key while making the still/);
            assert.match(explained.text, /Invalid API key/);
            assert.match(explained.text, /\[redacted\]/);
            assert.doesNotMatch(explained.text, /supersecretvalue/);
            assert.match(explained.fix, /paste a valid OpenRouter key/);
            assert.doesNotMatch(explained.fix, /settings\/keys/);
            return true;
        },
    );
});

test('OpenRouter 403 is the per-key limit and 402 is the account balance', () => {
    const limit = explainError(
        { message: 'Key limit exceeded', status: 403, provider: 'openrouter', step: 'still' },
    );
    assert.match(limit.plain, /OpenRouter rejected the key while making the still/);
    assert.match(limit.detail, /Key limit exceeded/);
    assert.match(limit.fix, /openrouter\.ai\/settings\/keys/);
    assert.doesNotMatch(`${limit.detail} ${limit.fix}`, /supersecretvalue/);

    const balance = explainError(
        { message: `Insufficient credits ${SECRET}`, status: 402, provider: 'openrouter', step: 'video' },
    );
    assert.match(balance.plain, /not have enough credits to make the video/);
    assert.match(balance.fix, /openrouter\.ai\/settings\/credits/);
    assert.doesNotMatch(balance.fix, /settings\/keys/);
    assert.doesNotMatch(formatFailure({ message: `Insufficient credits ${SECRET}`, status: 402, provider: 'openrouter', step: 'video' }).text, /supersecretvalue/);

    const minimum = explainError('This request requires at least $1.00 in balance');
    assert.equal(minimum.banner, true);
    assert.match(minimum.plain, /US\$1\.00/);
});

test('a long provider message is truncated', () => {
    const explained = explainError({
        message: `Invalid API key ${'word '.repeat(80)}`,
        status: 401,
        provider: 'openrouter',
        step: 'still',
    });
    assert.ok(explained.detail.length <= 180);
    assert.match(explained.detail, /…$/);
});

test('OpenRouter video and fal still name the provider and the step', () => {
    const video = explainError({ message: 'User not found.', status: 401, provider: 'openrouter', step: 'video' });
    assert.match(video.plain, /OpenRouter rejected the key while making the video/);
    const fal = explainError({ message: 'Unauthorized', status: 401, provider: 'fal', step: 'still' });
    assert.match(fal.plain, /fal\.ai rejected the key while making the still/);
    assert.match(fal.detail, /Unauthorized/);
});

test('Test key uses the connection check and OpenRouter status codes', async () => {
    let calls = 0;
    const empty = await testProviderConnection('openrouter', { openrouterKey: '  ' }, async () => {
        calls += 1;
        throw new Error('fetch should not run');
    });
    assert.match(empty.message, /No OpenRouter key yet/);
    assert.equal(calls, 0);

    const denied = await testProviderConnection('openrouter', { openrouterKey: SECRET, corsMode: 'direct' }, async () => jsonResponse(401, 'User not found.'));
    assert.match(denied.message, /OpenRouter rejected the key/);
    assert.match(denied.fix, /valid OpenRouter key/);

    const limited = await testProviderConnection('openrouter', { openrouterKey: SECRET, corsMode: 'direct' }, async () => jsonResponse(403, 'Key limit exceeded'));
    assert.match(limited.message, /Key limit exceeded/);
    assert.match(limited.fix, /openrouter\.ai\/settings\/keys/);

    const broke = await testProviderConnection('openrouter', { openrouterKey: SECRET, corsMode: 'direct' }, async () => jsonResponse(402, `Insufficient credits ${SECRET}`));
    assert.match(broke.message, /enough credits|Insufficient credits/);
    assert.match(broke.fix, /settings\/credits/);
    assert.doesNotMatch(`${broke.message} ${broke.fix}`, /supersecretvalue/);

    const openai = await testProviderConnection('openai', { openaiKey: '' }, async () => {
        throw new Error('fetch should not run');
    });
    assert.match(openai.message, /No OpenAI-compatible key yet/);
});

test('each settings key has a Test key button wired to the connection check', () => {
    const html = readFileSync(new URL('../settings.html', import.meta.url), 'utf8');
    const boot = readFileSync(new URL('../lib/boot.js', import.meta.url), 'utf8');
    for (const id of ['openrouter', 'openai', 'xai', 'fal', 'replicate', 'custom']) {
        assert.match(html, new RegExp(`data-setting="[^"]*"`));
        assert.match(html, new RegExp(`data-test-key="${id}"`));
        assert.match(html, new RegExp(`data-test-result="${id}"`));
    }
    assert.match(boot, /data-test-key/);
    assert.match(boot, /testProviderConnection/);
    assert.match(boot, /redactText/);
});
