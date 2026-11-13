// ========== DRAG REORDER ==========
let dragSrcId = null;

function onAssetDragStart(e) {
  const row = e.target.closest('.asset-row');
  dragSrcId = row?.dataset.id;
  if (!dragSrcId) return;
  row.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragSrcId);
}

function onAssetDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const row = e.target.closest('.asset-row');
  if (!row || !row.dataset.id || row.dataset.id === dragSrcId) return;
  document.querySelectorAll('#assets-rows .asset-row.drag-over').forEach(r => r.classList.remove('drag-over'));
  row.classList.add('drag-over');
}

function onAssetDragEnd(e) {
  document.querySelectorAll('#assets-rows .asset-row').forEach(r => r.classList.remove('dragging', 'drag-over'));
  dragSrcId = null;
}

function onAssetDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  const targetRow = e.target.closest('.asset-row');
  if (!targetRow || !dragSrcId || !targetRow.dataset.id || targetRow.dataset.id === dragSrcId) return;
  const srcIdx = state.assets.findIndex(a => a.id === dragSrcId);
  const tgtIdx = state.assets.findIndex(a => a.id === targetRow.dataset.id);
  if (srcIdx === -1 || tgtIdx === -1) return;
  const [moved] = state.assets.splice(srcIdx, 1);
  state.assets.splice(tgtIdx, 0, moved);
  sortBy = '';
  sortDir = 'asc';
  saveState();
  renderAssets();
}

// 键盘移动资产顺序：拖拽 drop 的键盘等价物。数组操作走 logic.js ui.moveAssetIndex（可单测），
// 收尾（清排序状态 → 落盘 → 重绘）与 onAssetDrop 完全同一套——两处各写一份必然漂移。
function moveAsset(id, dir) {
  const idx = state.assets.findIndex(a => a.id === id);
  if (idx === -1) return;
  const to = idx + dir;
  const next = ui.moveAssetIndex(state.assets, idx, to);
  if (next === state.assets) return; // 越界（已到顶/底）：不动
  state.assets = next;
  sortBy = '';
  sortDir = 'asc';
  saveState();
  renderAssets();
  const fresh = document.querySelector('#assets-rows .asset-row[data-id="' + CSS.escape(id) + '"] .drag-handle');
  if (fresh) fresh.focus();
}

// ========== SORT ==========
function toggleSort(field) {
  const r = ui.nextSortState(sortBy, sortDir, field, false);
  sortBy = r.by;
  sortDir = r.dir;
  renderAssets();
}

// ========== LANGUAGE (界面语言，唯一入口：设置弹窗「语言」) ==========
// 两条通道（data-i18n / i18n.t），键即中文原文，漏译回落中文——覆盖率由 ui-wiring 逐条把守。
const I18N_ATTRS = ['aria-label', 'placeholder', 'title', 'content'];

function applyI18nDom() {
  document.documentElement.lang = i18n.langTag(state.lang);
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const next = i18n.t(el.getAttribute('data-i18n'));
    if (el.textContent !== next) el.textContent = next;
  });
  I18N_ATTRS.forEach(attr => {
    document.querySelectorAll('[data-i18n-' + attr + ']').forEach(el => {
      el.setAttribute(attr, i18n.t(el.getAttribute('data-i18n-' + attr)));
    });
  });
  // 展开了的气泡换了文案就换了宽度，位置按新宽度重算（它挂在 body 下，不在 .tip 里）
  document.querySelectorAll('.tip').forEach(tip => {
    if (tip.__bubble) placeTipBubble(tip);
  });
}

function syncLangSeg() {
  const lang = i18n.normalizeLang(state.lang);
  ['en', 'zh'].forEach(l => {
    const btn = document.getElementById('lang-seg-' + l);
    if (!btn) return;
    btn.classList.toggle('active', l === lang);
    btn.setAttribute('aria-pressed', String(l === lang));
  });
}

