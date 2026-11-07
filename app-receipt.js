const RECEIPT_WIDTH = 384;
const RECEIPT_PAD = 24;
const RECEIPT_SCALE = 2;
const RECEIPT_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New", monospace';
const RECEIPT_INK = '#2b2a26';
const RECEIPT_MUTED = '#7d776c';
const RECEIPT_PAPER = '#fdfcf6';

function receiptDescribe(e) {
  const tags = state.expenseCategories.map(cat => e.tags && e.tags[cat.id]).filter(Boolean);
  const note = String(e.note || '').trim();
  return { label: note || tags.join(' · '), sub: note ? tags.join(' · ') : '' };
}

function exportDayReceipt(dayStr) {
  const items = monthGrid.dayEntries(state.expenses, dayStr);
  const model = receipt.model(items, { date: dayStr, describe: receiptDescribe });
  if (!model) return;
  saveReceiptImage(model, dayStr);
}

function exportMonthReceipt(month) {
  const m = month || monthGridView || date.getCurrentMonth();
  const items = monthGrid.monthEntries(state.expenses, m);
  const model = receipt.model(items, { date: date.monthLabel(m), describe: receiptDescribe });
  if (!model) return;
  saveReceiptImage(model, m);
}

function saveReceiptImage(model, tag) {
  const canvas = drawReceipt(model);
  canvas.toBlob(blob => {
    if (!blob) return;
    downloadReceiptBlob(blob, receipt.fileName(tag));
    toast(i18n.t('小票已导出'), 'success');
  }, 'image/png');
}

function downloadReceiptBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function receiptRows(model) {
  const rows = [
    { kind: 'brand', h: 46 },
    { kind: 'title', text: i18n.t('消费小票'), h: 34 },
    { kind: 'meta', text: model.date, h: 22 },
    { kind: 'rule', h: 18 },
  ];
  model.rows.forEach(row => {
    rows.push({ kind: 'item', label: row.label, amount: '¥' + row.amount, h: 21 });
    if (row.sub) rows.push({ kind: 'sub', text: row.sub, h: 17 });
  });
  rows.push({ kind: 'rule', h: 18 });
  rows.push({ kind: 'total', label: i18n.t('合计'), amount: '¥' + model.totalText, h: 30 });
  rows.push({ kind: 'rule', h: 18 });
  rows.push({ kind: 'footer', text: i18n.t('{n} 件', { n: model.count }) + ' · ' + i18n.t('谢谢惠顾'), h: 26 });
  rows.push({ kind: 'barcode', text: model.date.replace(/\D/g, ''), h: 74 });
  return rows;
}

function fitText(ctx, text, maxWidth) {
  const str = String(text == null ? '' : text);
  if (ctx.measureText(str).width <= maxWidth) return str;
  let out = str;
  while (out.length > 1 && ctx.measureText(out + '…').width > maxWidth) out = out.slice(0, -1);
  return out + '…';
}

function drawReceiptRule(ctx, y, width) {
  ctx.save();
  ctx.strokeStyle = RECEIPT_MUTED;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(RECEIPT_PAD, y);
  ctx.lineTo(width - RECEIPT_PAD, y);
  ctx.stroke();
  ctx.restore();
}

function drawReceiptDots(ctx, x1, x2, y) {
  ctx.save();
  ctx.fillStyle = RECEIPT_MUTED;
  ctx.globalAlpha = 0.5;
  for (let x = x1; x < x2; x += 6) ctx.fillRect(x, y - 3, 1.5, 1.5);
  ctx.restore();
}

function receiptBarcodeBars(text) {
  const seed = String(text || '');
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 100000;
  const bars = [];
  let state = hash || 7;
  for (let i = 0; i < 52; i++) {
    state = (state * 1103515245 + 12345) % 2147483648;
    bars.push({ w: 1 + (state % 3), g: 1 + ((state >> 5) % 3) });
  }
  return bars;
}

function drawReceiptBarcode(ctx, centerX, top, width, text) {
  const bars = receiptBarcodeBars(text);
  const total = bars.reduce((s, b) => s + b.w + b.g, 0);
  let x = centerX - total / 2;
  ctx.save();
  ctx.fillStyle = RECEIPT_INK;
  bars.forEach(b => {
    ctx.fillRect(Math.round(x), top, b.w, 34);
    x += b.w + b.g;
  });
  ctx.font = '10px ' + RECEIPT_FONT;
  ctx.fillStyle = RECEIPT_MUTED;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(String(text || '').split('').join(' '), centerX, top + 40);
  ctx.restore();
}

