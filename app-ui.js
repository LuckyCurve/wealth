/*
 * app-ui.js — 全站 UI 基元：悬停气泡、弹窗开关、二次确认、Tab 焦点陷阱、便条、颜色取值、
 * 金额输入格式化、id 生成。
 * --------------------------------------------------------------------------
 * 这些是所有页面脚本共用的「砖」：谁都要弹窗、谁都要一条便条、谁都可能取一次分类色。
 * 它们此前压在 app-settings.js 尾部（因为设置在早期是唯一的弹窗），可设置在功能上只占一块，
 * 于是这个文件既是「设置面板」又是「通用件仓库」，两边一起长。拆开后各自按自己的理由长。
 *
 * 判据仍留在 logic.js（焦点陷阱的下标、便条播报档位、气泡定位），这里只负责把结论落到 DOM。
 * 加载顺序：紧跟 app-settings.js（两边只在运行时互相调用；本文件在加载期只挂事件监听）。
 */
// ========== UI 基元（气泡 / 弹窗 / 确认框 / 焦点陷阱 / 便条）==========
/* 悬停气泡的定位：把气泡钉在 ? 图标下方（视口坐标）。
   为什么需要 JS：气泡是 position: fixed（脱离祖先的层叠上下文与 overflow 裁剪，见 CSS 注释），
   于是它不再跟着图标走——位置只能每次显示时按当前滚动/布局算一次。
   纯算术在 logic.js ui.tipBubblePos（可单测），这里只负责量尺寸与写两个 CSS 变量。
   九个 tip 共用这一套（气泡是单一实现，不再逐个写定位）。 */
function placeTipBubble(tip) {
  if (!tip) return;
  // 已展开的气泡挂在 body 下（见下），不再是 .tip 的子孙；这时只能从 __bubble 取回。
  // 换语言 / 换句都会改文案宽度，重挂位置靠的正是这一条。
  const bubble = tip.__bubble || tip.querySelector('.tip-bubble');
  const mark = tip.querySelector('.tip-mark');
  if (!bubble || !mark) return;
  // **先搬家再量**：`fixed` 的包含块不是视口本身——祖先若带 backdrop-filter（卡片就有），
  // 它就成了包含块，坐标会相对那张卡片算（实测 left:725 渲染到 814，正好差一个内边距）。
  // 搬到 body 下才真正相对视口；隐藏时再搬回去，`.tip:hover .tip-bubble` 这条选择器
  // 才不会失效（那条只认结构上的子孙关系）。
  if (bubble.parentElement !== document.body) document.body.appendChild(bubble);
  bubble.classList.add('placed');
  const a = mark.getBoundingClientRect();
  const b = bubble.getBoundingClientRect();
  const pos = ui.tipBubblePos(a, b.width, b.height, { w: window.innerWidth, h: window.innerHeight });
  bubble.style.setProperty('--tip-x', pos.left + 'px');
  bubble.style.setProperty('--tip-y', pos.top + 'px');
  tip.__bubble = bubble;
}
// 重绘前的收尾：挂在 body 下的气泡已经不在原来那棵 DOM 里了，重绘会再生成一份同 id 的，
// 两份同时存在 → `getElementById` 拿到哪一份取决于顺序（实测 E2E 报「resolved to 2 elements」）。
// 故任何会重绘这块内容的路径都先调它，把遗留的那份扔掉（它的宿主已经不存在）。
function dropDetachedBubbles() {
  document.querySelectorAll('body > .tip-bubble').forEach(b => b.remove());
}

