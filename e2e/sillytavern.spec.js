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
            { name: 'Lumen Quill', is_user: true, mes: 'Aki, walk with me.', send_date: 'October 21, 2026' },
            { name: 'Aki Vale', is_user: false, mes: 'Aki nods and keeps the indigo coat.', send_date: 'October 21, 2026' },
            { name: 'Ren Moss', is_user: false, mes: 'Ren keeps the cranes dry.', send_date: 'October 21, 2026' },
            { name: 'Lumen Quill', is_user: true, mes: 'Ren stays quiet. Aki, the bridge is ours.', send_date: 'October 21, 2026' },
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
    await expect(shots).toContainText('Lumen Quill');
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
    await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/st-group-review-1.png' });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-step-jump="select"]').evaluate((button) => button.click());
    await expect(page.locator('#stsv-roster')).toContainText('Ren Moss');
    const dialog = page.locator('.stsv-dialog');
    const box = await dialog.boundingBox();
    expect(box?.height || 0).toBeGreaterThan(400);
    await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/st-group-mobile-1.png' });

    const ours = errors.filter((line) => /stsv|scene-video|Scene Video/i.test(line));
    expect(ours, ours.join('\n')).toEqual([]);
});

async function dismissWelcome(page) {
    const heading = page.getByRole('heading', { name: 'Welcome to SillyTavern!' });
    const shown = await heading.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
    if (!shown) return;
    const name = page.locator('dialog input, .popup input, #dialogue_popup input').last();
    if (await name.count()) await name.fill('Lumen Quill');
    await page.getByRole('dialog').getByText('Save', { exact: true }).click();
    await expect(heading).toBeHidden({ timeout: 20000 });
}
