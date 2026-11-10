const { test, expect, stubExternal, seed, waitReady, disableMotion, sampleState, INDEX_URL, readAppState } = require('./fixtures');
const assert = require('node:assert');
const L = require('../logic.js');
const { date } = L;

// 备份落点 E2E：自动与手动**统一**先弹确认框、再走系统文件窗口，窗口位置由设置里的目录决定。
// headless 里没有原生选择器，用 OPFS（navigator.storage.getDirectory）提供**真实可写句柄**，
// 于是目录写入、IDB 持久化、文件内容都跑真实 API；只有「窗口」本身是假对象，
// 所以能断言的是「传进去的 startIn 就是那个目录」，不能断言窗口在屏幕上真的开在那里。

const today = date.getLocalDateStr;

async function setup(page, opts = {}) {
  await disableMotion(page);
  await stubExternal(page);
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
      if (o && o.startIn === null) throw new TypeError('startIn is not a FileSystemHandle');
      // 位置一致性：startIn 必须就是设置里那个目录句柄本身（不是名字、不是新句柄）
      window.__fs.startInIsDir = !!o && !!o.startIn;
      window.__fs.startInSameHandle = !!o && !!o.startIn && o.startIn === window.__fs.dirHandle;
      if (window.__fs.cancelSave) throw new DOMException('user aborted', 'AbortError');
      if (window.__fs.failWithStartIn && o && o.startIn) throw new TypeError('bad startIn');
      if (window.__fs.pickerError) throw new DOMException('blocked', window.__fs.pickerError);
      const root = await navigator.storage.getDirectory();
      const fh = await root.getFileHandle(o.suggestedName, { create: true });
      return {
        createWritable: async () => {
          if (window.__fs.writeError) throw new DOMException('cannot write', window.__fs.writeError);
          return await fh.createWritable();
        },
      };
    };
    if (cfg.noFsa) { delete window.showDirectoryPicker; delete window.showSaveFilePicker; }
    if (cfg.noSubtle) Object.defineProperty(window.crypto, 'subtle', { value: undefined });
  }, opts);
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
  await expect(confirmBox(page)).toBeVisible();
  await page.locator('#confirm-modal').getByRole('button', { name: '取消' }).click();
  await expect(confirmBox(page)).toBeHidden();
  await expect(page.locator('#backup-dir-clear')).toBeVisible(); // 取消 = 句柄还在
  await page.click('#backup-dir-clear');
  await expect(confirmBox(page)).toBeVisible();
  await confirmOk(page);
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

async function setPassphrase(page, pass) {
  await page.evaluate(() => showSettings());
  await page.fill('#pass-input', pass);
  await page.click('#pass-save');
  await page.evaluate(() => closeModal('settings-modal'));
}

test('设了导出密钥：落盘的是密文信封，账本原文一个字都看不见', async ({ page }) => {
  await setup(page);
  await setPassphrase(page, 'correct horse battery');
  await page.evaluate(() => showSettings());
  await page.evaluate(() => closeModal('settings-modal'));

  await openExport(page);
  await expect(page.locator('#toast-area')).toContainText('数据已导出');
  const name = (await page.evaluate(() => window.__fs.saveCalls))[0];
  const text = await readRootFile(page, name);
  const env = JSON.parse(text);
  expect(env.format).toBe('wealth-backup-encrypted');
  expect(text).not.toContain('a-fund');
  expect(text).not.toContain('assets');

  const plain = JSON.parse(await L.vault.decryptBackup(env, 'correct horse battery'));
  expect(plain.assets.length).toBe(3);
  expect(plain.snapshots.every((s) => !('totalCNY' in s))).toBe(true);
  await assert.rejects(() => L.vault.decryptBackup(env, 'correct horse batterY'));
});

