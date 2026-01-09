import { expect, test } from '@playwright/test';

test.describe('Grouping Feature', () => {
  test.beforeEach(async ({ page }) => {
    // Create and join a retro as facilitator
    await page.goto('/');
    await page.click('#startRetro');
    await page.fill('#retroNameInput', 'Grouping Test Retro');
    await page.click('#createBtn');
    await page.waitForURL(/\/retro\/[a-z0-9]+$/);
    await page.fill('#nameInput', 'Facilitator');
    await page.click('#joinBtn');
    await expect(page.locator('#mainContent')).toBeVisible();

    // Advance to Adding phase and add some items
    await page.click('#nextPhaseBtn'); // Adding
    await expect(page.locator('#phaseLabel')).toHaveText('Adding');

    // Add 3 items to Start column
    await page.fill('#startInput', 'Item A');
    await page.click('button[onclick="addItem(\'start\')"]');
    await page.fill('#startInput', 'Item B');
    await page.click('button[onclick="addItem(\'start\')"]');
    await page.fill('#startInput', 'Item C');
    await page.click('button[onclick="addItem(\'start\')"]');

    // Advance to Grouping phase
    await page.click('#nextPhaseBtn'); // Grouping
    await expect(page.locator('#phaseLabel')).toHaveText('Grouping');
  });

  test('items are visible in Grouping phase', async ({ page }) => {
    // All 3 items should be visible
    await expect(page.locator('#startItems .item')).toHaveCount(3);
    await expect(page.locator('#startItems')).toContainText('Item A');
    await expect(page.locator('#startItems')).toContainText('Item B');
    await expect(page.locator('#startItems')).toContainText('Item C');
  });

  test('items are draggable in Grouping phase', async ({ page }) => {
    // Items should have draggable class
    const items = page.locator('#startItems .item.draggable');
    await expect(items).toHaveCount(3);
  });

  test('can group two items by drag and drop', async ({ page }) => {
    const itemA = page.locator('#startItems .item', { hasText: 'Item A' });
    const itemB = page.locator('#startItems .item', { hasText: 'Item B' });

    // Drag Item A onto Item B
    await itemA.dragTo(itemB);

    // Should now have 1 group and 1 ungrouped item
    await expect(page.locator('#startItems .item-group')).toHaveCount(1);
    await expect(page.locator('#startItems > .item')).toHaveCount(1); // Only Item C ungrouped

    // Group should contain Item A and Item B
    const group = page.locator('#startItems .item-group');
    await expect(group.locator('.group-item')).toHaveCount(2);
    await expect(group).toContainText('Item A');
    await expect(group).toContainText('Item B');

    // Item C should still be ungrouped
    await expect(page.locator('#startItems > .item')).toContainText('Item C');
  });

  test('can add third item to existing group', async ({ page }) => {
    const itemA = page.locator('#startItems .item', { hasText: 'Item A' });
    const itemB = page.locator('#startItems .item', { hasText: 'Item B' });

    // First, group A and B
    await itemA.dragTo(itemB);
    await expect(page.locator('#startItems .item-group')).toHaveCount(1);

    // Now drag C onto the group
    const itemC = page.locator('#startItems > .item', { hasText: 'Item C' });
    const group = page.locator('#startItems .item-group');
    await itemC.dragTo(group);

    // Should still have exactly 1 group, no ungrouped items
    await expect(page.locator('#startItems .item-group')).toHaveCount(1);
    await expect(page.locator('#startItems > .item')).toHaveCount(0);

    // Group should contain all 3 items
    await expect(group.locator('.group-item')).toHaveCount(3);
    await expect(group).toContainText('Item A');
    await expect(group).toContainText('Item B');
    await expect(group).toContainText('Item C');
  });

  test('can ungroup items', async ({ page }) => {
    const itemA = page.locator('#startItems .item', { hasText: 'Item A' });
    const itemB = page.locator('#startItems .item', { hasText: 'Item B' });

    // Group A and B
    await itemA.dragTo(itemB);
    await expect(page.locator('#startItems .item-group')).toHaveCount(1);

    // Click ungroup button
    await page.click('.btn-ungroup');

    // Should have no groups, all items ungrouped
    await expect(page.locator('#startItems .item-group')).toHaveCount(0);
    await expect(page.locator('#startItems > .item')).toHaveCount(3);
  });

  test('can rename a group', async ({ page }) => {
    const itemA = page.locator('#startItems .item', { hasText: 'Item A' });
    const itemB = page.locator('#startItems .item', { hasText: 'Item B' });

    // Group A and B
    await itemA.dragTo(itemB);

    // Default title should be "Grouped Items"
    await expect(page.locator('.group-title')).toHaveText('Grouped Items');

    // Click to edit title
    await page.click('.group-title');
    await page.fill('.group-title-input', 'My Custom Group');
    await page.keyboard.press('Enter');

    // Title should be updated
    await expect(page.locator('.group-title')).toHaveText('My Custom Group');
  });

  test('groups persist through phase changes', async ({ page }) => {
    const itemA = page.locator('#startItems .item', { hasText: 'Item A' });
    const itemB = page.locator('#startItems .item', { hasText: 'Item B' });

    // Group A and B
    await itemA.dragTo(itemB);
    await expect(page.locator('#startItems .item-group')).toHaveCount(1);

    // Advance to Voting
    await page.click('#nextPhaseBtn');
    await expect(page.locator('#phaseLabel')).toHaveText('Voting');

    // Group should still exist
    await expect(page.locator('#startItems .item-group')).toHaveCount(1);
    await expect(page.locator('#startItems .item-group')).toContainText(
      'Item A',
    );
    await expect(page.locator('#startItems .item-group')).toContainText(
      'Item B',
    );

    // Ungrouped item should still be there
    await expect(page.locator('#startItems > .item')).toHaveCount(1);
    await expect(page.locator('#startItems > .item')).toContainText('Item C');
  });

  test('cannot group in Voting phase', async ({ page }) => {
    // Advance to Voting
    await page.click('#nextPhaseBtn');
    await expect(page.locator('#phaseLabel')).toHaveText('Voting');

    // Items should NOT be draggable
    const draggableItems = page.locator('#startItems .item.draggable');
    await expect(draggableItems).toHaveCount(0);

    // Ungroup button should not be visible
    await expect(page.locator('.btn-ungroup')).toHaveCount(0);
  });

  test('no empty groups should exist', async ({ page }) => {
    const itemA = page.locator('#startItems .item', { hasText: 'Item A' });
    const itemB = page.locator('#startItems .item', { hasText: 'Item B' });

    // Group A and B
    await itemA.dragTo(itemB);

    // Ungroup
    await page.click('.btn-ungroup');

    // There should be NO groups (especially no empty ones)
    await expect(page.locator('#startItems .item-group')).toHaveCount(0);

    // All items should be ungrouped
    await expect(page.locator('#startItems > .item')).toHaveCount(3);
  });

  test('no duplicate items after multiple group operations', async ({
    page,
  }) => {
    const itemA = page.locator('#startItems .item', { hasText: 'Item A' });
    const itemB = page.locator('#startItems .item', { hasText: 'Item B' });

    // Group A and B
    await itemA.dragTo(itemB);

    // Add C to group
    const itemC = page.locator('#startItems > .item', { hasText: 'Item C' });
    const group = page.locator('#startItems .item-group');
    await itemC.dragTo(group);

    // Ungroup
    await page.click('.btn-ungroup');

    // Should have exactly 3 items total, no duplicates
    await expect(page.locator('#startItems > .item')).toHaveCount(3);

    // Count total text occurrences
    const allText = await page.locator('#startItems').textContent();
    expect((allText?.match(/Item A/g) || []).length).toBe(1);
    expect((allText?.match(/Item B/g) || []).length).toBe(1);
    expect((allText?.match(/Item C/g) || []).length).toBe(1);
  });

  test('group and ungroup multiple times', async ({ page }) => {
    // Group -> Ungroup -> Group -> Ungroup
    for (let i = 0; i < 3; i++) {
      // Group
      const itemANow = page.locator('#startItems > .item', {
        hasText: 'Item A',
      });
      const itemBNow = page.locator('#startItems > .item', {
        hasText: 'Item B',
      });
      await itemANow.dragTo(itemBNow);
      await expect(page.locator('#startItems .item-group')).toHaveCount(1);

      // Ungroup
      await page.click('.btn-ungroup');
      await expect(page.locator('#startItems .item-group')).toHaveCount(0);
      await expect(page.locator('#startItems > .item')).toHaveCount(3);
    }
  });

  test('groups sync correctly between two users', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const facilitator = await context1.newPage();
    const participant = await context2.newPage();

    try {
      // Facilitator creates retro
      await facilitator.goto('/');
      await facilitator.click('#startRetro');
      await facilitator.fill('#retroNameInput', 'Multi-user Grouping Test');
      await facilitator.click('#createBtn');
      await facilitator.waitForURL(/\/retro\/[a-z0-9]+$/);
      const retroUrl = facilitator.url();

      await facilitator.fill('#nameInput', 'Facilitator');
      await facilitator.click('#joinBtn');
      await expect(facilitator.locator('#mainContent')).toBeVisible();

      // Participant joins
      await participant.goto(retroUrl);
      await participant.fill('#nameInput', 'Participant');
      await participant.click('#joinBtn');
      await expect(participant.locator('#mainContent')).toBeVisible();

      // Facilitator advances to Adding and adds items
      await facilitator.click('#nextPhaseBtn');
      await facilitator.fill('#startInput', 'Item A');
      await facilitator.click('button[onclick="addItem(\'start\')"]');
      await facilitator.fill('#startInput', 'Item B');
      await facilitator.click('button[onclick="addItem(\'start\')"]');

      // Advance to Grouping
      await facilitator.click('#nextPhaseBtn');
      await expect(facilitator.locator('#phaseLabel')).toHaveText('Grouping');
      await expect(participant.locator('#phaseLabel')).toHaveText('Grouping');

      // Both should see 2 items
      await expect(facilitator.locator('#startItems > .item')).toHaveCount(2);
      await expect(participant.locator('#startItems > .item')).toHaveCount(2);

      // Facilitator groups items
      const itemA = facilitator.locator('#startItems .item', {
        hasText: 'Item A',
      });
      const itemB = facilitator.locator('#startItems .item', {
        hasText: 'Item B',
      });
      await itemA.dragTo(itemB);

      // Both should see the group
      await expect(facilitator.locator('#startItems .item-group')).toHaveCount(
        1,
      );
      await expect(participant.locator('#startItems .item-group')).toHaveCount(
        1,
      );

      // Both should see no ungrouped items
      await expect(facilitator.locator('#startItems > .item')).toHaveCount(0);
      await expect(participant.locator('#startItems > .item')).toHaveCount(0);

      // Both should see 2 items in the group
      await expect(
        facilitator.locator('#startItems .item-group .group-item'),
      ).toHaveCount(2);
      await expect(
        participant.locator('#startItems .item-group .group-item'),
      ).toHaveCount(2);
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('groups persist after page refresh', async ({ page }) => {
    const itemA = page.locator('#startItems .item', { hasText: 'Item A' });
    const itemB = page.locator('#startItems .item', { hasText: 'Item B' });

    // Group A and B
    await itemA.dragTo(itemB);
    await expect(page.locator('#startItems .item-group')).toHaveCount(1);

    // Refresh the page
    await page.reload();

    // Should auto-reconnect and still see the group
    await expect(page.locator('#mainContent')).toBeVisible();
    await expect(page.locator('#startItems .item-group')).toHaveCount(1);
    await expect(page.locator('#startItems > .item')).toHaveCount(1); // Item C

    // Group should have A and B
    const group = page.locator('#startItems .item-group');
    await expect(group.locator('.group-item')).toHaveCount(2);
    await expect(group).toContainText('Item A');
    await expect(group).toContainText('Item B');
  });

  test('can vote on a group as a whole', async ({ page }) => {
    const itemA = page.locator('#startItems .item', { hasText: 'Item A' });
    const itemB = page.locator('#startItems .item', { hasText: 'Item B' });

    // Group A and B
    await itemA.dragTo(itemB);
    await expect(page.locator('#startItems .item-group')).toHaveCount(1);

    // Advance to Voting
    await page.click('#nextPhaseBtn');
    await expect(page.locator('#phaseLabel')).toHaveText('Voting');

    // Group should have a single vote button in the header, not per-item buttons
    const group = page.locator('#startItems .item-group');
    const groupVoteBtn = group.locator('.group-header .btn-vote');
    await expect(groupVoteBtn).toHaveCount(1);
    await expect(groupVoteBtn).toHaveText('Vote');

    // Items inside the group should NOT have vote buttons
    const itemVoteBtns = group.locator('.group-item .btn-vote');
    await expect(itemVoteBtns).toHaveCount(0);

    // Vote on the group
    await groupVoteBtn.click();
    await expect(groupVoteBtn).toHaveText('Voted');
    await expect(groupVoteBtn).toHaveClass(/voted/);

    // Votes remaining should decrease
    await expect(page.locator('#votesCount')).toHaveText('2');
  });

  test('can unvote a group', async ({ page }) => {
    const itemA = page.locator('#startItems .item', { hasText: 'Item A' });
    const itemB = page.locator('#startItems .item', { hasText: 'Item B' });

    // Group A and B
    await itemA.dragTo(itemB);

    // Advance to Voting
    await page.click('#nextPhaseBtn');
    await expect(page.locator('#phaseLabel')).toHaveText('Voting');

    const groupVoteBtn = page.locator(
      '#startItems .item-group .group-header .btn-vote',
    );

    // Vote on the group
    await groupVoteBtn.click();
    await expect(groupVoteBtn).toHaveText('Voted');
    await expect(page.locator('#votesCount')).toHaveText('2');

    // Unvote
    await groupVoteBtn.click();
    await expect(groupVoteBtn).toHaveText('Vote');
    await expect(groupVoteBtn).not.toHaveClass(/voted/);
    await expect(page.locator('#votesCount')).toHaveText('3');
  });

  test('group votes are counted separately from item votes', async ({
    page,
  }) => {
    const itemA = page.locator('#startItems .item', { hasText: 'Item A' });
    const itemB = page.locator('#startItems .item', { hasText: 'Item B' });

    // Group A and B
    await itemA.dragTo(itemB);

    // Advance to Voting
    await page.click('#nextPhaseBtn');
    await expect(page.locator('#phaseLabel')).toHaveText('Voting');

    // Vote on the group
    const groupVoteBtn = page.locator(
      '#startItems .item-group .group-header .btn-vote',
    );
    await groupVoteBtn.click();
    await expect(page.locator('#votesCount')).toHaveText('2');

    // Vote on the ungrouped item C
    const itemC = page.locator('#startItems > .item', { hasText: 'Item C' });
    await itemC.locator('.btn-vote').click();
    await expect(page.locator('#votesCount')).toHaveText('1');

    // Advance to Discussion to see vote counts
    await page.click('#nextPhaseBtn');
    await expect(page.locator('#phaseLabel')).toHaveText('Discussion');

    // Group should show 1 vote
    await expect(
      page.locator('#startItems .item-group .group-votes'),
    ).toHaveText('1 vote');

    // Item C should show 1 vote
    await expect(page.locator('#startItems > .item .item-votes')).toHaveText(
      '1 vote',
    );
  });
});