function unplaceTipBubble(tip) {
  if (!tip || !tip.__bubble) return;
  const b = tip.__bubble;
  b.classList.remove('placed');
  if (b.parentElement === document.body) {
    const mark = tip.querySelector('.tip-mark');
    if (mark && mark.nextSibling) tip.insertBefore(b, mark.nextSibling);
    else tip.appendChild(b);
  }
  tip.__bubble = null;
}
// 单一入口：事件委托（tip 是动态渲染的，逐个挂监听会在每次重绘时留下悬挂的闭包）
document.addEventListener('mouseover', e => {
  const tip = e.target.closest && e.target.closest('.tip');
  if (tip) placeTipBubble(tip);
});
document.addEventListener('focusin', e => {
  const tip = e.target.closest && e.target.closest('.tip');
  if (tip) placeTipBubble(tip);
});
// 指针/焦点离开就搬回原处：否则气泡留在 body 上，`:hover` 那条选择器再也够不到它
// （表现是「展开过一次之后，之后永远显示」）。relatedTarget 仍在同一个 tip 里就不算离开。
// 判「真的离开了」要看两处：仍在 .tip 里，或者移到了**已搬家的气泡**上（它现在挂在 body 下，
// 不再算 .tip 的子孙——只看 tip.contains 会把「指针移到气泡上」当成离开，气泡当场消失）。
const tipStillActive = (tip, next) => !next || tip.contains(next) || tip.__bubble === next || (tip.__bubble && tip.__bubble.contains(next));
document.addEventListener('mouseout', e => {
  const tip = e.target.closest && e.target.closest('.tip');
  if (tip && !tipStillActive(tip, e.relatedTarget)) unplaceTipBubble(tip);
});
document.addEventListener('focusout', e => {
  const tip = e.target.closest && e.target.closest('.tip');
  if (tip && !tipStillActive(tip, e.relatedTarget)) unplaceTipBubble(tip);
});
// 视口尺寸变了要重算（否则气泡会停在被裁掉的旧位置）
window.addEventListener('resize', () => {
  document.querySelectorAll('.tip:hover, .tip:focus-within').forEach(placeTipBubble);
});

function catColor(catId, tagName) {
  return catColorImpl(state.categories, catId, tagName);
}
function closeModal(id) {
  const modal = document.getElementById(id);
  const wasOpen = modal.style.display !== 'none';
  modal.style.display = 'none';
  syncScrollLock(); // 先按「还剩几层」重算，再还焦点（焦点可能落在背后页面上，那时已解冻）
  // 把焦点还给打开它的元素；只有真的关掉一层才出栈（否则会吃掉别的弹窗的返回焦点）。
  if (!wasOpen) return;
  const back = __modalReturnFocus.pop();
  if (back && document.contains(back) && back.focus) back.focus();
}

// custom confirm dialog —— 清空 / 删除 / 覆盖落盘前唯一的二次确认出口（ui-wiring 巡检把守）
let _confirmCallback = null;
let _confirmCancelCallback = null;
function showConfirm(msg, onOk, title, opts) {
  opts = opts || {};
  document.getElementById('confirm-msg').textContent = msg;
  document.getElementById('confirm-title').textContent = title || i18n.t('确认操作');
  // 按钮文案与色调每次都重置：确认框全站共用，上一个调用留下的（如备份的金调）
  // 绝不能粘到下一个（删除这类真危险动作）确认上
  const ok = document.getElementById('confirm-ok-btn');
  ok.textContent = opts.okLabel || i18n.t('确认');
  ok.className = opts.tone === 'gold' ? 'btn-gold' : 'btn-danger';
  openModal('confirm-modal');
  _confirmCallback = onOk;
  // 取消回调也每次重置：与按钮文案/色调同一条规矩——上一个调用留下的东西
  // 绝不能粘到下一个确认框（否则一次删除确认的取消会触发上一次备份的收尾）
  _confirmCancelCallback = opts.onCancel || null;
  ok.focus();
}
function confirmCancel() {
  closeModal('confirm-modal');
  _confirmCallback = null;
  const onCancel = _confirmCancelCallback;
  _confirmCancelCallback = null;
  if (onCancel) onCancel();
}
document.getElementById('confirm-ok-btn').addEventListener('click', () => {
  if (__autoOpenedAt !== null && !ui.autoOpenGuard(performance.now() - __autoOpenedAt)) return;
  closeModal('confirm-modal');
  _confirmCancelCallback = null; // 确认路径不触发取消回调
  if (_confirmCallback) { _confirmCallback(); _confirmCallback = null; }
});

let __modalMouseDownTarget = null;
document.addEventListener('mousedown', e => { __modalMouseDownTarget = e.target; });
document.addEventListener('click', e => {
  // 自动弹窗守卫窗内的遮罩 click 是抬手指的余波，不算「点了遮罩空白」
  if (__autoOpenedAt !== null && !ui.autoOpenGuard(performance.now() - __autoOpenedAt)) return;
  if (e.target.classList.contains('modal-overlay') && __modalMouseDownTarget && !__modalMouseDownTarget.closest('.modal-content')) {
    if (e.target.id === 'confirm-modal') {
      confirmCancel(); // 统一走 confirmCancel：隐藏 + 清空 _confirmCallback
    } else if (e.target.id === 'asset-gate-modal') {
      cancelAssetGate(); // 点遮罩 = 放弃本次（与 Esc 同一条出口）
    } else if (e.target.id === 'pass-modal') {
      cancelPassImport();
    } else {
      closeModal(e.target.id); // 必须走 closeModal：直接改 display 会把焦点管理整个绕过
    }
  }
  __modalMouseDownTarget = null;
});

