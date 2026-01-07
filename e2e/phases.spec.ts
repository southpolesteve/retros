import { test, expect } from '@playwright/test';

test.describe('Phase Transitions', () => {
  test.beforeEach(async ({ page }) => {
    // Create and join a retro as facilitator
    await page.goto('/');
    await page.click('#startRetro');
    await page.fill('#retroNameInput', 'Phase Test Retro');
    await page.click('#createBtn');
    await page.waitForURL(/\/retro\/[a-z0-9]+$/);
    await page.fill('#nameInput', 'Facilitator');
    await page.click('#joinBtn');
    await expect(page.locator('#mainContent')).toBeVisible();
    // Wait for facilitator controls to appear (confirms we're the facilitator)
    await expect(page.locator('#facilitatorControls')).toBeVisible();
  });

  test('facilitator can progress through all phases', async ({ page }) => {
    // Should start in Waiting phase
    await expect(page.locator('#phaseLabel')).toHaveText('Waiting');
    await expect(page.locator('#nextPhaseBtn')).toHaveText('Start Adding Items');

    // Advance to Adding
    await page.click('#nextPhaseBtn');
    await expect(page.locator('#phaseLabel')).toHaveText('Adding');
    await expect(page.locator('#nextPhaseBtn')).toHaveText('Start Voting');
    
    // Add item inputs should be visible
    await expect(page.locator('.add-item').first()).toBeVisible();

    // Advance to Voting
    await page.click('#nextPhaseBtn');
    await expect(page.locator('#phaseLabel')).toHaveText('Voting');
    await expect(page.locator('#nextPhaseBtn')).toHaveText('End Voting & Discuss');
    
    // Add item inputs should be hidden
    await expect(page.locator('.add-item').first()).toBeHidden();

    // Advance to Discussion
    await page.click('#nextPhaseBtn');
    await expect(page.locator('#phaseLabel')).toHaveText('Discussion');
    await expect(page.locator('#nextPhaseBtn')).toHaveText('Complete Retro');

    // Advance to Complete
    await page.click('#nextPhaseBtn');
    await expect(page.locator('#phaseLabel')).toHaveText('Complete');
    
    // Next phase button should be hidden in Complete
    await expect(page.locator('#nextPhaseBtn')).toBeHidden();
  });

  test('facilitator can go back one phase', async ({ page }) => {
    // Advance to Adding
    await page.click('#nextPhaseBtn');
    await expect(page.locator('#phaseLabel')).toHaveText('Adding');

    // Back button should appear
    const prevBtn = page.locator('#prevPhaseBtn');
    await expect(prevBtn).toBeVisible();
    await expect(prevBtn).toHaveText('Back to Waiting');

    // Go back
    await prevBtn.click();
    await expect(page.locator('#phaseLabel')).toHaveText('Waiting');

    // Advance to Voting
    await page.click('#nextPhaseBtn'); // Adding
    await page.click('#nextPhaseBtn'); // Voting
    await expect(page.locator('#phaseLabel')).toHaveText('Voting');

    // Go back to Adding
    await page.locator('#prevPhaseBtn').click();
    await expect(page.locator('#phaseLabel')).toHaveText('Adding');
  });

  test('items can only be added in Adding phase', async ({ page }) => {
    // In Waiting phase, add-item should be hidden
    await expect(page.locator('.add-item').first()).toBeHidden();

    // Advance to Adding
    await page.click('#nextPhaseBtn');
    await expect(page.locator('.add-item').first()).toBeVisible();

    // Add an item
    await page.fill('#startInput', 'Test item for start column');
    await page.click('button[onclick="addItem(\'start\')"]');

    // Item count should appear (items hidden during Adding)
    await expect(page.locator('#startItems')).toContainText('1 item added');

    // Advance to Voting - add-item should be hidden again
    await page.click('#nextPhaseBtn');
    await expect(page.locator('.add-item').first()).toBeHidden();
    
    // Item should now be visible
    await expect(page.locator('#startItems .item')).toBeVisible();
    await expect(page.locator('#startItems .item')).toContainText('Test item for start column');
  });

  test('voting only works in Voting phase', async ({ page }) => {
    // Add an item first
    await page.click('#nextPhaseBtn'); // Adding
    await page.fill('#startInput', 'Votable item');
    await page.click('button[onclick="addItem(\'start\')"]');

    // Advance to Voting
    await page.click('#nextPhaseBtn');
    await expect(page.locator('#phaseLabel')).toHaveText('Voting');

    // Vote button should be visible
    await expect(page.locator('.btn-vote')).toBeVisible();
    await expect(page.locator('#votesRemaining')).toBeVisible();
    await expect(page.locator('#votesCount')).toHaveText('3');

    // Vote on the item
    await page.click('.btn-vote');
    await expect(page.locator('#votesCount')).toHaveText('2');
    await expect(page.locator('.btn-vote')).toHaveText('Voted');

    // Advance to Discussion - vote buttons should be gone, votes should show
    await page.click('#nextPhaseBtn');
    await expect(page.locator('#phaseLabel')).toHaveText('Discussion');
    await expect(page.locator('.btn-vote')).toHaveCount(0);
    await expect(page.locator('.item-votes')).toContainText('1 vote');
  });

  test('participant cannot change phases', async ({ browser }) => {
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    
    // Facilitator creates retro
    await page1.goto('/');
    await page1.click('#startRetro');
    await page1.fill('#retroNameInput', 'Participant Phase Test');
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

    // Participant should not see facilitator controls
    await expect(page2.locator('#facilitatorControls')).toBeHidden();
    await expect(page2.locator('#nextPhaseBtn')).toBeHidden();

    // Facilitator advances phase
    await page1.click('#nextPhaseBtn');
    
    // Both should see Adding phase
    await expect(page1.locator('#phaseLabel')).toHaveText('Adding');
    await expect(page2.locator('#phaseLabel')).toHaveText('Adding');

    await context1.close();
    await context2.close();
  });
});