function syncFlatpickrLocale() {
  const el = document.getElementById('expense-date');
  const fp = el && el._flatpickr;
  if (!fp || typeof flatpickr === 'undefined') return;
  fp.set('locale', i18n.flatpickrLocale(flatpickr.l10ns, state.lang));
}

// 语言切换与主题同一套「先落盘、后重绘」路径。
// 用户数据（分类名/标签/备注）不翻译：它们不是界面文案，换语言不该改写账本内容。
function setLang(lang) {
  const next = i18n.normalizeLang(lang);
  if (next === i18n.normalizeLang(state.lang)) return;
  state.lang = next;
  saveState();
  applyI18nDom();
  syncLangSeg();
  syncFlatpickrLocale();
  renderAll(); // 收尾 syncDerivedReads 把可见图表也按新语言重绘一次
  if (typeof renderYieldModal === 'function') renderYieldModal();
}

// ========== THEME (日间/夜间，入口唯一：设置弹窗「外观」) ==========
// 落 DOM class + localStorage，随后重绘 pill 与可见图表；目标与当前一致时不动、不重绘。
function syncThemeSeg() {
  const lightBtn = document.getElementById('theme-seg-light');
  if (!lightBtn) return;
  const dark = document.documentElement.classList.contains('dark');
  lightBtn.classList.toggle('active', !dark);
  lightBtn.setAttribute('aria-pressed', String(!dark));
  const darkBtn = document.getElementById('theme-seg-dark');
  darkBtn.classList.toggle('active', dark);
  darkBtn.setAttribute('aria-pressed', String(dark));
}

// 状态栏/地址栏颜色跟随**应用主题**（media 版本会在「系统亮、页面暗」时反色）。取 --bg 不另写色值。
function applyThemeChrome() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (bg) meta.content = bg;
}

function setTheme(dark) {
  dark = !!dark;
  if (dark === document.documentElement.classList.contains('dark')) return;
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem('dark-mode', dark ? '1' : '');
  applyThemeChrome(); // 状态栏跟纸色，不留一块上白下褐
  syncThemeSeg(); // 回显 seg 状态
  renderAll(); // 收尾 syncDerivedReads 把可见图表也按新主题重绘（canvas 不认 CSS 变量）
}

// ========== 解锁冷却（资产页抄写闸的免抄窗口）==========
// 设置只改时长。时间戳只在抄对时写（app-core.js），这里负责回显与「立即锁定」。
function setGateCooldown(v) {
  state.gateCooldown = ui.normalizeGateCooldown(v);
  saveState();
  if (state.gateCooldown === 0) clearGateStamp(); // 关掉即结束本次冷却
  syncGateCooldownControls();
  toast(
    state.gateCooldown === 0
      ? i18n.t('已关闭解锁冷却')
      : i18n.t('解锁冷却：{p1} 分钟', { p1: state.gateCooldown }),
    'success'
  );
}

function syncGateCooldownControls() {
  const v = ui.normalizeGateCooldown(state.gateCooldown);
  ui.GATE_COOLDOWN_MINUTES.forEach((m) => {
    const btn = document.getElementById('gate-cool-' + (m === 0 ? 'off' : m));
    if (!btn) return;
    btn.classList.toggle('active', m === v);
    btn.setAttribute('aria-pressed', String(m === v));
  });
}

function lockAssetsNow() {
  clearGateStamp();
  toast(i18n.t('已立即锁定'), 'success');
}

function showSettings() {
  passEditing = false; // 每次打开都回到「已设置」那一态
  syncThemeSeg();
  syncLangSeg();
  syncGateCooldownControls();
  syncBackupControls();
  syncSnapshotReminderControls();
  syncExpenseGapDays();
  openModal('settings-modal');
}