// Tab 焦点陷阱：Tab 只能在上层弹窗内循环。
// 为什么必须做：弹窗背后是**还活着的**页面（本项目不用 <dialog> 的 inert），
// 不拦的话 Tab 会一路走进背后的表格与按钮——读屏器用户会以为弹窗已经关了。
// 判据（绕回谁、下标怎么算）在 logic.js ui.trapFocus（可单测），这里只负责把焦点移过去。
document.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const top = topModal();
  if (!top) return;
  const list = modalFocusables(top);
  const cur = list.indexOf(document.activeElement);
  const r = ui.trapFocus(cur, list.length, e.shiftKey);
  if (!r.wrap || !list[r.index]) return; // 中间位置交还浏览器默认行为
  e.preventDefault();
  list[r.index].focus();
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const top = topModal();
  if (!top) return;
  if (top.id === 'asset-gate-modal') cancelAssetGate(); // 作废本次抄写（下次抬闸重新抽句）
  else if (top.id === 'confirm-modal') confirmCancel();
  else if (top.id === 'pass-modal') cancelPassImport();
  else closeModal(top.id); // 同上：ESC 也要还焦点，不能只改 display
});

function genId() {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function formatMoneyInput(el) {
  const sel = el.selectionStart;
  const raw = el.value;
  let clean = raw.replace(/[^\d.]/g, '');
  const dot = clean.indexOf('.');
  if (dot !== -1) clean = clean.slice(0, dot + 1) + clean.slice(dot + 1).replace(/\./g, '');
  const parts = clean.split('.');
  const intFmt = (parts[0] || '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const formatted = parts.length > 1 ? intFmt + '.' + parts[1] : intFmt;
  if (formatted !== raw) {
    el.value = formatted;
    let before = raw.slice(0, sel).replace(/[^\d.]/g, '');
    const bd = before.indexOf('.');
    if (bd !== -1) before = before.slice(0, bd + 1) + before.slice(bd + 1).replace(/\./g, '');
    const bp = before.split('.');
    const newPos = bp[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',').length + (bp.length > 1 ? 1 + bp[1].length : 0);
    el.setSelectionRange(newPos, newPos);
  }
}

// 统一提示便条：全站唯一的瞬时反馈出口（右下角 #toast-area 堆叠）。
// type 三态：success=操作成功（绿）/ error=出错待处理（红）/ info=系统中性知会（金墨边注）。
// 末尾同文案同类型且未在退场时只重置计时不再堆叠——自动触发的知会（汇率刷新、备份提醒）
// 撞上用户操作时不会糊成重复便条
function toast(msg, type) {
  const area = document.getElementById('toast-area');
  const prev = area.lastElementChild;
  if (prev && !prev.classList.contains('leaving') && prev.dataset.msg === msg && prev.dataset.type === String(type)) {
    clearTimeout(prev._hideTimer);
    armToastHide(prev);
    return;
  }
  // 播报档位按类型定：error 走 assertive（立刻打断朗读），其余 polite（择机播报）。
  // 写死在容器上就是「所有错误都排队」；档位写到容器而非每条便条上——
  // 读屏器只认 live region 的档位，逐条设 aria-live 无效。
  area.setAttribute('aria-live', ui.toastLiveMode(type));
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  t.dataset.msg = msg;
  t.dataset.type = String(type);
  area.appendChild(t); // 新便条贴最靠角处，旧便条自然上移（容器 bottom 锚定向上生长）
  armToastHide(t);
}

function armToastHide(t, delay) {
  clearTimeout(t._hideTimer);
  t._hideTimer = setTimeout(() => {
    if (toastHeld(t)) { armToastHide(t, 700); return; }
    t.classList.add('leaving');
    // 退场元素不该继续被对比度巡检/读屏器当成内容：标记 aria-hidden。
    // 归隐由 CSS 的 visibility 负责（顺带不再吃指针）；300ms 后移出 DOM（与退场过渡等长）。
    t.setAttribute('aria-hidden', 'true');
    setTimeout(() => t.remove(), 300);
  }, delay || 2500);
}

function toastHeld(t) {
  if (t.matches(':hover')) return true;
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed) return false;
  return t.contains(sel.anchorNode) || t.contains(sel.focusNode);
}

