const { test, expect, stubCdn, seed, waitReady, disableMotion, sampleState, INDEX_URL } = require('./fixtures');
const { date } = require('../logic.js');

// 备份落点 E2E：自动与手动**统一**先弹确认框、再走系统文件窗口，窗口位置由设置里的目录决定。
// headless 里没有原生选择器，用 OPFS（navigator.storage.getDirectory）提供**真实可写句柄**，
// 于是目录写入、IDB 持久化、文件内容都跑真实 API；只有「窗口」本身是假对象，
// 所以能断言的是「传进去的 startIn 就是那个目录」，不能断言窗口在屏幕上真的开在那里。

const today = date.getLocalDateStr;

async function setup(page, opts = {}) {
  await disableMotion(page);
  await stubCdn(page);
  const st = sampleState();
  st.backup = { autoFreq: opts.autoFreq || 'off', lastBackup: null };
  await seed(page, st);
  await page.addInitScript((cfg) => {
    window.__fs = { saveCalls: [], dirPicks: 0, cancelSave: !!cfg.cancelSave, startInIsDir: null, startInSameHandle: null, dirHandle: null };
    window.showDirectoryPicker = async () => {
      window.__fs.dirPicks++;
      window.__fs.dirHandle = await navigator.storage.getDirectory();
      return window.__fs.dirHandle;
    };
    window.showSaveFilePicker = async (o) => {
      window.__fs.saveCalls.push(o && o.suggestedName);
      // 位置一致性：startIn 必须就是设置里那个目录句柄本身（不是名字、不是新句柄）
      window.__fs.startInIsDir = !!o && !!o.startIn;
      window.__fs.startInSameHandle = !!o && !!o.startIn && o.startIn === window.__fs.dirHandle;
      if (window.__fs.cancelSave) throw new DOMException('user aborted', 'AbortError');
      const root = await navigator.storage.getDirectory();
      return await root.getFileHandle(o.suggestedName, { create: true });
    };
    if (cfg.noFsa) { delete window.showDirectoryPicker; delete window.showSaveFilePicker; }
  }, opts);
  // 自动备份的确认框在 4 秒后才弹（Backup prompt delay）。作者要的是「打开几秒后问一次」，
  // 但测试没必要真等：`page.clock` 让这个定时器可以被快进，断言的内容一模一样。
  if (opts.clock) await page.clock.install();
  await page.goto(INDEX_URL);
  await waitReady(page);
}

async function listRoot(page) {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const names = [];
    for await (const [name] of root.entries()) names.push(name);
    return names.sort();
  });
}

async function readRootFile(page, name) {
  return page.evaluate(async (n) => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle(n);
    return await (await fh.getFile()).text();
  }, name);
}

const readBackup = (page) => page.evaluate(() => state.backup);

async function openExport(page) {
  await page.evaluate(() => showImportExport());
  await page.click('#io-modal .btn-gold');
}

const confirmOk = (page) => page.click('#confirm-ok-btn');
const confirmBox = (page) => page.locator('#confirm-modal');

test('设置里选择/清除备份文件夹：边注说清它是「文件窗口起点」，句柄写入 IndexedDB', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => showSettings());
  await expect(page.locator('#settings-backup-dir-note')).toHaveText('未选择，文件窗口默认打开上次的目录');
  await expect(page.locator('#backup-dir-clear')).toBeHidden();

  await page.click('#backup-dir-choose');
  await expect(page.locator('#settings-backup-dir-note')).toContainText('文件窗口默认打开这里');
  await expect(page.locator('#backup-dir-clear')).toBeVisible();
  await expect(page.locator('#toast-area')).toContainText('已选择备份文件夹');

  // 句柄已持久化。这里只断言 key 存在、不做 reload：headless Chromium 从 IDB
  // 反序列化 OPFS 句柄会让渲染进程崩溃（真实选择器的句柄不受影响）。
  const keys = await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('wealth-backup', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => {
      const db = req.result;
      const kq = db.transaction('handles', 'readonly').objectStore('handles').getAllKeys();
      kq.onsuccess = () => { const v = kq.result; db.close(); resolve(v); };
      kq.onerror = () => reject(kq.error);
    };
    req.onerror = () => reject(req.error);
  }));
  expect(keys).toEqual(['backupDir']);

  await page.click('#backup-dir-clear');
  await expect(page.locator('#settings-backup-dir-note')).toHaveText('未选择，文件窗口默认打开上次的目录');
  await expect(page.locator('#backup-dir-clear')).toBeHidden();
});

