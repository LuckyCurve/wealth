/*
 * app-categories.js — 分类与标签管理（资产 / 消费共用）。
 * --------------------------------------------------------------------------
 * 两套分类的 CRUD 只差数据集合与文案：统一到 CAT_SIDES 配置 + 一套通用函数。
 * 含三部分：分类/标签列表与卡片的渲染、分类弹窗的增改删、长按胶囊就地改标签名的手势。
 * 标签改名是「迁移引用」而不是删除重建，判定与进度条走 logic.js 的 press*；这里的 DOM 接线
 * 与资产登记无关，故从 app-assets.js 拆出来——它同时服务消费侧。
 *
 * 加载顺序：紧跟 app-assets.js（两边只在运行时互相调用，没有加载期取值）。
 */
// ========== 分类 / 标签管理（资产 / 消费共用）==========
// 两套分类的 CRUD 仅数据集合与文案不同，逻辑完全一致，统一到 CAT_SIDES 配置 + 通用函数。
// 六个操作各一个入口：侧别由调用现场给（静态控件读 data-side，卡片模板在生成期拼字面量）。
// 入口名不再按侧别分叉——此前是 12 个一行转发 + editCategory → openCategoryModal → *Generic
// 三级跳，改一个名字要动配置表与两个函数。
const CAT_SIDES = {
  asset: {
    cats: () => state.categories,
    items: () => state.assets,
    renderItems: () => renderAssets(),
    newTagPrefix: 'new-tag-',
    colorFn: (catId, tag) => catColor(catId, tag),
    listId: 'categories-list',
    // 配置对象在脚本加载时求值：文案一律存成**取值函数**，调用时才取词。
    // 直接写 i18n.t(...) 会冻结成加载那一刻的语言（默认英文下切中文，这些文案仍是英文）。
    noun: () => i18n.t('资产'),
    savedUpdated: () => i18n.t('分类已更新'), savedCreated: () => i18n.t('分类已创建'),
    // 数据校验：两侧都接线。新增分类后老资产会缺该分类标签（分布/收益少算），列表上看不出来；
    // 历史快照是历史事实（快照深拷贝了当时的资产），**不随补齐回填**，面板顶部说明这一点。
    tagCheck: true,
    tagCheckBar: 'tagcheck-bar-assets',
    tagCheckHint: () => i18n.t('下面这些资产在某个分类下还没有标签（新增分类后老资产会缺）。组内顶部可一键补齐，也可以在每条资产上逐个点选，点一下即保存。历史快照按当时数据保留，不随补齐更新。'),
    tagCheckMeta: (a) => assetTagCheckMeta(a),
    modal: { id: 'category-modal', title: 'category-modal-title', form: 'category-form', editId: 'cat-edit-id', name: 'cat-name', tags: 'cat-tags', editTitle: () => i18n.t('编辑分类'), newTitle: () => i18n.t('新增分类') },
  },
  expense: {
    cats: () => state.expenseCategories,
    items: () => state.expenses,
    renderItems: () => renderExpenses(),
    newTagPrefix: 'expense-new-tag-',
    colorFn: (catId, tag) => expenseCatColor(catId, tag),
    listId: 'expense-categories-list',
    noun: () => i18n.t('消费记录'),
    savedUpdated: () => i18n.t('消费分类已更新'), savedCreated: () => i18n.t('消费分类已创建'),
    tagCheck: true,
    tagCheckBar: 'tagcheck-bar-expense',
    tagCheckHint: () => i18n.t('下面这些记录在某个分类下还没有标签。组内顶部可一键补齐，也可以在每条记录上逐个点选，点一下即保存。'),
    tagCheckMeta: (e) => expenseTagCheckMeta(e),
    modal: { id: 'expense-category-modal', title: 'expense-category-modal-title', form: 'expense-category-form', editId: 'expense-cat-edit-id', name: 'expense-cat-name', tags: 'expense-cat-tags', editTitle: () => i18n.t('编辑消费分类'), newTitle: () => i18n.t('新增消费分类') },
  },
};

