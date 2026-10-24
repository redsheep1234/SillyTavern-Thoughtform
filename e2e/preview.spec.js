import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { openZip } from '../tests/helpers/zip-open.mjs';

const shots = 'test-results/screenshots';

test.beforeAll(() => {
    fs.mkdirSync(shots, { recursive: true });
});

test('group preview walks the panel without console errors', async ({ page }) => {
    const errors = [];
    page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (/favicon|Failed to load resource/i.test(text)) return;
        errors.push(text);
    });
    page.on('response', (response) => {
        if (response.status() < 400) return;
        if (/favicon\.ico/.test(response.url())) return;
        errors.push(`${response.status()} ${response.url()}`);
    });
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto('http://127.0.0.1:43123/dev/preview.html');
    await expect(page.locator('#stsv-title')).toBeVisible();
    await expect(page.locator('#stsv-pictures-line')).toContainText(/Mock/);
    await page.locator('[data-step-jump="models"]').click();
    await expect(page.locator('#stsv-image-model')).toBeVisible();
    await expect(page.locator('#stsv-image-model')).toHaveValue('mock');
    await expect(page.locator('#stsv-warn-pictures')).toContainText('text card');
    await page.locator('#stsv-picture-provider').selectOption('openrouter');
    await expect(page.locator('#stsv-image-model')).toHaveValue('google/gemini-2.5-flash-image');
    const pictureWarn = page.locator('#stsv-warn-pictures');
    await expect(pictureWarn).toContainText('needs an OpenRouter key');
    await expect(pictureWarn.getByRole('button', { name: 'Add the key' })).toHaveCount(1);
    const pictureCopy = await page.locator('tr[data-task="pictures"], tr[data-task-warn="pictures"]').allInnerTexts();
    expect(pictureCopy.join('\n').match(/needs an OpenRouter key/g)).toHaveLength(1);
    await pictureWarn.getByRole('button', { name: 'Add the key' }).click();
    await expect(page.locator('#stsv-settings [data-setting="openrouterKey"]')).toBeFocused();
    await page.locator('#stsv-settings [data-test-key="openrouter"]').evaluate((node) => node.click());
    await expect(page.locator('#stsv-settings [data-test-result="openrouter"]')).toContainText('No OpenRouter key yet');
    await page.locator('#stsv-send-btn').click();
    await expect(page.locator('#stsv-title')).toBeVisible();
    await page.locator('#stsv-picture-provider').selectOption('mock');
    await expect(page.locator('#stsv-image-model')).toHaveValue('mock');
    await page.locator('#stsv-choose-model').evaluate((node) => { node.hidden = false; });
    await page.locator('#stsv-choose-model').click();
    await expect(page.locator('[data-step="models"]')).toBeVisible();
    await expect(page.locator('#stsv-image-model')).toBeVisible();
    await expect(page.locator('#stsv-image-model-label')).toHaveClass(/stsv-highlight/);
    await page.locator('[data-step-jump="select"]').click();
    await expect(page.locator('#stsv-cap-label')).toHaveText('Max spend');
    await expect(page.locator('#stsv-visit-label')).toHaveText('This visit');
    await expect(page.locator('#stsv-visit-meter')).toBeVisible();
    await expect(page.locator('#stsv-make')).toHaveText('Make my video');
    const cancel = page.locator('#stsv-cancel');
    await expect(cancel).toBeVisible();
    await expect(cancel).toBeDisabled();
    await expect(page.locator('#stsv-cost')).toContainText(/A\$|AUD/);
    const dialog = await page.locator('.stsv-dialog').boundingBox();
    const body = await page.locator('.stsv-body').boundingBox();
    const footer = await page.locator('.stsv-footer').boundingBox();
    expect(footer.height).toBeLessThan(80);
    expect(body.height).toBeGreaterThan(dialog.height * 0.6);
    await page.locator('.stsv-dialog').evaluate((node) => { node.style.width = '480px'; });
    await page.locator('#stsv-status').evaluate((node) => {
        node.textContent = 'Your clip is in Review — attach it to the chat';
        node.title = node.textContent;
    });
    const narrow = page.locator('.stsv-footer');
    const fits = await narrow.evaluate((node) => ({
        overflow: node.scrollWidth - node.clientWidth,
        actions: node.querySelector('.stsv-footer-actions').scrollWidth - node.querySelector('.stsv-footer-actions').clientWidth,
    }));
    expect(fits.overflow).toBeLessThanOrEqual(1);
    expect(fits.actions).toBeLessThanOrEqual(1);
    const statusBox = await page.locator('#stsv-status').boundingBox();
    expect(statusBox.width).toBeGreaterThan(200);
    const statusText = await page.locator('#stsv-status').evaluate((node) => ({
        full: node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1,
        text: node.textContent,
    }));
    expect(statusText.text).toBe('Your clip is in Review — attach it to the chat');
    expect(statusText.full).toBe(true);
    await expect(page.locator('.stsv-footer #stsv-status')).toHaveCount(0);
    await expect(page.locator('.stsv-cost-details summary')).toHaveText('Price');
    const makeNarrow = await page.locator('#stsv-make').boundingBox();
    const cancelNarrow = await page.locator('#stsv-cancel').boundingBox();
    const footerNarrow = await narrow.boundingBox();
    expect(makeNarrow.x).toBeGreaterThanOrEqual(footerNarrow.x);
    expect(makeNarrow.x + makeNarrow.width).toBeLessThanOrEqual(footerNarrow.x + footerNarrow.width + 1);
    expect(cancelNarrow.x + cancelNarrow.width).toBeLessThanOrEqual(footerNarrow.x + footerNarrow.width + 1);
    await page.locator('.stsv-dialog').evaluate((node) => { node.style.width = ''; });
    await expect(page.getByRole('button', { name: 'Showcase' }).first()).toBeVisible();
    await expect(page.locator('#stsv-roster')).toContainText('Ren Moss');
    await expect(page.locator('#stsv-roster')).toContainText('Muted');
    await expect(page.locator('#stsv-roster').getByRole('button', { name: 'Board' }).first()).toBeVisible();
    await page.locator('#stsv-all').click();
    await page.locator('#stsv-local').click();
    await page.screenshot({ path: `${shots}/select-1.png` });

    await page.getByRole('button', { name: 'Cast and look' }).click();
    await expect(page.locator('#stsv-board')).toContainText('Aki Vale');
    await expect(page.locator('.stsv-guide [data-field="mustKeep"]')).toHaveValue(/teal braid/i);
    await expect(page.locator('.stsv-guide [data-field="mayChange"]')).toHaveValue('outfit, pose');
    const bodyLine = page.locator('.stsv-guide [data-field="bodyLine"]');
    await expect(bodyLine).toBeVisible();
    await expect(bodyLine).toHaveAttribute('placeholder', 'athletic, narrow waist, long legs');
    await expect(page.locator('.stsv-guide')).toContainText("The character's figure, not their clothes");
    await expect(page.locator('.stsv-guide').getByLabel('Body reference')).toBeVisible();
    await bodyLine.fill('athletic, narrow waist, long legs');
    await expect(bodyLine).toHaveValue('athletic, narrow waist, long legs');
    await expect(page.locator('.stsv-guide').getByRole('button', { name: 'Describe from picture' })).toBeVisible();
    await expect(page.locator('[data-target="stsv-jump-board"]')).toHaveText('All pictures');
    await expect(page.locator('[data-target="stsv-jump-suite"]')).toHaveText('Build suite');
    await expect(page.locator('.stsv-guide')).toContainText('Add photos of a body type, an outfit, or a pose. Thoughtform uses each one only for what you tag it as.');
    await expect(page.locator('.stsv-guide')).toContainText('of 28');
    await expect(page.locator('#stsv-expression-list')).toHaveValue(/joy/);
    await expect(page.locator('[data-preset="quick"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-preset="full"]').click();
    const extra = await page.locator('[data-extra="excitement"]').boundingBox();
    expect(extra.width).toBeGreaterThan(8);
    expect(extra.width).toBeLessThan(28);
    expect(extra.height).toBeGreaterThan(8);
    expect(extra.height).toBeLessThan(28);
    await expect(page.locator('#stsv-suite-quote')).toContainText('28 expressions, about');
    await expect(page.locator('#stsv-suite-quote')).toContainText('copies are free');
    await expect(page.locator('[data-extra="determined"]')).not.toBeChecked();
    await page.locator('[data-preset="quick"]').click();
    await expect(page.locator('[data-preset="quick"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-preset="quick"]')).toHaveClass(/stsv-on/);
    const stepsBefore = await page.locator('.stsv-steps').boundingBox();
    const title = await page.locator('#stsv-title').boundingBox();
    const header = await page.locator('.stsv-header').boundingBox();
    expect(title.y).toBeGreaterThanOrEqual(header.y - 1);
    expect(title.y + title.height).toBeLessThanOrEqual(header.y + header.height + 1);
    await page.locator('.stsv-body').evaluate((node) => { node.scrollTop = 500; });
    const stepsAfter = await page.locator('.stsv-steps').boundingBox();
    expect(Math.abs(stepsBefore.y - stepsAfter.y)).toBeLessThan(2);
    const look = await page.locator('#stsv-jump-look').boundingBox();
    const board = await page.locator('#stsv-jump-board').boundingBox();
    expect(look.y).toBeLessThan(board.y);
    await page.locator('.stsv-more-boards > summary').click();
    const thumbMargin = await page.locator('.stsv-more-boards .stsv-thumb').first().evaluate((node) => {
        const style = getComputedStyle(node);
        return parseFloat(style.marginTop) + parseFloat(style.marginLeft);
    });
    expect(thumbMargin).toBe(0);
    await expect(page.locator('#stsv-board')).toContainText('Sera Voss');
    await expect(page.locator('.stsv-approved-badge').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Main picture' }).first()).toBeVisible();
    const more = page.locator('.stsv-more-boards').getByRole('button', { name: 'More', exact: true }).first();
    const menuPop = more.locator('xpath=..').locator('.stsv-card-menu-pop');
    await more.click();
    await expect(menuPop).toBeVisible();
    await more.click();
    await expect(menuPop).toBeHidden();
    await page.locator('.stsv-more-boards').getByRole('button', { name: 'Redo', exact: true }).first().click();
    const confirmPop = page.locator('.stsv-confirm-pop');
    await expect(confirmPop).toBeVisible();
    await expect(confirmPop).toContainText(/Used:/);
    await expect(confirmPop.locator('.stsv-confirm-refs img').first()).toBeVisible();
    await confirmPop.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('.stsv-redo')).toBeVisible();
    const freshStill = page.locator('.stsv-redo [data-still="new"]').first();
    const currentStill = page.locator('.stsv-redo img[alt="Current still"]').first();
    await expect(freshStill).toBeVisible();
    const freshSrc = await freshStill.getAttribute('src');
    const currentSrc = await currentStill.getAttribute('src');
    expect(freshSrc).not.toBe(currentSrc);
    expect(freshSrc.length).toBeGreaterThan(30);
    const freshBox = await freshStill.boundingBox();
    expect(freshBox.height).toBeLessThanOrEqual(97);
    const preview = await page.locator('.stsv-more-boards .stsv-active img').first().boundingBox();
    expect(preview.width).toBeLessThan(200);
    expect(preview.height).toBeLessThan(280);
    const beforeScroll = await page.locator('.stsv-body').evaluate((node) => node.scrollTop);
    await expect(page.getByRole('button', { name: 'Use new' })).toBeVisible();
    await expect(page.locator('.stsv-charge')).toContainText('Charged');
    await page.getByRole('button', { name: 'Use new' }).click();
    await expect(page.locator('.stsv-redo')).toHaveCount(0);
    const afterScroll = await page.locator('.stsv-body').evaluate((node) => node.scrollTop);
    expect(Math.abs(afterScroll - beforeScroll)).toBeLessThan(80);
    await expect(page.locator('#stsv-status')).toContainText('Approved. This view uses the new still.');
    await expect(page.locator('#stsv-board')).toContainText('emerald dress');
    await expect(page.locator('#stsv-board')).toContainText('coral sarong');
    await expect(page.locator('#stsv-board')).toContainText('Create related character');
    await page.getByRole('button', { name: 'Create related character' }).first().click();
    await expect(page.getByRole('button', { name: 'Remix' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Regenerate avatar from this description' }).first()).toBeVisible();
    await expect(page.locator('[data-trait="hair"]').first()).toBeVisible();
    await expect(page.locator('#stsv-board')).toContainText('Generate a live-action avatar');
    await expect(page.locator('[data-step="cast"]')).toContainText('Style lock');
    await page.locator('[data-step-jump="select"]').click();
    await page.locator('#stsv-roster [data-act="open-board"][data-name="Aki Vale"]').click();
    await expect(page.locator('#stsv-look-settings')).not.toHaveAttribute('open');
    await expect(page.locator('#stsv-char-look')).not.toHaveAttribute('open');
    await expect(page.locator('#stsv-char-look textarea')).toBeHidden();
    await expect.poll(async () => {
        const head = await page.locator('#stsv-jump-look').boundingBox();
        const scroller = await page.locator('.stsv-body').boundingBox();
        return Math.abs(head.y - scroller.y);
    }).toBeLessThan(30);
    await expect(page.locator('#stsv-image-model')).toBeHidden();
    await page.getByRole('button', { name: 'Generate a live-action avatar' }).first().click();
    await expect(page.locator('#stsv-variant-text')).toBeVisible();
    const brief = await page.locator('#stsv-variant-text').inputValue();
    expect(brief.length).toBeGreaterThan(10);
    expect(brief.trim().startsWith('{')).toBeFalsy();
    await page.getByRole('button', { name: 'Generate avatar from text' }).click();
    await expect(page.locator('.stsv-studio img')).toBeVisible();
    await page.locator('.stsv-studio').screenshot({ path: `${shots}/variant-1.png` });
    await page.locator('.stsv-studio').getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.locator('#stsv-board')).toContainText('Live-action avatar');
    await page.locator('#stsv-board').scrollIntoViewIfNeeded();
    await page.locator('#stsv-board').screenshot({ path: `${shots}/cast-1.png` });

    await page.getByRole('button', { name: 'Storyboard' }).click();
    await expect(page.locator('#stsv-shots')).toContainText('Sable Orr');
    await expect(page.locator('#stsv-shots')).toContainText('Aki Vale');
    await expect(page.locator('#stsv-shots')).toContainText('Adjust prompt');
    await expect(page.locator('#stsv-shots')).toContainText('Redo');
    await expect(page.locator('#stsv-shots')).toContainText('on the left');
    await expect(page.locator('#stsv-shots')).toContainText('Turn into video');
    await page.locator('#stsv-shots').screenshot({ path: `${shots}/storyboard-1.png` });

    await page.getByRole('button', { name: 'Review', exact: true }).click();
    await expect(page.locator('#stsv-review-empty')).toContainText('No clip yet');
    await page.locator('[data-step-jump="generate"]').click();
    await expect(page.locator('#stsv-connection-tests')).toContainText('Test ComfyUI');
    await page.locator('[data-test-provider="mock"]').click();
    await expect(page.locator('#stsv-status')).toContainText('Mock provider is local');
    await page.screenshot({ path: `${shots}/generate-1.png` });

    await page.setViewportSize({ width: 390, height: 844 });
    const narrowDialog = await page.locator('.stsv-dialog').boundingBox();
    const narrowBody = await page.locator('.stsv-body').boundingBox();
    const narrowFooter = await page.locator('.stsv-footer').boundingBox();
    expect(narrowFooter.height).toBeLessThan(80);
    expect(narrowBody.height).toBeGreaterThan(narrowDialog.height * 0.6);
    await page.locator('[data-step-jump="select"]').click();
    await expect(page.locator('#stsv-cap-range')).toBeVisible();
    const make = page.locator('#stsv-make');
    await expect(make).toBeVisible();
    const makeBox = await make.boundingBox();
    expect(makeBox.y).toBeGreaterThanOrEqual(0);
    expect(makeBox.y + makeBox.height).toBeLessThanOrEqual(860);
    await page.screenshot({ path: `${shots}/select-mobile-1.png` });
    await page.locator('[data-step-jump="cast"]').click();
    await page.screenshot({ path: `${shots}/cast-mobile-1.png` });

    const unexpected = errors.filter((line) => !/favicon|Download the React DevTools/i.test(line));
    expect(unexpected, unexpected.join('\n')).toEqual([]);
});

test('expression and turnaround cards share the picture actions', async ({ page }) => {
    await page.goto('http://127.0.0.1:43123/dev/preview.html');
    await page.locator('[data-step-jump="models"]').click();
    await expect(page.locator('.stsv-models')).toContainText('Pictures');
    await expect(page.locator('.stsv-models')).toContainText('Video');
    await expect(page.locator('.stsv-models')).toContainText('Shot list');
    await expect(page.locator('.stsv-models')).toContainText('Describe a picture');
    await expect(page.locator('.stsv-models')).toContainText('Dialogue voice');
    await expect(page.locator('.stsv-models')).toContainText('Lip-sync');
    await expect(page.locator('.stsv-models')).toContainText('Music');
    await expect(page.locator('.stsv-models')).toContainText('ComfyUI workflow');
    await page.locator('#stsv-same-provider').selectOption('openrouter');
    await page.locator('#stsv-same-apply').click();
    await expect(page.locator('#stsv-image-model')).toHaveValue('google/gemini-2.5-flash-image');
    await expect(page.locator('#stsv-video-provider')).toHaveValue('openrouter');
    await expect(page.locator('#stsv-same-note')).toContainText('Voice stays');
    await expect(page.locator('#stsv-picture-key')).toContainText('Needs key');
    await page.locator('.stsv-models').screenshot({ path: `${shots}/models-1.png` });
    await page.locator('#stsv-picture-provider').selectOption('mock');
    await page.getByRole('button', { name: 'Cast and look' }).click();
    await expect(page.locator('.stsv-guide').getByRole('button', { name: 'Describe from picture' })).toBeVisible();
    await page.locator('#stsv-focus-board').selectOption({ label: 'Sera Voss' });
    await expect(page.locator('#stsv-suite-outfit')).toContainText('dark green raincoat');
    await expect(page.locator('#stsv-suite-outfit').getByRole('button', { name: 'change' })).toBeVisible();
    await expect(page.locator('[data-act="vary-outfit"]')).not.toBeChecked();
    const expressions = page.locator('#stsv-jump-expressions');
    await expect(expressions.getByRole('button', { name: 'Redo — wrong outfit' }).first()).toBeVisible();
    await expect(expressions.getByRole('button', { name: 'Delete picture' }).first()).toBeVisible();
    await expect(expressions.getByRole('button', { name: 'Clear all pictures' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start this character over' })).toBeVisible();
    await expect(expressions.getByRole('button', { name: 'Redo', exact: true }).first()).toBeVisible();
    await expect(expressions.getByRole('button', { name: 'More', exact: true }).first()).toBeVisible();
    await expect(expressions.getByRole('button', { name: 'Main picture' }).first()).toBeVisible();
    const turn = page.locator('#stsv-jump-turn');
    await expect(turn.getByRole('button', { name: 'Redo', exact: true }).first()).toBeVisible();
    await expect(turn.getByRole('button', { name: 'More', exact: true }).first()).toBeVisible();
    await expect(turn.getByRole('button', { name: 'Main picture' }).first()).toBeVisible();
    const gap = await expressions.locator('.stsv-thumb').evaluateAll((nodes) => {
        const first = nodes[0].getBoundingClientRect();
        const style = getComputedStyle(nodes[0]);
        const second = nodes[1].getBoundingClientRect();
        const grid = nodes[0].parentElement.getBoundingClientRect();
        return {
            marginTop: parseFloat(style.marginTop),
            marginLeft: parseFloat(style.marginLeft),
            top: Math.round(first.top - grid.top),
            left: Math.round(first.left - grid.left),
            between: Math.round(second.left - first.right),
            sameRow: Math.abs(first.top - second.top) < 2,
        };
    });
    expect(gap.marginTop).toBe(0);
    expect(gap.marginLeft).toBe(0);
    expect(gap.top).toBeLessThan(4);
    expect(gap.left).toBeLessThan(4);
    expect(gap.sameRow).toBe(true);
    expect(gap.between).toBeGreaterThan(8);
    expect(gap.between).toBeLessThan(20);
    await page.locator('[data-step-jump="select"]').click();
    await page.locator('#stsv-roster [data-act="open-board"][data-name="Sera Voss"]').click();
    await expect(page.locator('#stsv-char-look')).not.toHaveAttribute('open');
    await expect(page.locator('#stsv-look-settings')).not.toHaveAttribute('open');
});

test('a mock suite is restored after refresh and delete removes the file', async ({ page }) => {
    await page.goto('http://127.0.0.1:43123/dev/preview.html');
    await page.getByRole('button', { name: 'Cast and look' }).click();
    await page.locator('#stsv-focus-board').selectOption({ label: 'Sera Voss' });
    await page.locator('#stsv-jump-suite').scrollIntoViewIfNeeded();
    await page.locator('#stsv-suite-outfit').screenshot({ path: `${shots}/outfit-1.png` });
    await page.locator('#stsv-jump-suite').getByRole('button', { name: 'Build suite' }).click();
    const confirm = page.locator('.stsv-confirm-pop');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Continue' }).click();
    await expect.poll(async () => page.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem('thoughtform-preview-settings') || '{}');
        const sera = Object.values(saved.settings?.library?.records || {}).find((item) => item.name === 'Sera Voss');
        return (sera?.images || []).filter((image) => String(image.file || '').startsWith('user/files/')).length;
    }), { timeout: 60000 }).toBeGreaterThan(3);
    const before = await page.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem('thoughtform-preview-settings') || '{}');
        const sera = Object.values(saved.settings?.library?.records || {}).find((item) => item.name === 'Sera Voss');
        return (sera?.images || []).filter((image) => String(image.file || '').startsWith('user/files/')).length;
    });
    await page.reload();
    await page.getByRole('button', { name: 'Cast and look' }).click();
    await expect(page.locator('#stsv-restored')).toContainText(/Restored \d+ pictures from your last session/);
    const after = await page.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem('thoughtform-preview-settings') || '{}');
        const sera = Object.values(saved.settings?.library?.records || {}).find((item) => item.name === 'Sera Voss');
        return (sera?.images || []).filter((image) => String(image.file || '').startsWith('user/files/')).length;
    });
    expect(after).toBe(before);
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#stsv-jump-expressions').getByRole('button', { name: 'Delete picture' }).last().click();
    await expect.poll(async () => page.evaluate((previous) => {
        const saved = JSON.parse(localStorage.getItem('thoughtform-preview-settings') || '{}');
        const files = JSON.parse(localStorage.getItem('thoughtform-preview-files') || '{}');
        const sera = Object.values(saved.settings?.library?.records || {}).find((item) => item.name === 'Sera Voss');
        const paths = (sera?.images || []).map((image) => image.file).filter((file) => String(file || '').startsWith('user/files/'));
        return paths.length < previous && paths.every((file) => files[file]);
    }, after)).toBe(true);
});