test('手动导出：文件窗口从所选目录打开，确认写入才记「已备份」', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => showSettings());
  await page.click('#backup-dir-choose');
  await page.evaluate(() => closeModal('settings-modal'));

  await openExport(page);
  await expect(page.locator('#toast-area')).toContainText('数据已导出');
  const calls = await page.evaluate(() => window.__fs.saveCalls);
  expect(calls[0]).toBe(`wealth-data-${today()}.json`);
  expect(await page.evaluate(() => window.__fs.startInSameHandle)).toBe(true);
  const text = await readRootFile(page, calls[0]);
  expect(text).not.toContain('"totalCNY"');
  expect(await readBackup(page)).toEqual({ autoFreq: 'off', lastBackup: today() });
});

test('手动导出未选目录：窗口从默认位置打开，取消则连状态都不动', async ({ page }) => {
  await setup(page, { cancelSave: true });
  await openExport(page);
  await expect(page.locator('#toast-area')).toContainText('已取消备份');
  expect(await page.evaluate(() => window.__fs.startInIsDir)).toBe(false);
  expect((await readBackup(page)).lastBackup).toBe(null);

  await page.evaluate(() => { window.__fs.cancelSave = false; });
  await openExport(page);
  await expect(page.locator('#toast-area')).toContainText('数据已导出');
  expect((await readBackup(page)).lastBackup).toBe(today());
});

test('不支持文件 API 时回退下载：中性提示，不虚报已备份', async ({ page }) => {
  await setup(page, { noFsa: true });
  const dl = page.waitForEvent('download');
  await openExport(page);
  await dl;
  await expect(page.locator('#toast-area')).toContainText('已开始下载，请在下载栏确认');
  expect((await readBackup(page)).lastBackup).toBe(null);
});

test('自动备份先弹确认框（写清文件名与目录），点确认才落盘、才记「已备份」', async ({ page }) => {
  await setup(page, { autoFreq: 'daily', clock: true });
  // 4 秒定时器读的是当前句柄：加载后立刻选文件夹，确认框就会写上这个目录名
  await page.evaluate(() => showSettings());
  await page.click('#backup-dir-choose');
  await expect.poll(() => page.evaluate(() => !!backupDirHandle), { timeout: 5000 }).toBe(true);
  const dirName = await page.evaluate(() => backupDirHandle.name);
  await page.evaluate(() => closeModal('settings-modal'));

  const base = `wealth-data-${today()}.json`;
  await page.clock.runFor(4200); // 快进那 4 秒的「打开几秒后问一次」
  await expect(confirmBox(page)).toBeVisible();
  await expect(page.locator('#confirm-title')).toHaveText('自动备份');
  await expect(page.locator('#confirm-msg')).toContainText(base);
  if (dirName) await expect(page.locator('#confirm-msg')).toContainText(dirName);
  expect(await listRoot(page)).not.toContain(base); // 点确认之前不许写盘

  await confirmOk(page);
  await expect(page.locator('#toast-area')).toContainText('已自动备份');
  await expect.poll(async () => (await listRoot(page)).includes(base), { timeout: 5000 }).toBe(true);
  expect(await page.evaluate(() => window.__fs.startInSameHandle)).toBe(true);
  expect(await readBackup(page)).toEqual({ autoFreq: 'daily', lastBackup: today() });
  // 已经确认写入 → 今天不再问
  expect(await page.evaluate(() => backup.shouldAutoBackup(state, date.getLocalDateStr()))).toBe(false);
});

test('自动备份点取消：不写盘、不记状态，当天再进来还会再问一次', async ({ page }) => {
  await setup(page, { autoFreq: 'daily', cancelSave: true, clock: true });
  const base = `wealth-data-${today()}.json`;

  await page.clock.runFor(4200);
  await expect(confirmBox(page)).toBeVisible();
  await confirmOk(page);
  await expect(page.locator('#toast-area')).toContainText('已取消备份');
  expect(await listRoot(page)).not.toContain(base);
  expect(await readBackup(page)).toEqual({ autoFreq: 'daily', lastBackup: null });

  // 用户实测的 bug：「取消后第二次进来就没了」——旧实现把回退下载记成节流，当天不再问
  await page.reload();
  await waitReady(page);
  await page.clock.runFor(4200);
  await expect(confirmBox(page)).toBeVisible();
});