// 长按改名的唯一接线处（事件委托）：分类卡片每次重绘都换掉内层 DOM，
// 逐个挂监听会在每次重绘后留下悬挂闭包（旧胶囊被换掉，监听仍指着它）。
// 两个分类列表共用这一套（资产/消费）。
['categories-list', 'expense-categories-list'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('pointerdown', e => {
    const pill = e.target.closest && e.target.closest('.tag-pill[data-rename]');
    if (pill) startTagPress(e, pill);
  });
});

function renderCategoryCards(side) {
  const cfg = CAT_SIDES[side];
  const container = document.getElementById(cfg.listId);
  const gaps = cfg.tagCheck ? expense.missingTagGroups(cfg.items(), cfg.cats()) : [];
  const gapOf = id => gaps.find(g => g.catId === id);
  container.innerHTML = cfg.cats().map(cat => {
    // 内置分类（货币类型）是写死的逻辑：标签就是币种代码，改名与删除在守卫里都只回一句
    // 「内置分类不可修改」。故整张卡片**只读**——不接改名与删除入口，否则长按弹出输入框、
    // 提交又被守卫拒绝（拒绝路径只是 return，没人收走那个输入框），用户实测的
    //「长按内置的货币类型，然后点其他地方不能取消编辑」就是这么来的。
    const tagOpts = cat.builtin
      ? { showKey: false }
      : { showKey: false, removeSide: side, renameSide: side };
    const tagPills = cat.tags.map(t => tagPillHtml(cat, t, cfg.colorFn, tagOpts)).join(' ');
    // 「添加」按钮与回车共用同一调用表达式, 防两处接线各自漂移
    const addTagCall = `addTag('${text.jsAttr(side)}', '${text.jsAttr(cat.id)}')`;
    const gap = gapOf(cat.id);
    return `<div class="card">
      <div class="category-head mb-3">
        <div class="row-start">
          <h3 class="card-title">${text.esc(cat.name)}</h3>
          ${cat.builtin ? '<span class="t-micro px-2 py-0.5 rounded muted" style="background:var(--bg-2);border:1px solid var(--border);">' + i18n.t('内置') + '</span>' : ''}
        </div>
        <div class="row-actions-inline">
          ${!cat.builtin ? `<button onclick="openCategoryModal('${text.jsAttr(side)}', '${text.jsAttr(cat.id)}')" class="row-btn edit">${i18n.t('编辑')}</button>
          <button onclick="deleteCategory('${text.jsAttr(side)}', '${text.jsAttr(cat.id)}')" class="row-btn danger">${i18n.t('删除')}</button>` : ''}
        </div>
      </div>
      <div class="tag-row-lg mb-3">${tagPills}</div>
      ${cat.builtin ? '' : `
      <div class="new-tag-row">
        <input type="text" id="${text.esc(cfg.newTagPrefix + cat.id)}" placeholder="${i18n.t('新增标签（回车添加）')}" class="t-body" autocomplete="off" onkeydown="if(event.key==='Enter'&&!event.isComposing){event.preventDefault();${addTagCall};}">
        <button onclick="${addTagCall}" class="btn-ghost btn-sm">${i18n.t('添加')}</button>
      </div>`}
      ${gap ? `<div class="tagcheck-strip">
        <span class="t-micro"><b class="ink-accent">${gap.items.length}</b> ${i18n.t('条记录未归到本分类')}</span>
        <button type="button" class="row-btn edit" onclick="openTagCheck('${text.jsAttr(side)}', '${text.jsAttr(cat.id)}')">${i18n.t('去校验')}</button>
      </div>` : ''}
    </div>`;
  }).join('');
}

function openCategoryModal(side, editId) {
  const m = CAT_SIDES[side].modal;
  const modal = document.getElementById(m.id);
  const title = document.getElementById(m.title);
  const form = document.getElementById(m.form);
  form.reset();
  document.getElementById(m.editId).value = editId || '';
  if (editId) {
    title.textContent = m.editTitle();
    const c = CAT_SIDES[side].cats().find(x => x.id === editId);
    if (c) {
      document.getElementById(m.name).value = c.name;
      document.getElementById(m.tags).value = c.tags.join(', ');
    }
  } else {
    title.textContent = m.newTitle();
  }
  openModal(m.id);
}

