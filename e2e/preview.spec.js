import { test, expect } from '@playwright/test';
import fs from 'node:fs';

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
    await expect(page.locator('#stsv-make')).toHaveText('Make my video');
    await expect(page.locator('#stsv-cost')).toContainText('AUD');
    await expect(page.getByRole('button', { name: 'Showcase' }).first()).toBeVisible();
    await expect(page.locator('#stsv-roster')).toContainText('Ren Moss');
    await expect(page.locator('#stsv-roster')).toContainText('Muted');
    await page.locator('#stsv-all').click();
    await page.locator('#stsv-local').click();
    await page.screenshot({ path: `${shots}/select-1.png` });

    await page.getByRole('button', { name: 'Cast and look' }).click();
    await expect(page.locator('#stsv-board')).toContainText('Sera Voss');
    await expect(page.locator('#stsv-board')).toContainText('Aki Vale');
    await expect(page.locator('#stsv-board')).toContainText('emerald dress');
    await expect(page.locator('#stsv-board')).toContainText('coral sarong');
    await expect(page.locator('#stsv-board')).toContainText('Create related character');
    await page.getByRole('button', { name: 'Create related character' }).first().click();
    await expect(page.getByRole('button', { name: 'Remix' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Regenerate avatar from this description' }).first()).toBeVisible();
    await expect(page.locator('[data-trait="hair"]').first()).toBeVisible();
    await expect(page.locator('#stsv-board')).toContainText('Generate a live-action avatar');
    await expect(page.locator('[data-step="cast"]')).toContainText('Style lock');
    await page.getByRole('button', { name: 'Generate a live-action avatar' }).first().click();
    await expect(page.locator('#stsv-variant-text')).toBeVisible();
    const brief = await page.locator('#stsv-variant-text').inputValue();
    expect(brief.length).toBeGreaterThan(10);
    expect(brief.trim().startsWith('{')).toBeFalsy();
    await page.getByRole('button', { name: 'Generate avatar from text' }).click();
    await expect(page.locator('.stsv-studio img')).toBeVisible();
    await page.locator('.stsv-studio').screenshot({ path: `${shots}/variant-1.png` });
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
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

    await page.locator('[data-step-jump="generate"]').click();
    await expect(page.locator('#stsv-connection-tests')).toContainText('Test ComfyUI');
    await page.locator('[data-test-provider="mock"]').click();
    await expect(page.locator('#stsv-status')).toContainText('Mock provider is local');
    await page.screenshot({ path: `${shots}/generate-1.png` });

    await page.setViewportSize({ width: 390, height: 844 });
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