test('已设置密钥后输入框收起，只留更换与清除；点更换再展开', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => showSettings());
  await expect(page.locator('#pass-input')).toBeVisible();
  await expect(page.locator('#pass-change')).toBeHidden();
  await page.fill('#pass-input', 'correct horse battery');
  await page.click('#pass-save');
  await expect(page.locator('#pass-input')).toBeHidden();
  await expect(page.locator('#pass-save')).toBeHidden();
  await expect(page.locator('#pass-change')).toBeVisible();

  await page.click('#pass-change');
  await expect(page.locator('#pass-input')).toBeVisible();
  await expect(page.locator('#pass-input')).toHaveValue('');

  await page.evaluate(() => { closeModal('settings-modal'); showSettings(); });
  await expect(page.locator('#pass-input')).toBeHidden();
});

test('密钥不进备份文件，导入也改不动它', async ({ page }) => {
  await setup(page);
  await openExport(page);
  await expect(page.locator('#toast-area')).toContainText('数据已导出');
  const plainName = (await page.evaluate(() => window.__fs.saveCalls))[0];
  const plain = await readRootFile(page, plainName);
  expect(plain).not.toContain('wealth-manager-passphrase');
  expect(Object.keys(JSON.parse(plain))).not.toContain('passphrase');

  await setPassphrase(page, 'correct horse battery');
  await page.evaluate(() => document.getElementById('toast-area').textContent = '');
  await openExport(page);
  await expect(page.locator('#toast-area')).toContainText('数据已导出');
  const calls = await page.evaluate(() => window.__fs.saveCalls);
  const cipher = await readRootFile(page, calls[1]);
  expect(cipher).not.toContain('correct horse battery');
  const inner = JSON.parse(await L.vault.decryptBackup(JSON.parse(cipher), 'correct horse battery'));
  expect(JSON.stringify(inner)).not.toContain('correct horse battery');

  const hostile = { categories: [], assets: [], snapshots: [], expenseCategories: [], expenses: [], passphrase: 'evil key' };
  await page.evaluate(() => showImportExport());
  await page.setInputFiles('#import-file', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(hostile)) });
  await confirmOk(page);
  expect(await page.evaluate(() => exportPassphrase())).toBe('correct horse battery');
  expect(await page.evaluate(() => localStorage.getItem('wealth-manager-passphrase'))).toBe('correct horse battery');
});

test('自动备份也加密：密钥设了就不存明文（自动与手动同一份内容）', async ({ page }) => {
  await setup(page, { autoFreq: 'daily', clock: true });
  await setPassphrase(page, 'correct horse battery');
  const base = `wealth-data-${today()}.json`;

  await page.clock.runFor(4200);
  await confirmOk(page);
  await expect(page.locator('#toast-area')).toContainText('已自动备份');
  await expect.poll(async () => (await listRoot(page)).includes(base), { timeout: 5000 }).toBe(true);
  const env = JSON.parse(await readRootFile(page, base));
  expect(env.format).toBe('wealth-backup-encrypted');
  expect(await readBackup(page)).toEqual({ autoFreq: 'daily', lastBackup: today() });
});

test('导入加密备份：先要密钥；错了不动数据、框不关；对了才进覆盖确认', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => showImportExport());
  const payload = {
    categories: [{ id: 'currency', name: '货币类型', builtin: true, tags: ['CNY'] }],
    assets: [], snapshots: [], expenseCategories: [], expenses: [],
  };
  const envelope = await L.vault.encryptBackup(JSON.stringify(payload), 'correct horse battery');
  const file = { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(envelope) };

  await page.setInputFiles('#import-file', file);
  await expect(page.locator('#pass-modal')).toBeVisible();
  await expect(page.locator('#confirm-modal')).toBeHidden();

  await page.fill('#pass-modal-input', 'wrong passphrase');
  await page.click('#pass-modal-ok');
  await expect(page.locator('#toast-area')).toContainText('密钥不对，或文件已损坏');
  await expect(page.locator('#pass-modal')).toBeVisible();
  await expect(page.locator('#pass-modal-input')).toHaveValue('');
  expect((await readAppState(page)).assets).toHaveLength(3);

  await page.fill('#pass-modal-input', 'correct horse battery');
  await page.click('#pass-modal-ok');
  await expect(page.locator('#pass-modal')).toBeHidden();
  await confirmOk(page);
  await expect(page.locator('#toast-area')).toContainText('数据已导入');
  await expect(page.locator('#io-modal')).toBeHidden();
  const after = await readAppState(page);
  expect(after.assets).toHaveLength(0);
  expect(after.categories.map((c) => c.id)).toEqual(['currency']);
});