function saveCategory(side, e) {
  e.preventDefault();
  const cfg = CAT_SIDES[side];
  const m = cfg.modal;
  const editId = document.getElementById(m.editId).value;
  const name = document.getElementById(m.name).value.trim();
  const tagsStr = document.getElementById(m.tags).value.trim();
  const tags = category.parseTagInput(tagsStr);

  if (tags.length === 0) {
    toast(i18n.t('至少需要一个标签'), 'error');
    return;
  }

  const cats = cfg.cats();
  const idx = editId ? cats.findIndex(c => c.id === editId) : -1;
  // 确认前一律不改内存态：取消保存后内存必须与存档一致（否则后续任一 saveState 会把它悄悄落盘）
  const removed = idx >= 0 ? (cats[idx].tags || []).filter(t => !tags.includes(t)) : [];
  let createdId = '';

  // 保存动作：直接保存与「确认清空引用」后共用同一段，避免两条保存路径各自漂移
  const apply = () => {
    if (idx >= 0) {
      cats[idx] = { ...cats[idx], name, tags };
    } else {
      const created = { id: genId(), name, builtin: false, tags };
      cats.push(created);
      createdId = created.id;
    }
    cfg.items().forEach(it => {
      if (it.tags[editId] && !tags.includes(it.tags[editId])) delete it.tags[editId];
    });
    // 分类标签被移除后同步清理读数行引用（消费分类与读数行无关，带侧别闸门）
    if (side === 'asset') state.runwayTags = income.pruneRunwayTags(state.runwayTags, state.categories);
    saveState();
    renderCategoryCards(side);
    cfg.renderItems();
    closeModal(m.id);
    toast(editId ? cfg.savedUpdated() : cfg.savedCreated(), 'success');
    if (createdId && cfg.tagCheck) {
      const gap = expense.missingTagGroups(cfg.items(), cfg.cats()).find(g => g.catId === createdId);
      if (gap) openTagCheck(side, createdId);
    }
  };

  // 被移除的标签若仍被引用，先告知将清空多少条记录（静默清空归类会让分布/收益默默失真）
  const refs = expense.countTagRefs(cfg.items(), editId, removed);
  if (refs > 0) {
    showConfirm(
      i18n.t('「{p1}」已不在标签列表中，保存后将清空 {p2} 条记录上的归类。', { p1: removed.join('、'), p2: refs }) +
      i18n.t('只想改名的话，长按那枚标签即可（会保留归类）。'),
      apply,
      i18n.t('移除标签')
    );
    return;
  }
  apply();
}

function deleteCategory(side, id) {
  const cfg = CAT_SIDES[side];
  const cat = cfg.cats().find(c => c.id === id);
  if (cat && cat.builtin) return;
  showConfirm(i18n.t('确认删除分类「{p1}」？该分类下{p2}的标签关联也会被移除。', { p1: cat.name, p2: cfg.noun() }), () => {
    const newCats = cfg.cats().filter(c => c.id !== id);
    if (side === 'asset') state.categories = newCats; else state.expenseCategories = newCats;
    cfg.items().forEach(it => { delete it.tags[id]; });
    if (side === 'asset') state.runwayTags = income.pruneRunwayTags(state.runwayTags, state.categories);
    // 压测情景指向的分类没了 → 整条作废（normalizeRunwayTags 同理：不留指向已删分类的跌幅）
    if (side === 'asset') state.stress = stress.pruneStress(state.stress, state.categories);
    saveState();
    renderCategoryCards(side);
    cfg.renderItems();
    toast(i18n.t('分类已删除'), 'success');
  });
}

function addTag(side, catId) {
  const cfg = CAT_SIDES[side];
  const input = document.getElementById(cfg.newTagPrefix + catId);
  const val = input.value.trim();
  if (!val) return;
  const cat = cfg.cats().find(c => c.id === catId);
  if (!cat) return;
  if (cat.builtin) { toast(i18n.t('内置分类不可修改'), 'error'); return; }
  if (cat.tags.includes(val)) { toast(i18n.t('标签已存在'), 'error'); return; }
  cat.tags.push(val);
  saveState();
  renderCategoryCards(side);
  cfg.renderItems();
  const next = document.getElementById(cfg.newTagPrefix + catId);
  if (next) next.focus();
  toast(i18n.t('标签已添加'), 'success');
}

