/*
 * e2e/dialog-native.spec.js — 弹窗的底层机制换成了原生 <dialog>（showModal）
 * --------------------------------------------------------------------------
 * 这套用例是这个迁移的验收面：行为必须和手写遮罩时**逐条一致**，只是执行者换成了平台。
 * 每一条都自成用例，因为它们是不同的失效面：
 *   ① Esc 关窗（平台发 cancel，我们在那里接「取消」语义）
 *   ② 点遮罩空白关窗；从弹窗里按下、拖到外面松手不算（否则选一段文字就把弹窗丢了）
 *   ③ 关窗后焦点回到打开它的那个按钮（手写返回焦点栈已删，现在是平台的承诺）
 *   ④ Tab 走不到背后的表格与按钮（手写焦点陷阱已删，现在是平台的承诺）
 *   ⑤ 开关弹窗不得产生滚动条位移（不再用 overflow:hidden 锁背景，clientWidth/scrollY 必须不动）
 */
const { test, expect, gotoAssets } = require('./fixtures');

const boot = async (page) => {
  await page.goto('index.html');
  await expect(page.locator('html')).toHaveClass(/ready/);
};

test.describe('原生弹窗：撤销式关闭', () => {
  test('① Esc 关窗（确认框走「取消」语义：取消回调必须真的跑到）', async ({ appPage: page }) => {
    // onCancel 是备份流程的收尾（取消备份也得把快照提醒接上）：Esc 若只「关上」而不跑取消语义，
    // 那次取消就静默吞掉了后续动作。
    await page.evaluate(() => {
      window.__ran = [];
      showConfirm('第一次', () => window.__ran.push('ok'), '确认操作', { onCancel: () => window.__ran.push('cancel') });
    });
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#confirm-modal')).toBeHidden();
    expect(await page.evaluate(() => window.__ran), 'Esc = 取消，取消回调要跑（不是「只关掉」）').toEqual(['cancel']);

    // 取消之后再确认：只能执行这一次的确认回调（上一次的不得残留）
    await page.evaluate(() => {
      window.__ran = [];
      showConfirm('第二次', () => window.__ran.push('second'));
    });
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await page.locator('#confirm-ok-btn').click();
    await expect(page.locator('#confirm-modal')).toBeHidden();
    expect(await page.evaluate(() => window.__ran), '确认路径不得触发上一次的取消回调').toEqual(['second']);
  });

  test('① Esc 只关最上层那一层（叠着的时候下层还开着）', async ({ appPage: page }) => {
    await gotoAssets(page, 'categories');
    await page.locator('#categories-list .card', { hasText: '资产类型' }).getByRole('button', { name: '编辑' }).click();
    await expect(page.locator('#category-modal')).toBeVisible();
    await page.fill('#cat-tags', '活期现金');
    await page.locator('#category-modal button[type="submit"]').click();
    await expect(page.locator('#confirm-modal')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#confirm-modal')).toBeHidden();
    await expect(page.locator('#category-modal'), '下层不得被一起关掉').toBeVisible();
  });

  test('② 点遮罩空白关窗（本项目的语义一直是「点外面 = 关」）', async ({ appPage: page }) => {
    await page.locator('#tab-expenses button:has-text("记录消费")').click();
    await expect(page.locator('#expense-modal')).toBeVisible();
    await page.mouse.click(4, 4); // 视口左上角：弹窗盒子之外
    await expect(page.locator('#expense-modal')).toBeHidden();
  });

  test('② 从弹窗里按下、拖到外面松手：不得关（那是一段选择/拖拽，不是「点遮罩」）', async ({ appPage: page }) => {
    await page.locator('#tab-expenses button:has-text("记录消费")').click();
    await expect(page.locator('#expense-modal')).toBeVisible();
    const box = await page.locator('#expense-modal').boundingBox();
    // 从弹窗正文里一个非控件的地方按下（标题右侧的空白），拖到遮罩上再松开
    await page.mouse.move(box.x + box.width - 12, box.y + 16);
    await page.mouse.down();
    await page.mouse.move(4, 4, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('#expense-modal'), '按下在弹窗内 → 不算点了遮罩').toBeVisible();
  });

  test('② 门槛弹窗点遮罩 = 放弃本次（与 Esc 同一条出口，不得只是「关掉」）', async ({ appPage: page }) => {
    await page.locator('#mode-assets').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#asset-gate-modal')).toBeVisible();
    await page.mouse.click(4, 4);
    await expect(page.locator('#asset-gate-modal')).toBeHidden();
    // 放弃本次 = 下次抬闸重新抽句，且不留半截输入
    expect(await page.evaluate(() => document.getElementById('asset-gate-input').value), '放弃时要清掉已抄的半截').toBe('');
  });
});

test.describe('原生弹窗：焦点', () => {
  test('③ 关窗后焦点回到打开它的那个按钮', async ({ appPage: page }) => {
    const opener = page.getByRole('button', { name: '设置' });
    await opener.click();
    await expect(page.locator('#settings-modal')).toBeVisible();
    await page.locator('#settings-modal button:has-text("备份与导入")').click();
    await expect(page.locator('#io-modal')).toBeVisible();
    await page.locator('#io-modal button:has-text("关闭")').click();
    await expect(page.locator('#io-modal')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-modal')).toBeHidden();
    const back = await page.evaluate(() => ({
      text: (document.activeElement.textContent || '').trim(),
      isBody: document.activeElement === document.body,
    }));
    expect(back.isBody, '焦点不得掉到 body').toBe(false);
    expect(back.text, '焦点应回到打开弹窗的那个按钮').toContain('设置');
  });

  test('④ Tab 走不到背后的表格与按钮（焦点只在弹窗里打转）', async ({ appPage: page }) => {
    await page.locator('#tab-expenses button:has-text("记录消费")').click();
    await expect(page.locator('#expense-modal')).toBeVisible();
    for (let i = 0; i < 18; i++) {
      await page.keyboard.press(i < 12 ? 'Tab' : 'Shift+Tab');
      const bad = await page.evaluate(() => {
        const ae = document.activeElement;
        if (document.getElementById('expense-modal').contains(ae)) return null;
        // 平台的允许动作：走到页面之外（activeElement 变 body / null），再按一下绕回来
        return ae && ae !== document.body ? (ae.id || ae.className || ae.tagName) : null;
      });
      expect(bad, `第 ${i + 1} 次按键之后焦点落到了背景里：${bad}`).toBeNull();
    }
    // 背后的搜索框仍然拿不到焦点
    const grab = await page.evaluate(() => {
      const el = document.querySelector('#expenses-list .row-btn, #tabs-expenses .tab-btn');
      if (!el) return 'no-target';
      el.focus();
      return document.getElementById('expense-modal').contains(document.activeElement) ? 'stayed' : 'escaped';
    });
    expect(grab, '弹窗开着时背景控件不得被 focus() 抢走焦点').toBe('stayed');
  });
});

test.describe('原生弹窗：开关不动布局', () => {
  test('⑤ 开关弹窗不产生滚动条位移（clientWidth 与 scrollY 不变）', async ({ appPage: page }) => {
    // 撑长页面：有滚动条时才有「锁背景会不会吃掉滚动条」这件事
    await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.height = '3000px';
      document.querySelector('main').appendChild(probe);
      window.scrollTo(0, 120);
    });
    const geom = () => page.evaluate(() => ({
      cw: document.documentElement.clientWidth,
      sw: document.documentElement.scrollWidth,
      y: Math.round(window.scrollY),
      htmlOverflow: getComputedStyle(document.documentElement).overflow,
      bodyOverflow: getComputedStyle(document.body).overflow,
    }));
    await expect.poll(async () => (await geom()).y).toBeGreaterThan(50);
    const before = await geom();

    await page.locator('#tab-expenses button:has-text("记录消费")').click();
    await expect(page.locator('#expense-modal')).toBeVisible();
    const during = await geom();
    expect(during.cw, '可用宽度不得变化（滚动条不该被吃掉）').toBe(before.cw);
    expect(during.sw, '不得出现横向位移').toBe(before.sw);
    expect(during.y, '滚动位置不得被重置').toBe(before.y);
    expect(during.htmlOverflow, 'html 不得被 overflow:hidden 锁住').toBe(before.htmlOverflow);
    expect(during.bodyOverflow, 'body 不得被 overflow:hidden 锁住').toBe(before.bodyOverflow);

    await page.keyboard.press('Escape');
    await expect(page.locator('#expense-modal')).toBeHidden();
    const after = await geom();
    expect(after.cw, '关闭后同样不得变化').toBe(before.cw);
    expect(after.y, '关闭后滚动位置不得跳').toBe(before.y);
  });
});
