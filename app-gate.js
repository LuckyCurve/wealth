/*
 * app-gate.js — 进资产页的门槛：长按抬闸 + 抄写放行 + 解锁冷却（全页唯一的入口）。
 * --------------------------------------------------------------------------
 * 送进资产页的模式切换全页只有 submitAssetGate 一处调用点；合成 click 只抬闸、不进门。
 *
 * 为什么从 app-core.js 拆出来：它在页面上是一块独立的门（有自己的弹窗、手势状态机、
 * 会话级的冷却时间戳），与 state 的初始化 / Tab 切换 / 汇率刷新没有关系，只是入口挂在页头。
 * 判定与词句仍在 logic.js（ui.MODE_PRESS_MS / entryPhrase / gateCooldownActive），
 * 这里只管信号、计时与弹窗收尾。
 *
 * 加载顺序：紧跟 app-core.js（switchMode 在运行时调这里）。
 */
// ========== 进入资产页的门槛：长按抬闸 + 抄写放行 ==========
// 两段闸：指针先按住「资产」满 ui.MODE_PRESS_MS，抬闸后抄一句随机箴言才进。这不是权限，
// 是给「看一眼」定价；价格不因设备而异：合成 click 不付长按（按住 Enter 会按键重复），但抄写同价。
let modePressStart = null;
let modePressRaf = 0;
let assetGatePhrase = ''; // 本次要抄的那一句：抬闸时抽定，抄错也**不换句**
let assetGateLang = '';   // 抄写用哪种语言取句：'' = 跟界面语言

// 解锁冷却：只记「最近一次抄对」的时刻，不记任何输入内容。放 sessionStorage ——
// 刷新页面仍有效，关标签/浏览器即失效；不进存档，也不会随导出/备份带走。
// 时间戳只在 submitAssetGate 校验通过后写，错句既不重置也不延长。
const GATE_STAMP_KEY = 'wealth-gate-unlocked-at';

function readGateStamp() {
  try { return Number(sessionStorage.getItem(GATE_STAMP_KEY)) || 0; } catch (e) { return 0; }
}

function gateCooling() {
  return ui.gateCooldownActive(readGateStamp(), Date.now(), state.gateCooldown);
}

function markGateUnlocked() {
  try { sessionStorage.setItem(GATE_STAMP_KEY, String(Date.now())); } catch (e) {}
}

function clearGateStamp() {
  try { sessionStorage.removeItem(GATE_STAMP_KEY); } catch (e) {}
}

// 唯一的放行点：抄对之后、或冷却窗口内，都从这里进资产页。
function enterAssets() {
  switchMode('assets');
}

// 冷却内直接进门：只省掉抄写这一步，长按那道闸照旧，背后数据的保护不变。
// 返回 true 表示已进门，调用方不必再开抄写框。
function tryEnterCooledAssets() {
  if (!assetsEntryOpen() || !gateCooling()) return false;
  enterAssets();
  return true;
}

// 已经在资产页时入口整体失效：再问一次「现在确实要看？」是荒谬的。
// 抽成函数是因为按下与进门两条路径都要这道闸，而它是「门的语义」而非权限校验
function assetsEntryOpen() {
  return currentMode !== 'assets';
}

function startModePress(e) {
  if (!assetsEntryOpen()) return;
  if (e && e.button !== 0) return; // 只认左键/触摸：右键是「想开菜单」，不是想进门
  cancelModePress(); // 上一次没收尾的按下（指针被系统夺走等）先清干净
  modePressStart = performance.now();
  const btn = document.getElementById('mode-assets');
  btn.classList.add('pressing');
  btn.style.setProperty('--mode-press', 0);
  modePressRaf = requestAnimationFrame(tickModePress);
}

function tickModePress() {
  if (modePressStart === null) return; // 已被收尾的残留帧（cancel 后仍排到的那一帧）
  const held = performance.now() - modePressStart;
  const btn = document.getElementById('mode-assets');
  btn.style.setProperty('--mode-press', ui.modePressProgress(held));
  if (ui.modePressDecision(held) !== 'enter') {
    modePressRaf = requestAnimationFrame(tickModePress);
    return;
  }
  // 满时长**直接抬闸**（不等松手）：跟着抬起的 pointerup/click 由 autoOpenGuard 守卫窗忽略
  // （旧决策躲的「手指落在遮罩上把弹窗点掉」已由守卫窗解决，不必再等松手）。
  modePressRaf = 0;
  modePressStart = null;
  btn.classList.remove('pressing');
  btn.style.removeProperty('--mode-press');
  __autoOpenedAt = performance.now();
  if (!tryEnterCooledAssets()) openAssetGate();
}

// 自动弹出后一小段时间内的指针事件全部忽略（抬起的手指紧跟一次 pointerup/click，
// 不忽略的话会把刚出现的确认框当场点掉）。窗口判据在 logic.js ui.autoOpenGuard。
let __autoOpenedAt = null;