test('写不进去时说清是文件被占，而不是笼统的「导出失败」', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { window.__fs.writeError = 'NoModificationAllowedError'; });
  await openExport(page);
  await expect(page.locator('#toast-area')).toContainText('这个文件现在写不进去（可能正被其他程序打开），换个位置再试');
  expect((await readBackup(page)).lastBackup).toBe(null);
});

test('位置不可写时提示换文件夹（权限类错误各管各的）', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { window.__fs.writeError = 'NotAllowedError'; });
  await openExport(page);
  await expect(page.locator('#toast-area')).toContainText('浏览器不允许写入这个位置，换一个文件夹再试');
});

test('保存窗口打不开时提示换个浏览器或清掉备份文件夹', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { window.__fs.pickerError = 'SecurityError'; });
  await openExport(page);
  await expect(page.locator('#toast-area')).toContainText('浏览器没允许打开保存窗口');
});

test('起点目录句柄失效（Chrome 只报 TypeError）：去掉 startIn 重开一次，导出照成', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => showSettings());
  await page.click('#backup-dir-choose');
  await page.evaluate(() => closeModal('settings-modal'));
  await page.evaluate(() => { window.__fs.failWithStartIn = true; });
  await openExport(page);
  await expect(page.locator('#toast-area')).toContainText('数据已导出');
  expect(await page.evaluate(() => window.__fs.saveCalls.length)).toBe(2);
});

test('设了密钥却没有 WebCrypto：拒绝导出（绝不默默写明文）', async ({ page }) => {
  await setup(page, { noSubtle: true });
  await page.evaluate(() => localStorage.setItem('wealth-manager-passphrase', 'correct horse battery'));
  await openExport(page);
  await expect(page.locator('#toast-area')).toContainText('这个页面不是安全环境（https 或 localhost），不能加密');
  expect(await readRootFile(page, `wealth-data-${today()}.json`)).toBe('');
});

test('自动备份写失败：说出原因，且不记「已备份」（当天再进还会再问）', async ({ page }) => {
  await setup(page, { autoFreq: 'daily', clock: true });
  await page.clock.runFor(4200);
  await page.evaluate(() => { window.__fs.writeError = 'QuotaExceededError'; });
  await confirmOk(page);
  await expect(page.locator('#toast-area')).toContainText('磁盘没有空间了，无法写入');
  expect((await readBackup(page)).lastBackup).toBe(null);
});

test('加密文件解开了却不是账本：报格式错，不动当前数据（别人的密钥能造出任何信封）', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => showImportExport());
  const envelope = await L.vault.encryptBackup('not a ledger at all', 'any key');
  await page.setInputFiles('#import-file', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from(envelope) });
  await page.fill('#pass-modal-input', 'any key');
  await page.click('#pass-modal-ok');
  await expect(page.locator('#toast-area')).toContainText('解开了，但里面不是账本 JSON');
  await expect(page.locator('#confirm-modal')).toBeHidden();
  expect((await readAppState(page)).assets).toHaveLength(3);
});

test('导入加密备份取密钥，但不动设置里的导出密钥（导入别人的备份不得换掉你的密钥）', async ({ page }) => {
  await setup(page);
  await setPassphrase(page, 'my own passphrase');
  const before = await page.evaluate(() => exportPassphrase());
  await page.evaluate(() => showImportExport());
  const envelope = await L.vault.encryptBackup(
    JSON.stringify({ categories: [], assets: [], snapshots: [], expenseCategories: [], expenses: [] }), 'someone else key');
  await page.setInputFiles('#import-file', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(envelope) });
  await page.fill('#pass-modal-input', 'someone else key');
  await page.click('#pass-modal-ok');
  await confirmOk(page);
  expect(await page.evaluate(() => exportPassphrase())).toBe(before);
});