function refreshVisibleCharts() {
  if (document.getElementById('tab-chart').style.display !== 'none') renderChart();
  if (document.getElementById('tab-history').style.display !== 'none') renderHistoryChart();
  if (document.getElementById('tab-income').style.display !== 'none') renderIncomeTab();
  if (document.getElementById('tab-expense-chart').style.display !== 'none') renderExpenseChart();
  if (document.getElementById('tab-expense-trend').style.display !== 'none') renderExpenseTrendChart();
}

// ===== 派生读数的唯一刷新口 =====
// 账本一变，报头/压测条与印徽/可见图表都在这里重算；新增派生读数就挂这里，数值一律现算（调用方不传数）。
let _renderBatch = 0; // 批量重绘期间先攒着（两侧列表各收一次会把同一张图画两遍）
function syncDerivedReads() {
  if (_renderBatch) return;
  renderMasthead();
  renderStressChrome();
  refreshVisibleCharts();
}

// ========== IMPORT/EXPORT ==========
function showImportExport() {
  syncBackupControls(); // 打开弹窗时同步「上次备份」与频率选择
  openModal('io-modal');
}

// ========== BACKUP (确认框 + 文件窗口 + 新鲜度提醒) ==========
// 必须先弹确认框（自动备份没有用户手势，目录授权跨会话也不可靠）；决策在 logic.js，这里只做 DOM 副作用。

// 目录句柄不能进 state（不可 JSON 序列化，也不该随导出走）：只存 IndexedDB。
// 全部读写容错——隐私模式 / IDB 不可用时退化为「仅本次会话可用」，不阻塞首屏。
const BACKUP_DB = 'wealth-backup';
const BACKUP_STORE = 'handles';
const BACKUP_DIR_KEY = 'backupDir';
let backupDirHandle = null;
let backupDirReady = Promise.resolve();
let backupDirTouched = false; // 用户已主动选择/清除：启动恢复不得覆盖新值
let dirPickInFlight = false;
let backupInFlight = false; // 一次落盘从「弹窗口」到「写完」全程占位：防同一份被并行写两次

function openBackupDB() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('no-idb'));
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BACKUP_DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(BACKUP_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('idb-blocked'));
  });
}