function removeTag(side, catId, tagName) {
  const cfg = CAT_SIDES[side];
  const cat = cfg.cats().find(c => c.id === catId);
  if (!cat) return;
  if (cat.builtin) { toast(i18n.t('内置分类不可修改'), 'error'); return; }
  if (cat.tags.length <= 1) { toast(i18n.t('至少保留一个标签'), 'error'); return; }
  const refs = expense.countTagRefs(cfg.items(), catId, [tagName]);
  showConfirm(i18n.t('确认移除标签「{p1}」？{p2} 条记录上的归类也会被清空。', { p1: tagName, p2: refs }), () => {
    cat.tags = cat.tags.filter(t => t !== tagName);
    cfg.items().forEach(it => { if (it.tags[catId] === tagName) delete it.tags[catId]; });
    if (side === 'asset') state.runwayTags = income.pruneRunwayTags(state.runwayTags, state.categories);
    saveState();
    renderCategoryCards(side);
    cfg.renderItems();
    toast(i18n.t('标签已移除'), 'success');
  });
}

// 标签改名（长按胶囊）：**迁移引用**而不是删除重建——旧名若走「已失效引用」清理，
// 资产/消费上的归类会被静默清空（分布/收益随之失真）。本函数只管数据与重绘，
// 输入框由 startTagRename 就地提供。
function renameTag(side, catId, oldName, newName) {
  const cfg = CAT_SIDES[side];
  const cat = cfg.cats().find(c => c.id === catId);
  if (!cat) return;
  if (cat.builtin) { toast(i18n.t('内置分类不可修改'), 'error'); return; }
  // 空名 / 同名 / 重名都不改数据，重绘即把输入框还原成原来的胶囊
  if (!newName || newName === oldName) { renderCategoryCards(side); return; }
  if (cat.tags.includes(newName)) { toast(i18n.t('标签已存在'), 'error'); renderCategoryCards(side); return; }
  // 旧名已不在列表里（卡片是上一次渲染的快照）：不改数据，重绘即还原
  const at = cat.tags.indexOf(oldName);
  if (at < 0) { renderCategoryCards(side); return; }
  cat.tags[at] = newName;
  expense.migrateTagRefs(cfg.items(), catId, oldName, newName);
  // 读数卡所选标签同按「分类 + 名字」引用，改名要一并迁移，否则 prune 会把选择清掉
  if (side === 'asset') state.runwayTags = income.migrateRunwayTagRefs(state.runwayTags, catId, oldName, newName);
  // 压测情景同按「分类 + 名字」引用跌幅条目，改名也要一并迁移（否则设好的情景会静默失效）
  if (side === 'asset') state.stress = stress.migrateStressTagRefs(state.stress, catId, oldName, newName);
  saveState();
  renderCategoryCards(side);
  cfg.renderItems();
  toast(i18n.t('标签已重命名'), 'success');
}

// ===== 长按胶囊改标签名 =====
// 短按什么都不做；指针移开或被系统夺走 = 放弃；长按是手势不是权限（Enter 直达）。判定与资产入口同源。
let tagPress = null; // { el, start, raf, moved }

