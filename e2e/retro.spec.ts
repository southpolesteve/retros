import { expect, test } from '@playwright/test';

test.describe('Retro Creation and Joining', () => {
  test('creator becomes facilitator', async ({ page }) => {
    // Go to home page
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Team Retros');

    // Click Get Started
    await page.click('#startRetro');

    // Fill in retro name and wait for modal
    await expect(page.locator('#createModal')).toBeVisible();
    await page.fill('#retroNameInput', 'Test Retro E2E');
    await page.click('#createBtn');

    // Should redirect to retro page with join modal
    await expect(page).toHaveURL(/\/retro\/[a-z0-9]+$/, { timeout: 10000 });
    await expect(page.locator('#joinModal')).toBeVisible();
    await expect(page.locator('#joinModalTitle')).toHaveText('Test Retro E2E');

    // Fill in name and join
    await page.fill('#nameInput', 'Alice');
    await page.click('#joinBtn');

    // Should see main content with facilitator badge
    await expect(page.locator('#mainContent')).toBeVisible();
    await expect(page.locator('#retroName')).toHaveText('Test Retro E2E');
    await expect(page.locator('.participant')).toContainText(
      'Alice (Facilitator)',
    );

    // Should see facilitator controls
    await expect(page.locator('#facilitatorControls')).toBeVisible();
    await expect(page.locator('#nextPhaseBtn')).toBeVisible();
  });

  test('second user joins as participant, not facilitator', async ({
    browser,
  }) => {
    // First user creates retro
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    await page1.goto('/');
    await page1.click('#startRetro');
    await page1.fill('#retroNameInput', 'Multi User Test');
    await page1.click('#createBtn');

    // Get the retro URL
    await page1.waitForURL(/\/retro\/[a-z0-9]+$/);
    const retroUrl = page1.url();

    // First user joins
    await page1.fill('#nameInput', 'Facilitator');
    await page1.click('#joinBtn');
    await expect(page1.locator('#mainContent')).toBeVisible();
    await expect(page1.locator('.participant')).toContainText(
      'Facilitator (Facilitator)',
    );

    // Second user joins the same retro
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();

    await page2.goto(retroUrl);
    await expect(page2.locator('#joinModalTitle')).toHaveText(
      'Multi User Test',
    );

    await page2.fill('#nameInput', 'Participant');
    await page2.click('#joinBtn');

    await expect(page2.locator('#mainContent')).toBeVisible();

    // Second user should NOT have facilitator controls
    await expect(page2.locator('#facilitatorControls')).toBeHidden();

    // Second user should see both participants
    await expect(page2.locator('.participant')).toHaveCount(2);
    // Check that one has facilitator badge and one doesn't
    await expect(page2.locator('.participant.facilitator')).toHaveCount(1);
    await expect(page2.locator('.participant.facilitator')).toContainText(
      'Facilitator (Facilitator)',
    );
    await expect(page2.locator('.participant:not(.facilitator)')).toContainText(
      'Participant',
    );

    // Clean up
    await context1.close();
    await context2.close();
  });

  test('page refresh reconnects with same identity', async ({ page }) => {
    // Create and join retro
    await page.goto('/');
    await page.click('#startRetro');
    await page.fill('#retroNameInput', 'Refresh Test');
    await page.click('#createBtn');
    await page.waitForURL(/\/retro\/[a-z0-9]+$/);

    await page.fill('#nameInput', 'RefreshUser');
    await page.click('#joinBtn');
    await expect(page.locator('#mainContent')).toBeVisible();
    await expect(page.locator('.participant')).toContainText(
      'RefreshUser (Facilitator)',
    );

    // Refresh the page
    await page.reload();

    // Should auto-reconnect without showing join modal
    await expect(page.locator('#mainContent')).toBeVisible();
    await expect(page.locator('#joinModal')).toBeHidden();
    await expect(page.locator('.participant')).toContainText('RefreshUser');
  });

  test('retro name is editable by facilitator', async ({ page }) => {
    // Create and join retro
    await page.goto('/');
    await page.click('#startRetro');
    await page.fill('#retroNameInput', 'Original Name');
    await page.click('#createBtn');
    await page.waitForURL(/\/retro\/[a-z0-9]+$/);

    await page.fill('#nameInput', 'Editor');
    await page.click('#joinBtn');
    await expect(page.locator('#mainContent')).toBeVisible();

    // Click on retro name to edit
    await page.click('#retroName');

    // Should show input field
    const input = page.locator('#retroName input');
    await expect(input).toBeVisible();

    // Clear and type new name
    await input.fill('Updated Name');
    await input.press('Enter');

    // Should update the name
    await expect(page.locator('#retroName')).toHaveText('Updated Name');
  });
});