// 目录句柄读写的唯一事务入口：成功以 tx.oncomplete 为准（单条请求的回执不代表已提交）
async function idbBackupStore(mode, run) {
  const db = await openBackupDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(BACKUP_STORE, mode);
      const req = run(tx.objectStore(BACKUP_STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

async function idbGetBackupDir() {
  const rec = await idbBackupStore('readonly', store => store.get(BACKUP_DIR_KEY));
  const h = rec && rec.handle;
  return h && typeof h.getFileHandle === 'function' ? h : null;
}

async function idbSetBackupDir(handle) {
  await idbBackupStore('readwrite', store => store.put({ handle }, BACKUP_DIR_KEY));
}

async function idbClearBackupDir() {
  await idbBackupStore('readwrite', store => store.delete(BACKUP_DIR_KEY));
}

// 启动恢复：失败/为空都按「未选择」处理；用户已在本次会话操作过则不回滚
async function restoreBackupDir() {
  try {
    const h = await idbGetBackupDir();
    if (h && !backupDirTouched) backupDirHandle = h;
  } catch (e) { /* IndexedDB 不可用：本次会话没有持久句柄 */ }
  syncBackupControls();
}

// 只认 Chromium 系的 File System Access API：没有它就没有「指定起点目录的文件窗口」，
// 落点只能回退成浏览器下载（backup.backupWritePlan 会据此判定）
function canPickBackupDir() { return typeof window.showDirectoryPicker === 'function'; }
function canSaveBackupFile() { return typeof window.showSaveFilePicker === 'function'; }

// ===== 设置入口（onclick 只挂同步包装；异步实现单独命名）=====
function chooseBackupDir() { chooseBackupDirAsync(); }

async function chooseBackupDirAsync() {
  if (!canPickBackupDir()) {
    toast(i18n.t('当前浏览器不支持选择文件夹，备份将下载到「下载」文件夹'), 'info');
    return;
  }
  if (dirPickInFlight) return;
  dirPickInFlight = true;
  try {
    // 第一个 await 之前先弹选择器：拖到别的 await 之后会丢失用户手势。
    // mode 只要 read：这个句柄只用来给文件窗口指定起点（startIn），不再往目录里直接写文件，
    // 所以不必再申请写权限——那正是「每次重开都要重新授权」的来源。
    const handle = await window.showDirectoryPicker({ mode: 'read' });
    backupDirTouched = true;
    backupDirHandle = handle;
    try { await idbSetBackupDir(handle); } catch (e) { /* 本次会话仍可用，刷新后需重选 */ }
    syncBackupControls();
    toast(i18n.t('已选择备份文件夹「{p1}」', { p1: handle.name || i18n.t('备份文件夹') }), 'success');
  } catch (e) {
    if (e && e.name === 'AbortError') return; // 用户取消，不打扰
    toast(i18n.t('选择文件夹失败'), 'error');
  } finally { dirPickInFlight = false; }
}

// 只忘句柄与持久化记录，不删除任何文件
function clearBackupDir() {
  showConfirm(i18n.t('确认清除备份文件夹？'), () => clearBackupDirAsync());
}

async function clearBackupDirAsync() {
  backupDirTouched = true;
  backupDirHandle = null;
  try { await idbClearBackupDir(); } catch (e) { /* IDB 不可用：内存已清 */ }
  syncBackupControls();
  toast(i18n.t('已清除备份文件夹'), 'success');
}

const PASS_KEY = 'wealth-manager-passphrase';
let passEditing = false;

function exportPassphrase() {
  try { return localStorage.getItem(PASS_KEY) || ''; } catch (e) { return ''; }
}

async function backupFileText() {
  const text = backup.backupJSONText(state);
  const pass = exportPassphrase();
  return pass ? await vault.encryptBackup(text, pass) : text;
}

function saveExportPassphrase() {
  const input = document.getElementById('pass-input');
  const pass = input.value;
  if (vault.passphraseTooShort(pass)) {
    toast(i18n.t('密钥至少 {p1} 位', { p1: vault.BACKUP_PASSPHRASE_MIN }), 'error');
    return;
  }
  try { localStorage.setItem(PASS_KEY, pass); } catch (e) {
    toast(i18n.t('保存失败：浏览器不允许本地存储'), 'error');
    return;
  }
  input.value = '';
  passEditing = false;
  syncBackupControls();
  toast(i18n.t('已设置导出密钥，之后的导出都会加密'), 'success');
}

function startPassEdit() {
  passEditing = true;
  syncBackupControls();
  document.getElementById('pass-input').focus();
}

function clearExportPassphrase() {
  showConfirm(i18n.t('确认清除导出密钥？清除后导出的是明文文件；已加密的备份仍要原密钥才能打开。'), () => {
    try { localStorage.removeItem(PASS_KEY); } catch (e) {}
    passEditing = false;
    syncBackupControls();
    toast(i18n.t('已清除导出密钥'), 'success');
  });
}

// ===== 落盘 =====
// 唯一落盘入口：调用前不得有 await（手势会被消耗掉）；close() 成功才算写完；取消返回 'cancelled'，不记任何状态。
async function saveBackupToFile(today, mode) {
  if (backupInFlight) return 'cancelled';
  backupInFlight = true;
  let notice;
  let stage = 'picker';
  try {
    const opts = {
      suggestedName: backup.backupFileName(today),
      types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
    };
    if (backupDirHandle) opts.startIn = backupDirHandle;
    let handle;
    try {
      handle = await window.showSaveFilePicker(opts);
    } catch (e) {
      if (!(e && e.name === 'TypeError' && opts.startIn)) throw e;
      delete opts.startIn;
      handle = await window.showSaveFilePicker(opts);
    }
    stage = 'encrypt';
    const text = await backupFileText();
    stage = 'write';
    await writeFileHandleText(handle, text);
    notice = backup.backupResultNotice({ mode, target: 'file', status: 'written' });
  } catch (e) {
    console.error('[backup] export failed at ' + stage, e);
    const cancelled = e && e.name === 'AbortError';
    notice = cancelled
      ? backup.backupResultNotice({ mode, target: 'file', status: 'cancelled' })
      : backup.exportErrorNotice(e, stage);
  } finally { backupInFlight = false; }
  applyBackupResult(notice, today);
}

// close() 成功才算写入完成；中途失败不会提交半截文件
async function writeFileHandleText(fh, text) {
  if (!fh || typeof fh.createWritable !== 'function') {
    e.name = 'bad-handle';
    throw e;
  }
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}

// 触发一次浏览器下载（无回执，不能据此记「已备份」）
async function downloadBackupJSON() {
  const blob = new Blob([await backupFileText()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backup.backupFileName(date.getLocalDateStr());
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function markBackedUp(today) {
  state.backup.lastBackup = today;
}

// 所有备份路径的唯一收尾点：按结果决定记不记成功，再统一刷新控件与便条。
// 只有「确认写入」才记 lastBackup；取消 / 失败 / 回退下载一律不记，
// 于是当天再进来还会再问一次（旧实现用 lastAutoDownload 节流，取消后当天就「没了」）
function applyBackupResult(notice, today) {
  if (notice.recordBackup) markBackedUp(today);
  if (notice.recordBackup) { try { saveState(); } catch (e) {} }
  syncBackupControls();
  toast(notice.msg, notice.type);
}

// 方案 A 入口：判定在 backup.shouldAutoBackup，这里延迟数秒执行，并先 await 本轮的汇率请求。
// 确认回调里不得有 await 就调 saveBackupToFile（手势）；快照提醒挂在备份收尾（取消回调 / 写入 finally）之后。
async function maybeAutoBackup(ratePromise) {
  const settle = () => maybeSnapshotReminder();
  if (!backup.shouldAutoBackup(state, date.getLocalDateStr())) {
    setTimeout(settle, 1500); // 没有备份要弹时自己走，延后一点避开首屏入场
    return;
  }
  setTimeout(async () => {
    try {
      if (ratePromise) await ratePromise;
    } catch (e) { /* 汇率拉取失败也无妨，用缓存汇率继续备份 */ }
    try {
      await backupDirReady; // 目录句柄从 IDB 恢复完成后再弹框（确认文案要写目录名）
      const t = date.getLocalDateStr();
      const prompt = backup.backupPromptText('auto', backup.backupFileName(t), backupDirHandle && backupDirHandle.name);
      showConfirm(prompt.msg, () => {
        const plan = backup.backupWritePlan({ supportsPicker: canSaveBackupFile() });
        const written = plan.target === 'file' ? saveBackupToFile(t, 'auto') : exportViaDownload(t);
        Promise.resolve(written).finally(settle);
      }, prompt.title, { okLabel: i18n.t('备份'), tone: 'gold', onCancel: settle });
    } catch (e) { /* 忽略 */ }
  }, 4000);
}

// ========== 月度快照提醒（DOM 副作用）==========
// 决策全在 logic.js snapshot.shouldRemindSnapshot；这里只写 DOM、记「今天问过」。
// 提醒只是通知：不跳转、不过闸、不带入口按钮——门槛（DECISIONS.md）保护的是「看数字」，
// 提醒不替用户省这笔钱；文案又只报月份、不报金额（不变成一条旁路读数）。
function maybeSnapshotReminder() {
  const today = date.getLocalDateStr();
  if (!snapshot.shouldRemindSnapshot(state, today)) return;
  // 用户正在干别的事（已经开了一层弹窗）就不抢：提醒只是知会，不值得把人家手里的表单顶下去。
  // 没弹就不记 lastPrompted，窗口内下次启动再试。
  if (topModal()) return;
  const text = snapshot.snapshotReminderText(state);
  document.getElementById('snapshot-reminder-msg').textContent = text.msg;
  // 弹出那一刻就记「今天问过」：只有一个按钮，看不看用户的选择都已计价。
  state.snapshotReminderLastPrompted = today;
  saveState();
  openModal('snapshot-reminder-modal');
}

function closeSnapshotReminder() {
  closeModal('snapshot-reminder-modal');
}

function checkBackupStale() {
  const staleDays = backup.backupStaleDays(state, date.getLocalDateStr());
  if (staleDays != null) {
    setTimeout(() => toast(i18n.t('距上次备份已 {p1} 天，记得导出一份', { p1: staleDays }), 'error'), 1500);
  }
}

function syncBackupControls() {
  const freq = backup.normalizeBackupFreq(state.backup.autoFreq);       // 白名单归一，单一来源
  const passSet = !!exportPassphrase();
  const noteText = backup.backupNoteText(state.backup.lastBackup, date.getLocalDateStr()); // 文案纯函数在 logic.js
  const lastEl = document.getElementById('backup-last-text');
  if (lastEl) lastEl.textContent = noteText + ' · ' + vault.backupModeText(passSet);
  ['daily', 'weekly', 'off'].forEach(v => {
    const btn = document.getElementById('backup-freq-' + v);
    if (!btn) return;
    btn.classList.toggle('active', v === freq);
    btn.setAttribute('aria-pressed', String(v === freq));
  });
  const noteEl = document.getElementById('settings-backup-note');
  if (noteEl) noteEl.textContent = noteText;
  const dirNote = document.getElementById('settings-backup-dir-note');
  if (dirNote) {
    dirNote.textContent = backup.backupDirNoteText(!!backupDirHandle, backupDirHandle && backupDirHandle.name, canPickBackupDir());
  }
  const clearBtn = document.getElementById('backup-dir-clear');
  if (clearBtn) clearBtn.hidden = !backupDirHandle;
  const editing = !passSet || passEditing;
  const passInput = document.getElementById('pass-input');
  const passSave = document.getElementById('pass-save');
  const passChange = document.getElementById('pass-change');
  const passClear = document.getElementById('pass-clear');
  if (passInput) passInput.hidden = !editing;
  if (passSave) passSave.hidden = !editing;
  if (passChange) passChange.hidden = editing;
  if (passClear) passClear.hidden = !passSet;
}

function setBackupFreq(v) {
  state.backup.autoFreq = backup.normalizeBackupFreq(v); // 白名单归一与 migrate.migrateState 同源（logic.js）
  saveState();
  syncBackupControls(); // 两处弹窗控件同源刷新
  toast(state.backup.autoFreq === 'off' ? i18n.t('已关闭自动备份') : i18n.t('自动备份：{p1}', { p1: i18n.t(state.backup.autoFreq === 'daily' ? '每天' : '每周') }), 'success');
}

function setSnapshotReminder(patch) {
  state.snapshotReminder = snapshot.normalizeSnapshotReminder(Object.assign({}, state.snapshotReminder, patch));
  saveState();
  syncSnapshotReminderControls(); // 归一后回写到输入框（0 / 99 / 空 都落到 1~28）
}
function setSnapshotReminderWindow(v) { setSnapshotReminder({ window: v }); }
function setSnapshotReminderDays(v) { setSnapshotReminder({ days: v }); }

// 回显：seg 的 aria-pressed 与天数输入框同一来源，不各读一遍 state
function setExpenseGapDays(v) {
  state.expenseGapDays = expense.normalizeGapDays(v);
  saveState();
  syncExpenseGapDays();
  renderExpenses();
}

function syncExpenseGapDays() {
  const el = document.getElementById('expense-gap-days');
  if (el) el.value = String(expense.normalizeGapDays(state.expenseGapDays));
}

function syncSnapshotReminderControls() {
  const r = snapshot.normalizeSnapshotReminder(state.snapshotReminder);
  ['off', 'start', 'end'].forEach(v => {
    const btn = document.getElementById('snap-remind-' + v);
    if (!btn) return;
    btn.classList.toggle('active', v === r.window);
    btn.setAttribute('aria-pressed', String(v === r.window));
  });
  const days = document.getElementById('snapshot-reminder-days');
  if (days) days.value = String(r.days);
}

function exportData() {
  syncBackupControls(); // 两处「上次备份」显示同源刷新（既有契约）
  exportDataAsync();
}

// 手动导出：点按钮本身就是确认，直接进文件窗口（不再多一层确认框）
async function exportDataAsync() {
  const today = date.getLocalDateStr();
  const plan = backup.backupWritePlan({ supportsPicker: canSaveBackupFile() });
  if (plan.target !== 'file') {
    exportViaDownload(today);
    return;
  }
  await saveBackupToFile(today, 'manual');
}

// 不支持文件窗口时的兜底：<a download> 无回执，只提示「已开始下载」，不记「已备份」
async function exportViaDownload(today) {
  let notice;
  try {
    await downloadBackupJSON();
    notice = backup.backupResultNotice({ mode: 'manual', target: 'download', status: 'downloaded' });
  } catch (e) {
    console.error('[backup] download did not start', e);
    notice = backup.exportErrorNotice(e, 'write');
  }
  applyBackupResult(notice, today);
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = ''; // 重置，允许再次选择同一文件导入
  document.getElementById('import-file-name').textContent = file.name;
  const reader = new FileReader();
  reader.onload = function(ev) {
    let data;
    try {
      data = JSON.parse(ev.target.result);
    } catch(err) {
      toast(i18n.t('解析文件失败'), 'error');
      return;
    }
    if (vault.isEncryptedBackup(data)) { askImportPassphrase(data); return; }
    confirmImport(data);
  };
  reader.readAsText(file);
}

function confirmImport(data) {
  if (data && Array.isArray(data.categories) && Array.isArray(data.assets)) {
    showConfirm(i18n.t('导入将覆盖当前所有数据，确认继续？'), () => {
      state = { ...state, ...data };
      migrate.migrateState();
      saveState();
      renderAll();
      if (typeof renderYieldModal === 'function') { yieldResetView(); renderYieldModal(); }
      closeModal('io-modal');
      toast(i18n.t('数据已导入'), 'success');
    }, null, { onCancel: () => { document.getElementById('import-file-name').textContent = ''; } });
  } else {
    toast(i18n.t('文件格式不正确'), 'error');
  }
}

let pendingImportEnv = null;
function askImportPassphrase(env) {
  pendingImportEnv = env;
  const input = document.getElementById('pass-modal-input');
  input.value = '';
  openModal('pass-modal');
  input.focus();
}

function cancelPassImport() {
  pendingImportEnv = null;
  document.getElementById('import-file-name').textContent = '';
  closeModal('pass-modal');
}

function passModalKey(e) {
  if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submitPassImport(); }
}

function submitPassImport() { submitPassImportAsync(); }

async function submitPassImportAsync() {
  const env = pendingImportEnv;
  if (!env) return;
  const input = document.getElementById('pass-modal-input');
  let text;
  try {
    text = await vault.decryptBackup(env, input.value);
  } catch (err) {
    input.value = '';
    input.focus();
    toast(i18n.t('密钥不对，或文件已损坏'), 'error');
    return;
  }
  pendingImportEnv = null;
  closeModal('pass-modal');
  let data;
  try { data = JSON.parse(text); } catch (err) {
    toast(i18n.t('解开了，但里面不是账本 JSON'), 'error');
    return;
  }
  confirmImport(data);
}

