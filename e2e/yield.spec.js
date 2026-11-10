const {
  test, expect, stubCdn, seed, waitReady, disableMotion, sampleState, INDEX_URL,
} = require('./fixtures');

const row = (i) => `#yield-rows .yield-row:nth-child(${i + 2})`;

async function openYield(page) {
  await page.locator('header button', { hasText: '换算' }).click();
  await expect(page.locator('#yield-modal')).toBeVisible();
}

async function newRecord(page) {
  await page.locator('#yield-body button', { hasText: '新建记录' }).click();
  await expect(page.locator('#yield-name')).toBeVisible();
}

async function fillPoints(page, points) {
  for (let i = 0; i < points.length; i++) {
    if (i >= 2) await page.locator('#yield-add').click();
    await page.locator(`${row(i)} input[type=date]`).fill(points[i][0]);
    await page.locator(`${row(i)} input[type=text]`).fill(points[i][1]);
  }
}

async function save(page) {
  await page.locator('#yield-body .modal-footer .btn-gold').click();
}

const listRows = (page) => page.locator('#yield-body .yield-card');

/** 把三条记录直接写进存档再打开弹窗：卡片配色这一层得有真实数据才看得到。 */
async function seedRecords(page) {
  await page.evaluate(() => {
    state.yieldCalc = {
      items: [
        { id: 'r1', name: '微众 - 贵竹 39 号', rows: [{ date: '2025-11-07', nav: '1' }, { date: '2026-11-06', nav: '1.0148' }] },
        { id: 'r2', name: '微众 - 固收纯债', rows: [{ date: '2025-11-06', nav: '1' }, { date: '2026-11-06', nav: '1.0158' }] },
        { id: 'r3', name: '微众 - 诚享 25 号', rows: [{ date: '2025-11-06', nav: '1' }, { date: '2026-11-06', nav: '1.0231' }] },
      ],
    };
    saveState();
    openYieldModal();
  });
  await expect(listRows(page)).toHaveCount(3);
}

