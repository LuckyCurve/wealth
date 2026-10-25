const { test, expect, stubCdn, seed, waitReady, disableMotion, sampleState, INDEX_URL } = require('./fixtures');
const { getLocalDateStr } = require('../logic.js');

// 备份文件夹 E2E：File System Access API 在 headless 里没有原生选择器，
// 用 OPFS（navigator.storage.getDirectory）提供**真实可写句柄**，
// 这样目录写入、同名探测、IDB 持久化都跑的是真实 API，而不是假对象。

const today = getLocalDateStr;

async function setup(page, opts = {}) {
  await disableMotion(page);
  await stubCdn(page);
  const st = sampleState();
  st.backup = { autoFreq: opts.autoFreq || 'off', lastBackup: null, lastAutoDownload: null };
  await seed(page, st);
  await page.addInitScript((cfg) => {
    window.__fs = { saveCalls: [], dirPicks: 0, requests: 0, cancelSave: !!cfg.cancelSave };
    window.showDirectoryPicker = async () => {
      window.__fs.dirPicks++;
      return await navigator.storage.getDirectory();
    };
    window.showSaveFilePicker = async (o) => {
      window.__fs.saveCalls.push(o && o.suggestedName);
      if (window.__fs.cancelSave) throw new DOMException('user aborted', 'AbortError');
      const root = await navigator.storage.getDirectory();
      return await root.getFileHandle(o.suggestedName, { create: true });
    };
    if (cfg.noFsa) { delete window.showDirectoryPicker; delete window.showSaveFilePicker; }
  }, opts);
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

async function writeRootFile(page, name, text) {
  await page.evaluate(async ([n, t]) => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle(n, { create: true });
    const w = await fh.createWritable();
    await w.write(t);
    await w.close();
  }, [name, text]);
}

const readBackup = (page) => page.evaluate(() => state.backup);

async function openExport(page) {
  await page.evaluate(() => showImportExport());
  await page.click('#io-modal .btn-gold');
}

test('设置里选择/清除备份文件夹，边注与按钮同步，句柄写入 IndexedDB', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => showSettings());
  await expect(page.locator('#settings-backup-dir-note')).toHaveText('未选择，备份将保存到「下载」文件夹');
  await expect(page.locator('#backup-dir-clear')).toBeHidden();

  await page.click('#backup-dir-choose');
  await expect(page.locator('#settings-backup-dir-note')).toContainText('已选择');
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
  await expect(page.locator('#settings-backup-dir-note')).toHaveText('未选择，备份将保存到「下载」文件夹');
  await expect(page.locator('#backup-dir-clear')).toBeHidden();
});

test('手动导出写入所选文件夹，同名自动加后缀，且不覆盖第一份', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => showSettings());
  await page.click('#backup-dir-choose');
  await page.evaluate(() => closeModal('settings-modal'));

  await openExport(page);
  await expect(page.locator('#toast-area')).toContainText('数据已导出');
  const base = `wealth-data-${today()}.json`;
  expect(await listRoot(page)).toContain(base);
  const first = await readRootFile(page, base);
  expect(first).not.toContain('"totalCNY"');
  expect(await readBackup(page)).toEqual({ autoFreq: 'off', lastBackup: today(), lastAutoDownload: null });
  expect(await page.evaluate(() => window.__fs.saveCalls.length)).toBe(0); // 不弹保存框

  await openExport(page);
  const second = `wealth-data-${today()}-2.json`;
  await expect.poll(async () => (await listRoot(page)).includes(second), { timeout: 5000 }).toBe(true);
  expect(await readRootFile(page, base)).toBe(first);
  expect(await readRootFile(page, second)).not.toBe('');
});

test('未选文件夹时手动导出走保存框：确认后记成功，取消不记', async ({ page }) => {
  await setup(page, { cancelSave: true });
  await openExport(page);
  await expect(page.locator('#toast-area')).toContainText('已取消导出');
  expect((await readBackup(page)).lastBackup).toBe(null);

  await page.evaluate(() => { window.__fs.cancelSave = false; });
  await openExport(page);
  await expect(page.locator('#toast-area')).toContainText('数据已导出');
  const calls = await page.evaluate(() => window.__fs.saveCalls);
  expect(calls[0]).toMatch(/^wealth-data-\d{4}-\d{2}-\d{2}\.json$/);
  expect((await readBackup(page)).lastBackup).toBe(today());
  expect(await listRoot(page)).toContain(calls[0]);
});

test('不支持文件 API 时回退下载：中性提示，不虚报已备份', async ({ page }) => {
  await setup(page, { noFsa: true });
  const dl = page.waitForEvent('download');
  await openExport(page);
  await dl;
  await expect(page.locator('#toast-area')).toContainText('已开始下载，请在下载栏确认');
  expect((await readBackup(page)).lastBackup).toBe(null);
});

test('自动备份写入已授权文件夹；同名不覆盖', async ({ page }) => {
  await setup(page, { autoFreq: 'daily' });
  // 4 秒定时器在读句柄时才取当前值：加载后立刻选文件夹，自动备份就会写进去
  await page.evaluate(() => showSettings());
  await page.click('#backup-dir-choose');

  const base = `wealth-data-${today()}.json`;
  await expect.poll(async () => (await listRoot(page)).includes(base), { timeout: 12000 }).toBe(true);
  await expect(page.locator('#toast-area')).toContainText('已自动备份');
  expect(await readBackup(page)).toEqual({ autoFreq: 'daily', lastBackup: today(), lastAutoDownload: today() });

  // 同名：写哨兵内容后再次尝试自动备份，必须原样保留
  await writeRootFile(page, base, 'sentinel');
  const outcome = await page.evaluate(() => writeAutoBackupToDir(getLocalDateStr()));
  expect(outcome).toBe('exists');
  expect(await readRootFile(page, base)).toBe('sentinel');
});

test('自动备份遇到权限 prompt：不申请权限，回退下载且只记节流', async ({ page }) => {
  await setup(page, { autoFreq: 'daily' });
  // 伪造一个「需要重新授权」的句柄：4 秒定时器没有用户手势，只能 query
  await page.evaluate(() => {
    backupDirHandle = {
      name: '需要授权',
      queryPermission: async () => 'prompt',
      requestPermission: async () => { window.__fs.requests++; return 'denied'; },
    };
  });
  const dl = await page.waitForEvent('download', { timeout: 12000 });
  expect(dl.suggestedFilename()).toMatch(/^wealth-data-\d{4}-\d{2}-\d{2}\.json$/);
  expect(await page.evaluate(() => window.__fs.requests)).toBe(0);
  await expect(page.locator('#toast-area')).toContainText('已开始下载，请在下载栏确认');
  const b = await readBackup(page);
  expect(b.lastBackup).toBe(null);
  expect(b.lastAutoDownload).toBe(today());
});

test('未选文件夹时自动备份回退下载，不弹保存框', async ({ page }) => {
  await setup(page, { autoFreq: 'daily' });
  await page.waitForEvent('download', { timeout: 12000 });
  expect(await page.evaluate(() => window.__fs.saveCalls.length)).toBe(0);
  expect(await page.evaluate(() => window.__fs.dirPicks)).toBe(0);
  const b = await readBackup(page);
  expect(b.lastBackup).toBe(null);
  expect(b.lastAutoDownload).toBe(today());
});