// 品牌标记：孔方铜钱（金圆 + 方孔 + 四角裁切标记），与页头同一枚，只是画在画布上
function drawReceiptBrand(ctx, cx, top, size) {
  const r = size / 2;
  const cy = top + r;
  const gold = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  gold.addColorStop(0, '#d9b25e');
  gold.addColorStop(1, '#8f6713');
  ctx.save();
  ctx.fillStyle = gold;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  const half = r * 0.34;
  ctx.fillStyle = RECEIPT_PAPER;
  ctx.fillRect(cx - half, cy - half, half * 2, half * 2);
  ctx.strokeStyle = RECEIPT_INK;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  const tick = r * 0.26;
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
    const x = cx + sx * half;
    const y = cy + sy * half;
    ctx.beginPath();
    ctx.moveTo(x, y - sy * tick);
    ctx.lineTo(x, y);
    ctx.lineTo(x - sx * tick, y);
    ctx.stroke();
  });
  ctx.restore();
}

function drawReceipt(model) {
  const rows = receiptRows(model);
  const height = RECEIPT_PAD * 2 + rows.reduce((s, r) => s + r.h, 0);
  const width = RECEIPT_WIDTH;
  const canvas = document.createElement('canvas');
  canvas.width = width * RECEIPT_SCALE;
  canvas.height = Math.ceil(height) * RECEIPT_SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(RECEIPT_SCALE, RECEIPT_SCALE);

  ctx.fillStyle = RECEIPT_PAPER;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = RECEIPT_INK;
  ctx.textBaseline = 'middle';

  const innerLeft = RECEIPT_PAD;
  const innerRight = width - RECEIPT_PAD;
  const innerWidth = innerRight - innerLeft;
  let y = RECEIPT_PAD;

  rows.forEach(row => {
    const mid = y + row.h / 2;
    if (row.kind === 'brand') {
      drawReceiptBrand(ctx, width / 2, y + 6, 34);
    } else if (row.kind === 'title') {
      ctx.font = '17px ' + RECEIPT_FONT;
      ctx.textAlign = 'center';
      ctx.fillText(row.text, width / 2, mid);
    } else if (row.kind === 'meta') {
      ctx.font = '11px ' + RECEIPT_FONT;
      ctx.textAlign = 'center';
      ctx.fillStyle = RECEIPT_MUTED;
      ctx.fillText(row.text, width / 2, mid);
      ctx.fillStyle = RECEIPT_INK;
    } else if (row.kind === 'rule') {
      drawReceiptRule(ctx, y + row.h / 2, width);
    } else if (row.kind === 'item') {
      ctx.font = '13px ' + RECEIPT_FONT;
      ctx.textAlign = 'right';
      ctx.fillText(row.amount, innerRight, mid);
      const amountWidth = ctx.measureText(row.amount).width;
      ctx.textAlign = 'left';
      const label = fitText(ctx, row.label, innerWidth - amountWidth - 18);
      ctx.fillText(label, innerLeft, mid);
      const labelWidth = ctx.measureText(label).width;
      drawReceiptDots(ctx, innerLeft + labelWidth + 6, innerRight - amountWidth - 6, mid + 3);
    } else if (row.kind === 'sub') {
      ctx.font = '10px ' + RECEIPT_FONT;
      ctx.fillStyle = RECEIPT_MUTED;
      ctx.textAlign = 'left';
      ctx.fillText(fitText(ctx, row.text, innerWidth - 12), innerLeft + 8, mid);
      ctx.fillStyle = RECEIPT_INK;
    } else if (row.kind === 'total') {
      ctx.font = 'bold 16px ' + RECEIPT_FONT;
      ctx.textAlign = 'left';
      ctx.fillText(row.label, innerLeft, mid);
      ctx.textAlign = 'right';
      ctx.fillText(row.amount, innerRight, mid);
    } else if (row.kind === 'footer') {
      ctx.font = '11px ' + RECEIPT_FONT;
      ctx.fillStyle = RECEIPT_MUTED;
      ctx.textAlign = 'center';
      ctx.fillText(row.text, width / 2, mid);
      ctx.fillStyle = RECEIPT_INK;
    } else if (row.kind === 'barcode') {
      drawReceiptBarcode(ctx, width / 2, y + 8, innerWidth, row.text);
    }
    y += row.h;
  });

  return canvas;
}