function startTagPress(e, pill) {
  if (!pill) return;
  if (e.button !== undefined && e.button !== 0) return; // 只认左键/触摸
  // 点在 ✕ 上不是长按（那是删除按钮自己的事）
  if (e.target && e.target.closest && e.target.closest('.pill-del')) return;
  cancelTagPress();
  tagPress = { el: pill, start: performance.now(), raf: 0, moved: false };
  pill.classList.add('pressing');
  // 指针一移开就放弃：长按的对象必须始终是同一枚胶囊
  const onMove = (ev) => {
    if (!tagPress) return;
    const r = pill.getBoundingClientRect();
    if (ev.clientX < r.left - 4 || ev.clientX > r.right + 4 || ev.clientY < r.top - 4 || ev.clientY > r.bottom + 4) cancelTagPress();
  };
  const onUp = (ev) => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    endTagPress(ev, pill);
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  const tick = () => {
    if (!tagPress || tagPress.el !== pill) return;
    const held = performance.now() - tagPress.start;
    const progress = ui.pressProgress(held, ui.TAG_PRESS_MS);
    pill.style.boxShadow = `inset ${Math.round(progress * pill.offsetWidth)}px 0 0 0 var(--accent-glow), inset 0 -2px 0 0 var(--accent)`;
    if (ui.pressDecision(held, ui.TAG_PRESS_MS) !== 'done') { tagPress.raf = requestAnimationFrame(tick); return; }
    // 满时长**直接进编辑态**（不再等松手）：墨线涨满的那一瞬输入框就在原地出现——与
    // 「进资产页」按满即弹同一处置（旧实现让用户「按满—松手」两步，松手前墨线停在满格像卡住）。
    // 先收尾再开输入框：不先收尾的话，紧跟着的松手会让 endTagPress 再开一次（同一次长按两个入口）。
    const side = pill.dataset.rename;
    const catId = pill.dataset.cat;
    const tagName = pill.dataset.tag;
    tagPress.raf = 0;
    resetTagPress();
    if (side) startTagRename(pill, side, catId, tagName);
  };
  tagPress.raf = requestAnimationFrame(tick);
}

// 松手收尾：短按什么都不做（胶囊上的点击本来没有语义）。
// 满时长一般已在 tick 里进了编辑态、走不到这里；只有「松手早于下一帧」那一线会落到本函数——
// 那时判定同源，仍然进编辑态（手势够长了，不该因为少一帧而作废）。
function endTagPress(e, pill) {
  if (!tagPress || tagPress.el !== pill) return;
  const decision = ui.pressDecision(performance.now() - tagPress.start, ui.TAG_PRESS_MS);
  const side = pill.dataset.rename;
  const catId = pill.dataset.cat;
  const tagName = pill.dataset.tag;
  resetTagPress();
  if (decision !== 'done') return;
  if (!side) return;
  startTagRename(pill, side, catId, tagName);
}

function cancelTagPress() {
  if (!tagPress) return;
  resetTagPress();
}

function resetTagPress() {
  if (!tagPress) return;
  if (tagPress.raf) cancelAnimationFrame(tagPress.raf);
  const el = tagPress.el;
  if (el) {
    el.classList.remove('pressing');
    el.style.removeProperty('box-shadow');
  }
  tagPress = null;
}

// 键盘通道：长按是手势，键盘用户不该被挡在门外（与「进资产页」的长按门槛同一原则）
function renameTagFromKey(e) {
  e.preventDefault();
  const pill = e.currentTarget && e.currentTarget.closest ? e.currentTarget.closest('.tag-pill') : null;
  if (!pill || !pill.dataset.rename) return;
  startTagRename(pill, pill.dataset.rename, pill.dataset.cat, pill.dataset.tag);
}

// 标签就地重命名：把整枚 pill 换成输入框（回车/blur 提交、Esc 取消），与「新增标签」同一交互语言。
// 中文输入法确认候选字用的也是回车，无 isComposing 守卫会在组字中途提前提交。
function startTagRename(pill, side, catId, oldName) {
  if (!pill || !pill.classList || !pill.classList.contains('tag-pill')) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tag-rename-input';
  input.value = oldName;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', i18n.t('标签名称'));
  pill.replaceWith(input);
  let done = false; // Esc 取消会因重绘移除输入框而触发 blur，标记防二次提交
  const finish = (submit) => {
    if (done) return;
    done = true;
    if (submit) renameTag(side, catId, oldName, input.value.trim());
    else renderCategoryCards(side);
    // 编辑框必须有归宿：renameTag 的每条拒绝路径（分类已删 / 内置 / 重名 / 旧名过期）
    // 都只是 return，谁也没把胶囊放回去——输入框就孤零零留在卡片上，用户点别处也收不掉它。
    // 收尾放在 finish 里而不是各条守卫里：一处兜住，日后再加一条早退也不会重新漏。
    if (input.isConnected) renderCategoryCards(side);
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); }
  });
  input.addEventListener('blur', () => finish(true));
  input.focus();
  input.select();
}

