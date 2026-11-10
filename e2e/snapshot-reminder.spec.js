const { test, expect, stubExternal, seed, waitReady, LS_KEY, INDEX_URL } = require('./fixtures');

const END_OF_MONTH = '2026-01-30T10:00:00';
const MID_MONTH = '2026-01-20T10:00:00';

const stateWith = (over = {}) => ({
  lang: 'zh',
  categories: [{ id: 'currency', name: '货币类型', builtin: true, tags: ['CNY', 'HKD', 'USD'] }],
  assets: [{
    id: 'a1', name: '活期', amount: 1000, currency: 'CNY',
    tags: { currency: 'CNY' }, expectedRateMin: 0, expectedRateMax: 0, cashRatio: 100,
  }],
  snapshots: [],
  expenseCategories: [], expenses: [],
  rates: { CNY: 1, HKD: 0.92, USD: 7.24, fetchedAt: null },
  expenseExpectation: 0, netWorthTarget: 0, incomeSafetyFactor: 100,
  runwayTags: [], runwayExpectation: 0,
  backup: { autoFreq: 'off', lastBackup: null },
  ...over,
});

async function boot(page, state, opts = {}) {
  await stubExternal(page);
  await seed(page, state);
  await page.clock.install({ time: new Date(opts.now || END_OF_MONTH) });
  await page.goto(INDEX_URL);
  await waitReady(page);
  await page.clock.runFor(opts.runFor || 2000);
}

const reminder = (page) => page.locator('#snapshot-reminder-modal');

test('月末窗口内、本月无快照 → 弹一次，关掉后记「今天问过」', async ({ page }) => {
  await boot(page, stateWith());
  await expect(reminder(page)).toBeVisible();
  await expect(page.locator('#snapshot-reminder-title')).toHaveText('快照提醒');
  await expect(page.locator('#snapshot-reminder-msg')).toContainText('本月快照还没记');
  await expect(reminder(page).locator('.modal-footer button')).toHaveCount(1);
  await expect(reminder(page).locator('.modal-footer button')).toHaveText('知道了');

  await page.locator('#snapshot-reminder-modal button:has-text("知道了")').click();
  await expect(reminder(page)).toBeHidden();

  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), LS_KEY);
  expect(saved.snapshotReminderLastPrompted).toBe('2026-01-30');
});

test('同一天再进不弹（每天最多一次）', async ({ page }) => {
  await boot(page, stateWith({ snapshotReminderLastPrompted: '2026-01-30' }));
  await page.clock.runFor(5000); // 多快进一点：确认不是「只是还没到」
  await expect(reminder(page)).toBeHidden();
});

test('隔天仍会再问（没记就继续提醒）', async ({ page }) => {
  await boot(page, stateWith({ snapshotReminderLastPrompted: '2026-01-29' }));
  await expect(reminder(page)).toBeVisible();
});

test('本月已有快照、或还没到提醒窗口 → 不弹', async ({ page }) => {
  await boot(page, stateWith({
    snapshots: [{ month: '2026-01', note: '', assets: [], currencyRates: { CNY: 1 } }],
  }));
  await expect(reminder(page)).toBeHidden();

  const page2 = await page.context().newPage();
  try {
    await boot(page2, stateWith(), { now: MID_MONTH });
    await expect(reminder(page2)).toBeHidden();
  } finally {
    await page2.close();
  }
});

test('备份优先：备份框在场时不弹快照，取消备份之后才弹', async ({ page }) => {
  await boot(page, stateWith({ backup: { autoFreq: 'daily', lastBackup: null } }), { runFor: 5000 });
  await expect(page.locator('#confirm-modal')).toBeVisible();
  await expect(reminder(page)).toBeHidden();

  await page.locator('#confirm-modal button:has-text("取消")').click();
  await expect(page.locator('#confirm-modal')).toBeHidden();
  await expect(reminder(page)).toBeVisible();
});

test('设置里的窗口与天数落盘并回显', async ({ page }) => {
  await boot(page, stateWith());
  await page.locator('#snapshot-reminder-modal button:has-text("知道了")').click();
  await page.evaluate(() => showSettings());
  await page.locator('#snap-remind-start').click();
  await expect(page.locator('#snap-remind-start')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#snapshot-reminder-days').fill('20');
  await page.locator('#snapshot-reminder-days').press('Tab'); // change 在失焦时触发（逐键归一会让输入框没法清空）

  expect(await page.evaluate(() => state.snapshotReminder)).toEqual({ window: 'start', days: 20 });

  await page.locator('#snapshot-reminder-days').fill('99');
  await page.locator('#snapshot-reminder-days').press('Tab');
  await expect(page.locator('#snapshot-reminder-days')).toHaveValue('28');
});
