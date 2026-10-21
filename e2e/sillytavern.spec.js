import { test, expect } from '@playwright/test';

const base = process.env.ST_URL || 'http://127.0.0.1:8123';

test('SillyTavern 1.19 loads the extension and a three-member group', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(globalThis.SillyTavern?.getContext), null, { timeout: 90000 });
    await dismissWelcome(page);

    const created = await page.evaluate(async () => {
        const context = globalThis.SillyTavern.getContext();
        const headers = { ...(context.getRequestHeaders?.() || {}) };
        delete headers['Content-Type'];
        delete headers['content-type'];
        const people = [
            ['Aki Vale', 'Teal braid, indigo coat, square lantern.'],
            ['Ren Moss', 'Copper hair, olive scarf, crate of cranes.'],
            ['Sable Orr', 'Black coat, silver ear cuff, joins late.'],
        ];
        const avatars = [];
        for (const [name, description] of people) {
            const body = new FormData();
            body.set('ch_name', name);
            body.set('file_name', name.replace(/\s+/g, '_'));
            body.set('description', description);
            body.set('personality', 'Speaks only their own lines.');
            body.set('scenario', 'Night market group.');
            body.set('first_mes', `${name} is here.`);
            const response = await fetch('/api/characters/create', { method: 'POST', headers, body });
            if (!response.ok) throw new Error(`create ${name} failed ${response.status}`);
            avatars.push((await response.text()).trim());
        }
        const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };
        const groupResponse = await fetch('/api/groups/create', {
            method: 'POST',
            headers: jsonHeaders,
            body: JSON.stringify({
                name: 'Night market',
                members: avatars,
                disabled_members: [avatars[1]],
                chat_id: 'market',
                chats: ['market'],
            }),
        });
        if (!groupResponse.ok) throw new Error(`group failed ${groupResponse.status}`);
        const group = await groupResponse.json();
        const chat = [
            { chat_metadata: {} },
            { name: 'Sera Voss', is_user: true, mes: 'Aki, walk with me.', send_date: 'October 21, 2026' },
            { name: 'Aki Vale', is_user: false, mes: 'Aki nods and keeps the indigo coat.', send_date: 'October 21, 2026' },
            { name: 'Ren Moss', is_user: false, mes: 'Ren keeps the cranes dry.', send_date: 'October 21, 2026' },
            { name: 'Sera Voss', is_user: true, mes: 'Ren stays quiet. Aki, the bridge is ours.', send_date: 'October 21, 2026' },
            { name: 'Aki Vale', is_user: false, mes: 'Aki puts on the market uniform.', send_date: 'October 21, 2026' },
            { name: 'Sable Orr', is_user: false, mes: 'Sable joins and lifts one crane.', send_date: 'October 21, 2026' },
        ];
        const saved = await fetch('/api/chats/group/save', {
            method: 'POST',
            headers: jsonHeaders,
            body: JSON.stringify({ id: 'market', chat, force: true }),
        });
        if (!saved.ok) throw new Error(`chat save failed ${saved.status} ${await saved.text()}`);
        return { avatars, groupId: group.id };
    });
    expect(created.avatars).toHaveLength(3);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(globalThis.SillyTavern?.getContext), null, { timeout: 90000 });
    await dismissWelcome(page);
    const groupRow = page.locator(`.group_select[data-grid="${created.groupId}"]`);
    await expect(groupRow).toHaveCount(1, { timeout: 30000 });
    await groupRow.evaluate((row) => row.click());
    await expect(page.locator('#chat .mes').nth(2)).toBeVisible({ timeout: 30000 });

    const launcher = page.locator('#stsv-send-btn');
    await expect(launcher).toBeVisible({ timeout: 30000 });
    await launcher.click();
    await expect(page.locator('#stsv-title')).toBeVisible();
    await expect(page.locator('#stsv-cost')).toContainText('AUD');
    await expect(page.locator('#stsv-cap-aud')).toBeVisible();
    await expect(page.locator('#stsv-roster')).toContainText('Ren Moss');
    await expect(page.locator('#stsv-roster')).toContainText('Muted');
    await expect(page.locator('#stsv-roster')).toContainText('Sable Orr');
    await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/st-group-select-1.png', fullPage: false });

    await page.locator('#stsv-all').click();
    await page.locator('#stsv-local').click();
    await page.locator('[data-step-jump="story"]').click();
    const shots = page.locator('#stsv-shots');
    await expect(shots).toContainText('Aki Vale');
    await expect(shots).toContainText('Sable Orr');
    await expect(shots).toContainText('Sera Voss');
    await expect(shots).toContainText('Adjust prompt');
    await expect(shots).toContainText('on the left');
    const sable = await shots.innerText();
    const sableAt = sable.indexOf('Sable Orr');
    const renAfterSable = sable.slice(sableAt).includes('Ren Moss');
    expect(renAfterSable).toBeFalsy();
    await page.locator('#stsv-shots').screenshot({ path: '/opt/cursor/artifacts/screenshots/st-group-story-1.png' });
    const lastShot = page.locator('#stsv-shots .stsv-shot').last();
    await lastShot.scrollIntoViewIfNeeded();
    await page.locator('.stsv-dialog').screenshot({ path: '/opt/cursor/artifacts/screenshots/st-group-story-2.png' });

    await page.locator('[data-bind="consistency"]').evaluate((el) => {
        el.value = 'keyframe';
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('[data-bind="imageModel"]').evaluate((el) => {
        el.value = 'mock';
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('[data-bind="provider"]').evaluate((el) => {
        el.value = 'mock';
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#stsv-generate')).toHaveText('Generate keyframes');
    await page.locator('#stsv-generate').click();
    await expect(page.locator('#stsv-status')).toContainText('Review the keyframes', { timeout: 90000 });
    await expect(page.locator('.stsv-keyframe-still').first()).toBeVisible();
    await page.locator('.stsv-dialog').screenshot({ path: '/opt/cursor/artifacts/screenshots/st-group-keyframes-1.png' });
    const shotCount = await page.locator('.stsv-shot').count();
    for (let index = 0; index < shotCount; index += 1) {
        await page.locator('.stsv-shot').nth(index).locator('[data-act="approve-keyframe"]').click();
    }
    await expect(page.locator('#stsv-shots')).toContainText('Turn into video');
    await expect(page.locator('#stsv-generate')).toHaveText('Make the animatic');
    await page.locator('#stsv-generate').click();
    await expect(page.locator('#stsv-status')).toContainText('Animatic ready', { timeout: 120000 });
    await page.locator('[data-step-jump="story"]').click();
    await page.locator('.stsv-shot').first().locator('[data-field="asVideo"]').check();
    await expect(page.locator('#stsv-generate')).toHaveText('Make the film');
    await page.locator('#stsv-generate').click();
    await expect(page.locator('#stsv-status')).toContainText(/Video ready|Clip ready|Stopped/, { timeout: 120000 });
    await expect(page.locator('#stsv-download')).toBeVisible();
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#stsv-download').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/scene-video-/);
    await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/st-group-review-1.png' });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-step-jump="select"]').evaluate((button) => button.click());
    await expect(page.locator('#stsv-roster')).toContainText('Ren Moss');
    await expect(page.locator('#stsv-cap-range')).toBeVisible();
    const make = page.locator('#stsv-make');
    await expect(make).toBeVisible();
    const makeBox = await make.boundingBox();
    expect((makeBox?.y || 0) + (makeBox?.height || 0)).toBeLessThanOrEqual(860);
    const dialog = page.locator('.stsv-dialog');
    const box = await dialog.boundingBox();
    expect(box?.height || 0).toBeGreaterThan(400);
    await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/st-group-mobile-1.png' });

    const ours = errors.filter((line) => /stsv|scene-video|Scene Video/i.test(line));
    expect(ours, ours.join('\n')).toEqual([]);
});

test('SillyTavern 1.19 one-to-one Make my video exports a file', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(globalThis.SillyTavern?.getContext), null, { timeout: 90000 });
    await dismissWelcome(page);

    const chatFile = `sera-walk-${Date.now()}`;
    const created = await page.evaluate(async (fileName) => {
        const context = globalThis.SillyTavern.getContext();
        const headers = { ...(context.getRequestHeaders?.() || {}) };
        delete headers['Content-Type'];
        delete headers['content-type'];
        const body = new FormData();
        body.set('ch_name', 'Moth Aki');
        body.set('file_name', 'Moth_Aki');
        body.set('description', 'Indigo coat, walks the night market.');
        body.set('personality', 'Nods before speaking.');
        body.set('scenario', 'A quiet stall.');
        body.set('first_mes', 'Aki is here.');
        const response = await fetch('/api/characters/create', { method: 'POST', headers, body });
        if (!response.ok) throw new Error(`create failed ${response.status}`);
        const avatar = (await response.text()).trim();
        const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };
        const chat = [
            { chat_metadata: {} },
            { name: 'Sera Voss', is_user: true, mes: 'The rain is warm. Walk with me.', send_date: 'October 21, 2026' },
            { name: 'Moth Aki', is_user: false, mes: 'Aki nods and keeps the coat closed.', send_date: 'October 21, 2026' },
            { name: 'Sera Voss', is_user: true, mes: 'The lanterns look like the ones from home.', send_date: 'October 21, 2026' },
        ];
        const saved = await fetch('/api/chats/save', {
            method: 'POST',
            headers: jsonHeaders,
            body: JSON.stringify({ avatar_url: avatar, file_name: fileName, chat, force: true }),
        });
        if (!saved.ok) throw new Error(`chat save failed ${saved.status} ${await saved.text()}`);
        return { avatar };
    }, chatFile);
    expect(created.avatar).toContain('Moth');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(globalThis.SillyTavern?.getContext), null, { timeout: 90000 });
    await dismissWelcome(page);
    const card = page.locator('.character_select').filter({ hasText: 'Moth Aki' }).first();
    await expect(card).toHaveCount(1, { timeout: 30000 });
    await card.evaluate((row) => row.click());
    await page.evaluate(async (fileName) => {
        await globalThis.SillyTavern.getContext().openCharacterChat(fileName);
    }, chatFile);
    await expect(page.locator('#chat')).toContainText('Walk with me', { timeout: 30000 });
    await expect(page.locator('#chat')).toContainText('keeps the coat closed');

    await page.locator('#stsv-send-btn').click();
    await expect(page.locator('#stsv-cost')).toContainText('AUD');
    await page.locator('[data-bind="consistency"]').evaluate((el) => {
        el.value = 'keyframe';
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('[data-bind="imageModel"]').evaluate((el) => {
        el.value = 'mock';
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('[data-bind="provider"]').evaluate((el) => {
        el.value = 'mock';
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('[data-bind="secondsPerScene"]').evaluate((el) => {
        el.value = '2';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('#stsv-make').click();
    await expect(page.locator('#stsv-status')).toContainText('Review the keyframes', { timeout: 90000 });
    const shotCount = await page.locator('.stsv-shot').count();
    expect(shotCount).toBeGreaterThan(0);
    for (let index = 0; index < shotCount; index += 1) {
        await page.locator('.stsv-shot').nth(index).locator('[data-act="approve-keyframe"]').click();
    }
    await expect(page.locator('#stsv-generate')).toHaveText('Make the animatic');
    await page.locator('#stsv-generate').click();
    await expect(page.locator('#stsv-status')).toContainText('Animatic ready', { timeout: 120000 });
    await page.locator('[data-step-jump="story"]').click();
    await page.locator('.stsv-shot').first().locator('[data-field="asVideo"]').check();
    await expect(page.locator('#stsv-generate')).toHaveText(/Make the film|Generate video/);
    await page.locator('#stsv-generate').click();
    await expect(page.locator('#stsv-status')).toContainText(/Video ready|Clip ready|Stopped/, { timeout: 120000 });
    await expect(page.locator('#stsv-download')).toBeVisible();
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#stsv-download').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/scene-video-/);
    await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/st-solo-review-1.png' });

    const ours = errors.filter((line) => /stsv|scene-video|Scene Video/i.test(line));
    expect(ours, ours.join('\n')).toEqual([]);
});

test('Images only stops after stills and Picture this moment posts one', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(globalThis.SillyTavern?.getContext), null, { timeout: 90000 });
    await dismissWelcome(page);

    const chatFile = `sera-stills-${Date.now()}`;
    const created = await page.evaluate(async (fileName) => {
        const context = globalThis.SillyTavern.getContext();
        const headers = { ...(context.getRequestHeaders?.() || {}) };
        delete headers['Content-Type'];
        delete headers['content-type'];
        const body = new FormData();
        body.set('ch_name', 'Sera Still');
        body.set('file_name', 'Sera_Still');
        body.set('description', 'Short silver bob, amber eyes, dark green raincoat.');
        body.set('personality', 'Speaks plainly.');
        body.set('scenario', 'A wet street.');
        body.set('first_mes', 'The coat is already on.');
        const response = await fetch('/api/characters/create', { method: 'POST', headers, body });
        if (!response.ok) throw new Error(`create failed ${response.status}`);
        const avatar = (await response.text()).trim();
        const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };
        const chat = [
            { chat_metadata: {} },
            { name: 'Sera Voss', is_user: true, mes: 'The rain is warm. Walk with me.', send_date: 'October 21, 2026' },
            { name: 'Sera Still', is_user: false, mes: 'She keeps the coat closed and looks back.', send_date: 'October 21, 2026' },
        ];
        const saved = await fetch('/api/chats/save', {
            method: 'POST',
            headers: jsonHeaders,
            body: JSON.stringify({ avatar_url: avatar, file_name: fileName, chat, force: true }),
        });
        if (!saved.ok) throw new Error(`chat save failed ${saved.status} ${await saved.text()}`);
        return { avatar };
    }, chatFile);
    expect(created.avatar).toContain('Sera');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(globalThis.SillyTavern?.getContext), null, { timeout: 90000 });
    await dismissWelcome(page);
    const card = page.locator('.character_select').filter({ hasText: 'Sera Still' }).first();
    await expect(card).toHaveCount(1, { timeout: 30000 });
    await card.evaluate((row) => row.click());
    await page.evaluate(async (fileName) => {
        await globalThis.SillyTavern.getContext().openCharacterChat(fileName);
    }, chatFile);
    await expect(page.locator('#chat')).toContainText('Walk with me', { timeout: 30000 });

    await page.locator('#stsv-send-btn').click();
    await page.locator('[data-bind="outputMode"]').selectOption('images');
    await expect(page.locator('#stsv-make')).toHaveText('Make the pictures');
    await page.locator('[data-bind="imageModel"]').evaluate((el) => {
        el.value = 'mock';
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('[data-bind="provider"]').evaluate((el) => {
        el.value = 'mock';
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#stsv-cost-note')).toContainText('Images only');
    await page.locator('#stsv-make').click();
    await expect(page.locator('#stsv-status')).toContainText('Stills are ready', { timeout: 90000 });
    await expect(page.locator('.stsv-keyframe-still').first()).toBeVisible();
    const [stillDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('.stsv-shot').first().locator('[data-act="download-still"]').click(),
    ]);
    expect(stillDownload.suggestedFilename()).toMatch(/scene-1-still/);
    await page.locator('.stsv-dialog').screenshot({ path: '/opt/cursor/artifacts/screenshots/images-only-storyboard-1.png' });

    await page.locator('#stsv-close').click();
    const line = page.locator('#chat .mes', { hasText: 'Walk with me' }).first();
    await line.locator('.stsv-pic-btn').click({ force: true });
    await expect(page.locator('#stsv-status')).toContainText(/Stills are ready|cached/, { timeout: 90000 });
    await expect(page.locator('.stsv-shot')).toHaveCount(1);
    await expect(line.locator('.mes_img')).toBeVisible({ timeout: 20000 });
    await page.locator('#stsv-close').click();
    await line.screenshot({ path: '/opt/cursor/artifacts/screenshots/picture-this-moment-1.png' });

    const ours = errors.filter((entry) => /stsv|scene-video|Scene Video/i.test(entry));
    expect(ours, ours.join('\n')).toEqual([]);
});

async function dismissWelcome(page) {
    const heading = page.getByRole('heading', { name: 'Welcome to SillyTavern!' });
    const shown = await heading.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
    if (!shown) return;
    const name = page.locator('dialog input, .popup input, #dialogue_popup input').last();
    if (await name.count()) await name.fill('Sera Voss');
    await page.getByRole('dialog').getByText('Save', { exact: true }).click();
    await expect(heading).toBeHidden({ timeout: 20000 });
}