// 松手收尾：短按只教一句（按满的情形已在 tick 里弹掉，不会走到这里）。
function endModePress(e) {
  if (modePressStart === null) return; // 没有进行中的按下（在页面别处松手），不响应
  if (e && e.button !== 0) return;     // 右键松开不该替左键的按住收尾
  // 自动弹出后紧跟的松手：守卫窗内一律忽略（不是用户的「第二次操作」）
  if (__autoOpenedAt !== null && !ui.autoOpenGuard(performance.now() - __autoOpenedAt)) return;
  const decision = ui.modePressDecision(performance.now() - modePressStart);
  resetModePress();
  if (decision === 'enter') { if (!tryEnterCooledAssets()) openAssetGate(); }
  else if (decision === 'hint') toast(ui.modePressHint(), 'info');
}

// click 的处置：键盘 Enter/Space、读屏器与程序化激活都不带指针按压过程，detail 为 0
//（浏览器就是这样标注「不是人手点出来的」，鼠标/触摸是 1，E2E 已验证）。它们**只抬闸、
// 不进门**：长按挡的是顺手一点，这条路一样要抄一句——曾经的「合成 click 直达」是廉价通道。
function modePressClick(e) {
  if (e.detail === 0 && !tryEnterCooledAssets()) openAssetGate();
}

// 指针移开/被系统夺走：放弃本次按下，既不提示也不进门
function cancelModePress() {
  if (modePressStart === null) return;
  resetModePress();
}

// 用 null（而非 0）标记「没有进行中的按下」：performance.now() 在小数上是合法值，
// 拿 0 当哨兵会让「页面刚打开就按下」那次被当成没按过（门的语义不该取决于时间原点）
function resetModePress() {
  if (modePressRaf) cancelAnimationFrame(modePressRaf);
  modePressRaf = 0;
  modePressStart = null;
  const btn = document.getElementById('mode-assets');
  btn.classList.remove('pressing');
  // 移除而不是置 0：置 0 会在元素上永远留一条内联样式（CSS 默认值本来就是 0）
  btn.style.removeProperty('--mode-press');
}

// 收尾挂在 document 上而非按钮上：在按钮外松手时 pointerup 不会落到按钮上，
// 挂在按钮上会漏收尾——墨线留在满格、下一次按下直接被误判成就绪
document.addEventListener('pointerup', endModePress);
document.addEventListener('pointercancel', cancelModePress);

// 抬闸：抽一句箴言、清空输入、打开抄写框。已在资产页时不弹（入口整体失效）。
function gatePhraseLang() {
  return assetGateLang || i18n.normalizeLang(state.lang);
}

// 抽句与换句只走这里：换语言等于换一句全新的，已抄的一半不能留着
function drawAssetGatePhrase() {
  const lang = gatePhraseLang();
  assetGatePhrase = ui.entryPhrase(lang);
  document.getElementById('asset-gate-phrase').textContent = assetGatePhrase;
  document.getElementById('asset-gate-input').value = '';
  setAssetGateError(false);
  // 换句入口是标题旁的图标：无可见文字，文案只进气泡与 aria-label
  const btn = document.getElementById('asset-gate-lang');
  if (btn) {
    const label = lang === 'zh' ? i18n.t('换英文') : i18n.t('换中文');
    btn.setAttribute('aria-label', label);
    const bubble = document.getElementById('asset-gate-lang-tip');
    if (bubble) bubble.textContent = label;
    // 展开的气泡挂在 body 下，不在 .tip 里，只认 __bubble；换文案改了宽度就重挂一次
    const tip = btn.closest('.tip');
    if (tip && tip.__bubble) placeTipBubble(tip);
  }
}

function toggleAssetGatePhraseLang() {
  assetGateLang = gatePhraseLang() === 'zh' ? 'en' : 'zh';
  state.gateLang = assetGateLang;
  saveState();
  drawAssetGatePhrase();
  document.getElementById('asset-gate-input').focus();
}

function openAssetGate() {
  if (!assetsEntryOpen()) return;
  assetGateLang = state.gateLang === 'zh' || state.gateLang === 'en' ? state.gateLang : '';
  drawAssetGatePhrase();
  openModal('asset-gate-modal');
}

function setAssetGateError(on) {
  document.getElementById('asset-gate-error').style.display = on ? '' : 'none';
}

// 输入框键位：Enter 提交（输入法组合中的 Enter 是「选词」，不提交）；不在输入时校验。
function assetGateKey(e) {
  if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submitAssetGate(); }
}

// 提交即判：抄对就进门（不再要第二次点击，那只会教人连点）；抄错原地重试——原句不换、输入清空。
function submitAssetGate() {
  if (__autoOpenedAt !== null && !ui.autoOpenGuard(performance.now() - __autoOpenedAt)) return;
  if (!assetsEntryOpen()) { cancelAssetGate(); return; }
  const input = document.getElementById('asset-gate-input');
  if (!ui.entryPhraseMatches(input.value, assetGatePhrase)) {
    input.value = '';
    setAssetGateError(true);
    input.focus();
    return;
  }
  cancelAssetGate();
  markGateUnlocked(); // 只有抄对才刷新冷却起点；错句在上一分支就返回了
  enterAssets();
}

// 放弃（Esc / 点遮罩 / 「不看」）：本次作废，下次从长按重新开始
function cancelAssetGate() {
  assetGatePhrase = '';
  setAssetGateError(false);
  closeModal('asset-gate-modal');
}