test('a picture opens large enough to check before it is saved', async ({ page }) => {
    await page.goto('http://127.0.0.1:43123/dev/preview.html');
    await page.getByRole('button', { name: 'Cast and look' }).click();
    await page.locator('#stsv-focus-board').selectOption({ label: 'Sera Voss' });
    const expressions = page.locator('#stsv-jump-expressions');
    await expressions.getByRole('button', { name: 'View anger large' }).click();
    const preview = page.locator('#stsv-preview');
    await expect(preview).toBeVisible();
    await expect(preview.locator('.stsv-preview-label')).toContainText('anger');
    await expect(preview.locator('img')).toHaveAttribute('src', /sera-angry\.jpg/);
    await expect(preview.getByRole('button', { name: 'Redo', exact: true })).toBeVisible();
    await expect(preview.getByRole('button', { name: 'Redo — wrong outfit' })).toBeVisible();
    await expect(preview.getByRole('button', { name: 'Bin' })).toBeVisible();
    await expect(preview.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
    const locked = await page.locator('.stsv-body').evaluate((node) => getComputedStyle(node).overflowY);
    expect(locked).toBe('hidden');
    await preview.locator('.stsv-preview-stage').click();
    await expect(preview.locator('.stsv-preview-stage')).toHaveClass(/is-zoomed/);
    await preview.getByRole('button', { name: 'Next picture' }).click();
    await expect(preview.locator('.stsv-preview-label')).toContainText('surprise');
    await expect(preview.locator('.stsv-preview-stage')).not.toHaveClass(/is-zoomed/);
    await page.keyboard.press('ArrowLeft');
    await expect(preview.locator('.stsv-preview-label')).toContainText('anger');
    const box = await page.locator('.stsv-dialog').boundingBox();
    await page.mouse.click(box.x + 3, box.y + 3);
    await expect(preview).toBeHidden();
    const scrollable = await page.locator('.stsv-body').evaluate((node) => getComputedStyle(node).overflowY);
    expect(scrollable).toBe('auto');
    await expressions.getByRole('button', { name: 'View anger large' }).click();
    await page.keyboard.press('Escape');
    await expect(preview).toBeHidden();
    await expect(page.locator('#stsv-title')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#stsv-jump-turn').getByRole('button', { name: 'View side large' }).click();
    await expect(preview).toBeVisible();
    await expect(preview.locator('.stsv-preview-label')).toContainText('side');
    await expect(preview.getByRole('button', { name: 'Bin' })).toBeVisible();
    const sheet = await preview.locator('.stsv-preview-sheet').boundingBox();
    const dialog = await page.locator('.stsv-dialog').boundingBox();
    expect(sheet.x).toBeGreaterThanOrEqual(dialog.x - 1);
    expect(sheet.y).toBeGreaterThanOrEqual(dialog.y - 1);
    expect(sheet.x + sheet.width).toBeLessThanOrEqual(dialog.x + dialog.width + 1);
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(dialog.y + dialog.height + 1);
    await preview.screenshot({ path: `${shots}/preview-1.png` });
});

test('approved expression stills download and upload, and the suite is not drawn twice', async ({ page }) => {
    await page.goto('http://127.0.0.1:43123/dev/preview.html');
    await page.getByRole('button', { name: 'Cast and look' }).click();
    const guide = page.locator('.stsv-guide');
    await guide.getByRole('button', { name: 'Download expression zip' }).click();
    await expect(page.locator('#stsv-banner')).toContainText('Approve an expression still');

    await page.evaluate(() => {
        const library = window.SillyTavern.getContext().extensionSettings.scene_video.library;
        const aki = Object.values(library.records).find((item) => item.name === 'Aki Vale');
        aki.images.push({
            id: 'export-joy',
            dataUrl: '',
            url: '/docs/examples/sera-smile.jpg',
            file: 'docs/examples/sera-smile.jpg',
            tags: ['expression', 'face'],
            label: 'joy',
            stLabel: 'joy',
            source: 'generated',
            review: 'approved',
            approved: true,
        });
    });
    await page.locator('#stsv-focus-board').selectOption({ label: 'Sera Voss' });
    await page.locator('#stsv-focus-board').selectOption({ label: 'Aki Vale' });
    await expect(guide.locator('#stsv-jump-expressions')).toContainText('joy');
    await expect(guide.locator('#stsv-jump-board img[src*="sera-smile"]')).toHaveCount(0);

    const saveZip = async () => {
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            guide.getByRole('button', { name: 'Download expression zip' }).click(),
        ]);
        expect(download.suggestedFilename()).toBe('Aki Vale-expressions.zip');
        const file = await download.path();
        const opened = openZip(fs.readFileSync(file));
        const joy = opened.find((entry) => entry.name === 'Aki Vale/joy.jpg' || entry.name === 'Aki Vale/joy.png');
        expect(joy).toBeTruthy();
        expect(joy.size).toBeGreaterThan(8);
        expect(joy.data[0] === 0xff || joy.data[0] === 0x89).toBe(true);
        return download;
    };
    await saveZip();
    await saveZip();
    await expect(page.locator('#stsv-status')).toContainText('Downloaded Aki Vale-expressions.zip');
    await expect(page.locator('#stsv-banner')).toBeHidden();

    page.on('dialog', (dialog) => dialog.accept());
    await guide.getByRole('button', { name: 'Export to SillyTavern expressions' }).click();
    await expect(page.locator('#stsv-status')).toContainText(/Saved/);
    await expect(page.locator('#stsv-status')).toContainText('joy');
    await expect(page.locator('#stsv-banner')).toBeHidden();

    await page.locator('#stsv-focus-board').selectOption({ label: 'Sera Voss' });
    const sera = page.locator('.stsv-guide');
    await expect(sera.locator('#stsv-jump-expressions img[src*="sera-angry"]')).toHaveCount(1);
    await expect(sera.locator('#stsv-jump-board img[src*="sera-angry"]')).toHaveCount(0);
    await expect(sera.locator('#stsv-jump-board img[src*="sera-turn-side"]')).toHaveCount(0);
    await expect(sera.locator('#stsv-jump-board img[src*="sera-coral"]')).toHaveCount(1);
    await expect(sera.locator('#stsv-jump-export img')).toHaveCount(0);
});
