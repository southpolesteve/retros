import { expect, test } from '@playwright/test';

test.describe('Real-time Collaboration', () => {
  test('participants see each other join in real-time', async ({ browser }) => {
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    // First user creates and joins
    await page1.goto('/');
    await page1.click('#startRetro');
    await page1.fill('#retroNameInput', 'Realtime Test');
    await page1.click('#createBtn');
    await page1.waitForURL(/\/retro\/[a-z0-9]+$/);
    const retroUrl = page1.url();

    await page1.fill('#nameInput', 'Alice');
    await page1.click('#joinBtn');
    await expect(page1.locator('#mainContent')).toBeVisible();
    await expect(page1.locator('.participant')).toHaveCount(1);

    // Second user joins
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto(retroUrl);
    await page2.fill('#nameInput', 'Bob');
    await page2.click('#joinBtn');
    await expect(page2.locator('#mainContent')).toBeVisible();

    // Both should see 2 participants
    await expect(page1.locator('.participant')).toHaveCount(2);
    await expect(page2.locator('.participant')).toHaveCount(2);

    // First user should see Bob joined
    await expect(page1.locator('.participant')).toContainText(['Alice', 'Bob']);

    await context1.close();
    await context2.close();
  });

  test('items added are visible to all participants in real-time', async ({
    browser,
  }) => {
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    // Facilitator creates retro
    await page1.goto('/');
    await page1.click('#startRetro');
    await page1.fill('#retroNameInput', 'Item Sync Test');
    await page1.click('#createBtn');
    await page1.waitForURL(/\/retro\/[a-z0-9]+$/);
    const retroUrl = page1.url();

    await page1.fill('#nameInput', 'Facilitator');
    await page1.click('#joinBtn');
    await expect(page1.locator('#mainContent')).toBeVisible();

    // Participant joins
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto(retroUrl);
    await page2.fill('#nameInput', 'Participant');
    await page2.click('#joinBtn');
    await expect(page2.locator('#mainContent')).toBeVisible();

    // Facilitator advances to Adding phase
    await page1.click('#nextPhaseBtn');
    await expect(page1.locator('#phaseLabel')).toHaveText('Adding');
    await expect(page2.locator('#phaseLabel')).toHaveText('Adding');

    // Participant adds an item
    await page2.fill('#startInput', 'Item from participant');
    await page2.click('button[onclick="addItem(\'start\')"]');

    // Both should see item count (items hidden during Adding)
    await expect(page1.locator('#startItems')).toContainText('1 item added');
    await expect(page2.locator('#startItems')).toContainText('1 item added');

    // Facilitator adds an item to Stop column
    await page1.fill('#stopInput', 'Item from facilitator');
    await page1.click('button[onclick="addItem(\'stop\')"]');

    // Both should see counts in both columns
    await expect(page1.locator('#stopItems')).toContainText('1 item added');
    await expect(page2.locator('#stopItems')).toContainText('1 item added');

    // Advance to Voting to reveal items
    await page1.click('#nextPhaseBtn');
    await expect(page1.locator('#phaseLabel')).toHaveText('Voting');

    // Both should see all items revealed
    await expect(page1.locator('#startItems .item')).toContainText(
      'Item from participant',
    );
    await expect(page2.locator('#startItems .item')).toContainText(
      'Item from participant',
    );
    await expect(page1.locator('#stopItems .item')).toContainText(
      'Item from facilitator',
    );
    await expect(page2.locator('#stopItems .item')).toContainText(
      'Item from facilitator',
    );

    await context1.close();
    await context2.close();
  });

  test('retro name updates are visible to all participants', async ({
    browser,
  }) => {
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    // Facilitator creates retro
    await page1.goto('/');
    await page1.click('#startRetro');
    await page1.fill('#retroNameInput', 'Original Name');
    await page1.click('#createBtn');
    await page1.waitForURL(/\/retro\/[a-z0-9]+$/);
    const retroUrl = page1.url();

    await page1.fill('#nameInput', 'Facilitator');
    await page1.click('#joinBtn');
    await expect(page1.locator('#mainContent')).toBeVisible();

    // Participant joins
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto(retroUrl);
    await page2.fill('#nameInput', 'Participant');
    await page2.click('#joinBtn');
    await expect(page2.locator('#mainContent')).toBeVisible();
    await expect(page2.locator('#retroName')).toHaveText('Original Name');

    // Facilitator renames retro
    await page1.click('#retroName');
    await page1.locator('#retroName input').fill('New Retro Name');
    await page1.locator('#retroName input').press('Enter');

    // Both should see the new name
    await expect(page1.locator('#retroName')).toHaveText('New Retro Name');
    await expect(page2.locator('#retroName')).toHaveText('New Retro Name');

    await context1.close();
    await context2.close();
  });

  test('votes update in real-time during Discussion phase', async ({
    browser,
  }) => {
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    // Facilitator creates retro
    await page1.goto('/');
    await page1.click('#startRetro');
    await page1.fill('#retroNameInput', 'Vote Sync Test');
    await page1.click('#createBtn');
    await page1.waitForURL(/\/retro\/[a-z0-9]+$/);
    const retroUrl = page1.url();

    await page1.fill('#nameInput', 'Facilitator');
    await page1.click('#joinBtn');
    await expect(page1.locator('#mainContent')).toBeVisible();

    // Participant joins
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto(retroUrl);
    await page2.fill('#nameInput', 'Participant');
    await page2.click('#joinBtn');
    await expect(page2.locator('#mainContent')).toBeVisible();

    // Advance to Adding and add an item
    await page1.click('#nextPhaseBtn');
    await page1.fill('#startInput', 'Vote on this');
    await page1.click('button[onclick="addItem(\'start\')"]');

    // Advance to Voting
    await page1.click('#nextPhaseBtn');
    await expect(page1.locator('#phaseLabel')).toHaveText('Voting');

    // Both users vote on the item
    await page1.click('.btn-vote');
    await page2.click('.btn-vote');

    // Advance to Discussion to see vote counts
    await page1.click('#nextPhaseBtn');
    await expect(page1.locator('#phaseLabel')).toHaveText('Discussion');

    // Both should see 2 votes
    await expect(page1.locator('.item-votes')).toContainText('2 votes');
    await expect(page2.locator('.item-votes')).toContainText('2 votes');

    await context1.close();
    await context2.close();
  });

  test('delete retro kicks all participants', async ({ browser }) => {
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    // Facilitator creates retro
    await page1.goto('/');
    await page1.click('#startRetro');
    await page1.fill('#retroNameInput', 'Delete Test');
    await page1.click('#createBtn');
    await page1.waitForURL(/\/retro\/[a-z0-9]+$/);
    const retroUrl = page1.url();

    await page1.fill('#nameInput', 'Facilitator');
    await page1.click('#joinBtn');
    await expect(page1.locator('#mainContent')).toBeVisible();

    // Participant joins
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto(retroUrl);
    await page2.fill('#nameInput', 'Participant');
    await page2.click('#joinBtn');
    await expect(page2.locator('#mainContent')).toBeVisible();

    // Set up dialog handlers for both pages
    page1.on('dialog', (dialog) => dialog.accept());
    page2.on('dialog', (dialog) => dialog.accept());

    // Facilitator deletes retro
    await page1.click('#deleteRetroBtn');

    // Both should be redirected to home
    await expect(page1).toHaveURL('/');
    await expect(page2).toHaveURL('/');

    await context1.close();
    await context2.close();
  });
});