test.describe('年化换算 · 卡片配色（亮/暗两套主题）', () => {
  const surfaces = async (page) => page.evaluate(() => {
    const card = document.querySelector('#yield-body .yield-card');
    const cs = getComputedStyle(card);
    const paper = getComputedStyle(document.querySelector('#yield-modal .modal-content'));
    // 变量是 hex，计算色是 rgb()：在页面内借一个探针让浏览器自己归一，别手写换算
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    const varOf = (n) => {
      probe.style.color = '';
      probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      return getComputedStyle(probe).color;
    };
    const out = {
      fill: cs.backgroundColor, edge: cs.borderTopColor, paper: paper.backgroundColor,
      alpha: (cs.backgroundColor.match(/[\d.]+/g) || []).map(Number)[3] ?? 1,
      image: cs.backgroundImage, shadow: cs.boxShadow,
      name: getComputedStyle(card.querySelector('.yield-card-name')).color,
      pctFont: getComputedStyle(card.querySelector('.yield-card-pct')).fontFamily,
      pctSize: getComputedStyle(card.querySelector('.yield-card-pct')).fontSize,
      meta: getComputedStyle(card.querySelector('.yield-card-meta')).color,
      hint: varOf('--record-tint'), expectedEdge: varOf('--record-edge'),
      oldBg2: varOf('--bg-2'),
    };
    probe.remove();
    return out;
  });

  const lum = (c) => {
    const p = (c.match(/[\d.]+/g) || []).map(Number);
    const v = [p[0], p[1], p[2]].map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const contrast = (a, b) => {
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };

  for (const dark of [false, true]) {
    test(`${dark ? '暗色' : '亮色'}：纸签是薄染不是暗板，读数层级与颜色都达标`, async ({ appPage: page }) => {
      if (dark) {
        await page.getByRole('button', { name: '设置' }).click();
        await page.locator('#theme-seg-dark').click();
        await page.keyboard.press('Escape');
        await expect(page.locator('html')).toHaveClass(/dark/);
      }
      await seedRecords(page);
      const s = await surfaces(page);

      // 卡片与弹窗纸面只差一档染色，不再是 --bg-2 那块比纸面深得多的米黄板
      expect(s.fill).toBe(s.hint);
      expect(s.fill).not.toBe(s.oldBg2);
      expect(s.edge).toBe(s.expectedEdge);
      expect(contrast(s.fill, s.paper)).toBeLessThan(1.25);
      // 底必须不透明且不带渐变：AA 巡检按这枚平底色取色，渐变会让整块字静默离开巡检
      expect(s.alpha).toBe(1);
      expect(s.image).toBe('none');
      // 光泽只走 box-shadow：顶边受光 + 左缘金脊，不是 background-image
      expect(s.shadow).toContain('inset');
      // 名称压回正文字色（不再整张卡都是赭色），主读数升到读数档
      expect(contrast(s.name, s.fill)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(s.meta, s.fill)).toBeGreaterThanOrEqual(4.5);
      expect(parseFloat(s.pctSize)).toBeGreaterThan(14);
      expect(s.pctFont).toContain('Cormorant');
    });
  }
});

test.describe('年化换算：记录', () => {
  test('空态：没有记录时只给「新建」', async ({ appPage: page }) => {
    await openYield(page);
    await expect(page.locator('#yield-body')).toContainText('还没有记录');
    await expect(listRows(page)).toHaveCount(0);
  });

  test('新建 → 填两个时点 → 保存：列表出现名称、区间与年化', async ({ appPage: page }) => {
    await openYield(page);
    await newRecord(page);
    await page.locator('#yield-name').fill('某某理财');
    await fillPoints(page, [['2025-01-01', '1'], ['2026-01-01', '1.05']]);
    await expect(page.locator('#yield-result')).toContainText('+5.00%');
    await save(page);

    await expect(listRows(page)).toHaveCount(1);
    const first = listRows(page).first();
    await expect(first).toContainText('某某理财');
    await expect(first).toContainText('2025-01-01 → 2026-01-01');
    await expect(first).toContainText('365 天');
    await expect(first).toContainText('+5.00%');
  });

  test('点开已有记录回到编辑：值回填，改名保存后列表跟着变', async ({ appPage: page }) => {
    await openYield(page);
    await newRecord(page);
    await page.locator('#yield-name').fill('旧名字');
    await fillPoints(page, [['2025-01-01', '1'], ['2026-01-01', '1.05']]);
    await save(page);

    await listRows(page).first().click();
    await expect(page.locator('#yield-name')).toHaveValue('旧名字');
    await expect(page.locator(`${row(0)} input[type=date]`)).toHaveValue('2025-01-01');
    await page.locator('#yield-name').fill('新名字');
    await save(page);

    await expect(listRows(page)).toHaveCount(1);
    await expect(listRows(page).first()).toContainText('新名字');
    await expect(listRows(page).first()).not.toContainText('旧名字');
  });

  test('三个时点保存后，列表仍只报首尾年化', async ({ appPage: page }) => {
    await openYield(page);
    await newRecord(page);
    await fillPoints(page, [['2025-01-01', '1'], ['2025-04-02', '1.01'], ['2025-07-02', '1.03']]);
    const segs = page.locator('#yield-result .yield-seg');
    await expect(segs).toHaveCount(3);
    await expect(page.locator('#yield-result')).toContainText('+3.00%');
    await save(page);
    await expect(listRows(page).first()).toContainText('2025-01-01 → 2025-07-02');
  });

  test('少于两个有效时点不让保存，提示留着不落库', async ({ appPage: page }) => {
    await openYield(page);
    await newRecord(page);
    await fillPoints(page, [['2025-01-01', '1']]);
    await save(page);
    await expect(page.locator('#toast-area')).toContainText('至少填两个时点');
    await expect(page.locator('#yield-name')).toBeVisible(); // 还在编辑视图
    expect(await page.evaluate(() => state.yieldCalc.items)).toHaveLength(0);
  });

  test('短区间给警示，脏行只点名不连累别的行', async ({ appPage: page }) => {
    await openYield(page);
    await newRecord(page);
    await fillPoints(page, [['2025-01-01', '1'], ['2025-01-04', '1.001']]);
    await expect(page.locator('#yield-result')).toContainText('区间不足 7 天');

    await page.locator(`${row(1)} input[type=text]`).fill('0');
    await expect(page.locator('#yield-result')).toContainText('1 行日期或净值无效');
  });

  test('每次打开都先看到卡片面板：编辑到一半关掉再开，回列表', async ({ appPage: page }) => {
    await openYield(page);
    await newRecord(page);
    await page.locator('#yield-name').fill('半途');
    await page.keyboard.press('Escape');
    await expect(page.locator('#yield-modal')).toBeHidden();

    await openYield(page);
    await expect(page.locator('#yield-name')).toBeHidden();
    await expect(page.locator('#yield-body button', { hasText: '新建记录' })).toBeVisible();
  });

  test('删除要过一次确认', async ({ appPage: page }) => {
    await openYield(page);
    await newRecord(page);
    await fillPoints(page, [['2025-01-01', '1'], ['2026-01-01', '1.05']]);
    await save(page);

    await listRows(page).first().click();
    await page.locator('#yield-body .modal-footer .btn-danger').click();
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await page.click('#confirm-ok-btn');
    await expect(page.locator('#yield-body')).toContainText('还没有记录');
    expect(await page.evaluate(() => state.yieldCalc.items)).toHaveLength(0);
  });

  test('刷新后记录还在（落进存档）', async ({ appPage: page }) => {
    await openYield(page);
    await newRecord(page);
    await page.locator('#yield-name').fill('长期理财');
    await fillPoints(page, [['2025-01-01', '1'], ['2026-01-01', '1.05']]);
    await save(page);
    await expect.poll(
      () => page.evaluate(() => (state.yieldCalc.items || []).length)
    ).toBe(1);

    await page.reload();
    await waitReady(page);
    await openYield(page);
    await expect(listRows(page)).toHaveCount(1);
    await expect(listRows(page).first()).toContainText('长期理财');
  });

  test('不进资产门槛：在消费页点页头就能开', async ({ appPage: page }) => {
    await expect(page.locator('#tabs-assets')).toBeHidden();
    await openYield(page);
    await expect(page.locator('#tabs-assets')).toBeHidden();
  });
});

test.describe('年化换算 · 语言', () => {
  test('切换界面语言：标题、列表与脚本拼的读数一起换', async ({ appPage: page }) => {
    await openYield(page);
    await newRecord(page);
    await fillPoints(page, [['2025-01-01', '1'], ['2026-01-01', '1.05']]);
    await expect(page.locator('#yield-result')).toContainText('复利年化');

    await page.evaluate(() => setLang('en'));
    await expect(page.locator('#yield-result')).toContainText('Compound annual');
    await expect(page.locator('#yield-modal')).toContainText('All records');

    await save(page);
    await expect(listRows(page).first()).toContainText('365 days');

    await page.evaluate(() => setLang('zh'));
    await expect(listRows(page).first()).toContainText('365 天');
  });
});

test.describe('年化换算 · 导出', () => {
  test('导出的备份里带着换算记录', async ({ page }) => {
    await disableMotion(page);
    await stubCdn(page);
    await seed(page, sampleState());
    await page.addInitScript(() => {
      window.showSaveFilePicker = async (o) => {
        const root = await navigator.storage.getDirectory();
        const fh = await root.getFileHandle(o.suggestedName, { create: true });
        return { createWritable: async () => await fh.createWritable() };
      };
      window.showDirectoryPicker = async () => await navigator.storage.getDirectory();
    });
    await page.goto(INDEX_URL);
    await waitReady(page);

    await openYield(page);
    await newRecord(page);
    await page.locator('#yield-name').fill('导出测试');
    await fillPoints(page, [['2025-01-01', '1'], ['2026-01-01', '1.05']]);
    await save(page);

    await page.evaluate(() => showImportExport());
    await page.click('#io-modal .btn-gold');
    await expect(page.locator('#toast-area')).toContainText('数据已导出');

    const name = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      for await (const [n] of root.entries()) if (n.endsWith('.json')) return n;
      return null;
    });
    expect(name).toBeTruthy();
    const text = await page.evaluate(async (n) => {
      const root = await navigator.storage.getDirectory();
      const fh = await root.getFileHandle(n);
      return await (await fh.getFile()).text();
    }, name);
    const data = JSON.parse(text);
    expect(data.yieldCalc.items).toHaveLength(1);
    expect(data.yieldCalc.items[0].name).toBe('导出测试');
    expect(data.yieldCalc.items[0].rows).toHaveLength(2);
  });
});