function compareBy(a, b, field, dir, getVal, secondary) {
  let va = getVal ? getVal(a, field) : a[field];
  let vb = getVal ? getVal(b, field) : b[field];
  if (typeof va === 'string') va = va.toLowerCase();
  if (typeof vb === 'string') vb = vb.toLowerCase();
  if (va < vb) return dir === 'asc' ? -1 : 1;
  if (va > vb) return dir === 'asc' ? 1 : -1;
  if (secondary) return secondary(a, b);
  return 0;
}

function updateSortIndicators(prefix, fields, sortBy, sortDir) {
  fields.forEach(f => {
    const el = document.getElementById(prefix + f);
    if (!el) return;
    el.textContent = sortBy === f ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    el.className = 'sort-indicator' + (sortBy === f ? ' active' : '');
    // aria-sort 在 role=button 上不可达（AX 树里不产生 sort 信息），真正到达读屏器的是 aria-label；
    // 每次都要 setAttribute——只设选中的话，换列后旧方向会粘在上一列上。
    const head = el.parentElement;
    if (head && head.getAttribute('role') === 'button') {
      head.setAttribute('aria-sort', ui.sortAriaSort(sortBy, sortDir, f));
      const label = (head.dataset.colLabel || head.textContent.replace(/[▲▼]/g, '').trim());
      head.dataset.colLabel = label; // 缓存可见列名：textContent 会被 ▲/▼ 污染，先剥一次再记住
      head.setAttribute('aria-label', ui.sortAriaLabel(label, sortBy, sortDir, f));
    }
  });
}

// 下拉选项统一写入：内容没变就不碰 DOM（搜索每按一键都重跑筛选链，替换 option 会打断展开中的下拉）。
function setSelectOptions(sel, html) {
  if (sel.dataset.optionsHtml === html) return;
  sel.innerHTML = html;
  sel.dataset.optionsHtml = html;
  freezeSelectWidth(sel);
}

// 钉住下拉的固有宽度：base-select 不再按最长选项取宽，换选项时宽度会跳，只能量一次写进 --sel-w。
// 量本必须带 data-measuring（否则量到的是被钉过的宽度）；拿不到布局就跳过，进 Tab 时 setSelectOptions 再量。
function freezeSelectWidth(sel) {
  if (!sel || !sel.options) return;
  const labels = [...sel.options].map((o) => o.textContent);
  if (!ui.shouldPinSelectWidth(labels)) {
    sel.style.removeProperty('--sel-w');
    return;
  }
  if (!sel.offsetParent && !sel.getClientRects().length) return;
  const probe = sel.cloneNode(true);
  probe.removeAttribute('id');
  probe.setAttribute('data-measuring', '');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:absolute; left:-9999px; top:0; visibility:hidden; pointer-events:none';
  document.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width;
  probe.remove();
  if (w > 0) sel.style.setProperty('--sel-w', w + 'px');
}

// 一次量完全部下拉：字体就绪后跑一次（量宽依赖真实字形度量，用回退字体量出的宽会偏）
function freezeSelectWidths() {
  document.querySelectorAll('body select').forEach(freezeSelectWidth);
}
function fillMonthSelect(selId, months) {
  const sel = document.getElementById(selId);
  if (!sel) return sel;
  const current = sel.value;
  setSelectOptions(sel, '<option value="">' + i18n.t('全部时间') + '</option>' +
    date.monthsDesc(months).map(m => `<option value="${m}">${date.monthLabel(m)}</option>`).join(''));
  if (current && sel.querySelector(`option[value="${current}"]`)) sel.value = current;
  return sel;
}

// 切换一对分段按钮的 active 态并执行回调(图表模式/收益口径等共用)
function setSegMode(idA, idB, mode, activeA, activeB, onChange) {
  document.getElementById(idA).className = mode === activeA ? 'seg-btn active' : 'seg-btn';
  document.getElementById(idB).className = mode === activeB ? 'seg-btn active' : 'seg-btn';
  onChange();
}


