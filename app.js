const ENTRY_KEY = 'calorie-stack.entries.v1';
const UI_KEY = 'calorie-stack.ui.v1';
const MERGE_KEY = 'calorie-stack.merges.v1';

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

const LEVEL_COLORS = [
  '#234B3B', '#3F6655', '#66845D', '#8DA06A', '#AAB47A', '#C7BB72',
  '#D3A45F', '#DE8B55', '#CF744D', '#B95D47', '#98483F', '#8A1C1C'
];
let entries = loadArray(ENTRY_KEY);
let mergeState = loadObject(MERGE_KEY);
let uiState = loadObject(UI_KEY);
let statsDate = /^\d{4}-\d{2}-\d{2}$/.test(uiState.statsDate || '') ? uiState.statsDate : dateKey(new Date());
if (statsDate > dateKey(new Date())) statsDate = dateKey(new Date());
let editingId = null;
let selectedGroupId = null;
let chartBars = [];
let pointerState = null;
let longPressTimer = null;
let chartAnimation = null;
let toastTimer;

const elements = {
  todayCalories: document.querySelector('#today-calories'),
  summaryTitle: document.querySelector('#summary-title'),
  todayRecords: document.querySelector('#today-records'),
  entryCount: document.querySelector('#entry-count'),
  statsView: document.querySelector('#stats-view'),
  editRecordDialog: document.querySelector('#edit-record-dialog'),
  editRecordForm: document.querySelector('#edit-record-form'),
  editFoodName: document.querySelector('#edit-food-name'),
  editFoodCalories: document.querySelector('#edit-food-calories'),
  editRecordTime: document.querySelector('#edit-record-time'),
  statsDateLabel: document.querySelector('#stats-date-label'),
  statsDateInput: document.querySelector('#stats-date-input'),
  nextDay: document.querySelector('#next-day'),
  statsQuickEntry: document.querySelector('#stats-quick-entry'),
  statsFoodName: document.querySelector('#stats-food-name'),
  statsFoodCalories: document.querySelector('#stats-food-calories'),
  statsSaveButton: document.querySelector('#stats-save-button'),
  chart: document.querySelector('#calorie-chart'),
  chartWrap: document.querySelector('#chart-wrap'),
  chartEmpty: document.querySelector('#chart-empty'),
  chartTooltip: document.querySelector('#chart-tooltip'),
  toast: document.querySelector('#toast')
};

function loadArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function loadObject(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function persistEntries() {
  localStorage.setItem(ENTRY_KEY, JSON.stringify(entries));
}

function persistMerges() {
  localStorage.setItem(MERGE_KEY, JSON.stringify(mergeState));
}

function persistUiState() {
  try { localStorage.setItem(UI_KEY, JSON.stringify(uiState)); } catch {}
}

function rememberUiState() {
  uiState.statsDate = statsDate;
  persistUiState();
}

function dateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateFromKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(key, includeYear = true) {
  return new Intl.DateTimeFormat('zh-CN', {
    ...(includeYear ? { year: 'numeric' } : {}), month: 'long', day: 'numeric', weekday: 'long'
  }).format(dateFromKey(key));
}

function formatTime(value) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function makeId() {
  return crypto.randomUUID?.() || `calorie-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function colorForCalories(calories) {
  const value = Math.max(0, Number(calories) || 0);
  if (value >= 1100) return LEVEL_COLORS[11];
  const position = value / 100;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return LEVEL_COLORS[lowerIndex];
  return mixHexColors(LEVEL_COLORS[lowerIndex], LEVEL_COLORS[upperIndex], position - lowerIndex);
}

function mixHexColors(first, second, amount) {
  const channel = (hex, start) => parseInt(hex.slice(start, start + 2), 16);
  const blend = (start, end) => Math.round(start + (end - start) * amount).toString(16).padStart(2, '0');
  return `#${blend(channel(first, 1), channel(second, 1))}${blend(channel(first, 3), channel(second, 3))}${blend(channel(first, 5), channel(second, 5))}`;
}

function roundedBarPath(ctx, x, y, width, height, radius) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.closePath();
}

function entriesForDate(key) {
  return entries
    .filter((entry) => dateKey(entry.timestamp) === key)
    .sort((first, second) => new Date(first.timestamp) - new Date(second.timestamp));
}

function renderHome() {
  const records = entriesForDate(statsDate).slice().reverse();
  const total = records.reduce((sum, entry) => sum + (Number(entry.calories) || 0), 0);
  elements.summaryTitle.textContent = statsDate === dateKey(new Date()) ? '今日已记录热量' : '当日已记录热量';
  elements.todayCalories.textContent = total.toLocaleString('zh-CN');
  elements.entryCount.textContent = `${records.length} 条`;
  elements.todayRecords.innerHTML = records.length ? records.map((entry) => {
    const calories = Number(entry.calories) || 0;
    const food = String(entry.food || '').trim() || '未填写食物名称';
    return `<article class="record-row">
      <button class="record-edit-button" type="button" data-edit="${entry.id}" aria-label="编辑${formatTime(entry.timestamp)}的记录">
        <span class="record-calorie-badge" style="--calorie-color:${colorForCalories(calories)}"><strong>${calories}</strong><small>kcal</small></span>
        <span class="record-main"><strong>${escapeHtml(food)}</strong><span>${calories} kcal</span></span>
        <time class="record-time" datetime="${entry.timestamp}">${formatTime(entry.timestamp)}</time>
      </button>
      <button class="delete-record" type="button" data-delete="${entry.id}" aria-label="删除${formatTime(entry.timestamp)}的记录">×</button>
    </article>`;
  }).join('') : '<p class="empty-records">这一天还没有热量记录。</p>';
}

function updateStatsSaveButton() {
  const calories = Number(elements.statsFoodCalories.value);
  elements.statsSaveButton.disabled = !(Number.isFinite(calories) && calories > 0 && calories <= 99999);
}

function saveStatsRecord(event) {
  event.preventDefault();
  const calories = Number(elements.statsFoodCalories.value);
  if (!Number.isFinite(calories) || calories <= 0 || calories > 99999) {
    showToast('请填写有效的热量数字');
    return;
  }
  const now = new Date();
  const targetDate = dateFromKey(statsDate);
  targetDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), 0);
  const previousTotal = calorieEntriesForStats().reduce((sum, entry) => sum + (Number(entry.calories) || 0), 0);
  const record = { id: makeId(), timestamp: targetDate.toISOString(), food: elements.statsFoodName.value.trim(), calories };
  entries.push(record);
  try {
    persistEntries();
  } catch {
    entries.pop();
    showToast('保存失败，浏览器存储空间可能已满');
    return;
  }
  elements.statsFoodName.value = '';
  elements.statsFoodCalories.value = '';
  updateStatsSaveButton();
  selectedGroupId = null;
  renderHome();
  animateChartGrowth(previousTotal, previousTotal + calories);
  showToast('热量记录已保存');
}

function deleteRecord(id) {
  const record = entries.find((entry) => entry.id === id);
  if (!record || !confirm(`删除 ${formatTime(record.timestamp)} 的 ${record.calories} kcal 记录？`)) return;
  entries = entries.filter((entry) => entry.id !== id);
  removeEntryFromMerges(id);
  persistEntries();
  selectedGroupId = null;
  renderHome();
  renderChart();
  showToast('记录已删除');
}

function openRecordEditor(id) {
  const record = entries.find((entry) => entry.id === id);
  if (!record) return;
  editingId = id;
  elements.editFoodName.value = record.food || '';
  elements.editFoodCalories.value = record.calories;
  const time = new Date(record.timestamp);
  elements.editRecordTime.value = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
  elements.editRecordDialog.showModal();
}

function saveEditedRecord(event) {
  event.preventDefault();
  const index = entries.findIndex((entry) => entry.id === editingId);
  const calories = Number(elements.editFoodCalories.value);
  const timeParts = elements.editRecordTime.value.split(':').map(Number);
  if (index < 0 || !Number.isFinite(calories) || calories <= 0 || calories > 99999) {
    showToast('请填写有效的热量数字');
    return;
  }
  if (timeParts.length !== 2 || timeParts.some((value) => !Number.isFinite(value))) {
    showToast('请选择有效的记录时间');
    return;
  }
  const original = entries[index];
  const originalTime = new Date(original.timestamp);
  const updatedTime = new Date(
    originalTime.getFullYear(), originalTime.getMonth(), originalTime.getDate(),
    timeParts[0], timeParts[1], 0, 0
  );
  entries[index] = {
    ...original,
    food: elements.editFoodName.value.trim(),
    calories,
    timestamp: updatedTime.toISOString()
  };
  try {
    persistEntries();
  } catch {
    entries[index] = original;
    showToast('保存失败，请稍后重试');
    return;
  }
  editingId = null;
  selectedGroupId = null;
  elements.editRecordDialog.close();
  renderHome();
  renderChart();
  showToast('记录已更新');
}

function moveStatsDay(offset) {
  const date = dateFromKey(statsDate);
  date.setDate(date.getDate() + offset);
  const next = dateKey(date);
  if (next > dateKey(new Date())) return;
  statsDate = next;
  selectedGroupId = null;
  rememberUiState();
  renderChart();
}

function calorieEntriesForStats() {
  return entriesForDate(statsDate).filter((entry) => Number(entry.calories) > 0);
}

function groupedCalories() {
  const records = calorieEntriesForStats();
  const byId = new Map(records.map((entry) => [entry.id, entry]));
  const used = new Set();
  const savedGroups = Array.isArray(mergeState[statsDate]) ? mergeState[statsDate] : [];
  const groups = savedGroups.map((saved) => {
    const groupEntries = saved.entryIds.map((id) => byId.get(id)).filter(Boolean);
    groupEntries.forEach((entry) => used.add(entry.id));
    return { id: saved.id, entries: groupEntries, merged: groupEntries.length > 1 };
  }).filter((group) => group.entries.length > 1);
  records.forEach((entry) => {
    if (!used.has(entry.id)) groups.push({ id: `entry:${entry.id}`, entries: [entry], merged: false });
  });
  return groups
    .map((group) => ({
      ...group,
      total: group.entries.reduce((sum, entry) => sum + (Number(entry.calories) || 0), 0),
      timestamp: Math.min(...group.entries.map((entry) => new Date(entry.timestamp).getTime()))
    }))
    .sort((first, second) => first.timestamp - second.timestamp);
}

function removeEntryFromMerges(entryId) {
  Object.keys(mergeState).forEach((key) => {
    const groups = Array.isArray(mergeState[key]) ? mergeState[key] : [];
    mergeState[key] = groups
      .map((group) => ({ ...group, entryIds: group.entryIds.filter((id) => id !== entryId) }))
      .filter((group) => group.entryIds.length > 1);
    if (!mergeState[key].length) delete mergeState[key];
  });
  persistMerges();
}

function mergeGroups(sourceId, targetId) {
  const source = groupedCalories().find((group) => group.id === sourceId);
  const target = groupedCalories().find((group) => group.id === targetId);
  if (!source || !target || source.id === target.id) return;
  const foodText = [...source.entries, ...target.entries]
    .map((entry) => String(entry.food || '').trim() || '未命名食物').join('、');
  if (!confirm(`将“${foodText}”合并为一个 ${source.total + target.total} kcal 的热量柱？`)) return;
  const sourceIds = new Set(source.entries.map((entry) => entry.id));
  const targetIds = new Set(target.entries.map((entry) => entry.id));
  const existing = Array.isArray(mergeState[statsDate]) ? mergeState[statsDate] : [];
  mergeState[statsDate] = existing.filter((group) =>
    !group.entryIds.some((id) => sourceIds.has(id) || targetIds.has(id))
  );
  const id = `merge:${makeId()}`;
  mergeState[statsDate].push({ id, entryIds: [...sourceIds, ...targetIds] });
  persistMerges();
  selectedGroupId = id;
  renderChart();
  showToast('热量柱已合并');
}

function splitGroup(groupId) {
  const group = groupedCalories().find((item) => item.id === groupId);
  if (!group?.merged) {
    showToast('该热量柱没有可拆解内容');
    return;
  }
  if (!confirm(`将这个 ${group.total} kcal 的合并柱恢复为原来的 ${group.entries.length} 条记录？`)) return;
  mergeState[statsDate] = (mergeState[statsDate] || []).filter((item) => item.id !== groupId);
  if (!mergeState[statsDate].length) delete mergeState[statsDate];
  persistMerges();
  selectedGroupId = null;
  renderChart();
  showToast('已恢复为原来的记录');
}

function foodLabelForGroup(group) {
  return group.entries
    .map((entry) => String(entry.food || '').trim())
    .filter(Boolean)
    .join('、');
}

function renderChart(animatedTotal = null) {
  renderHome();
  const groups = groupedCalories();
  const dailyTotal = groups.reduce((sum, group) => sum + group.total, 0);
  const visibleTotal = animatedTotal === null ? dailyTotal : Math.max(0, Math.min(dailyTotal, animatedTotal));
  const bounds = elements.chartWrap.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const canvas = elements.chart;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(bounds.width * dpr);
  canvas.height = Math.round(bounds.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, bounds.width, bounds.height);

  elements.statsDateLabel.textContent = statsDate === dateKey(new Date()) ? '今天' : formatDate(statsDate, false);
  elements.statsDateInput.value = statsDate;
  elements.statsDateInput.max = dateKey(new Date());
  elements.nextDay.disabled = statsDate >= dateKey(new Date());
  elements.chartTooltip.hidden = true;
  elements.chartEmpty.hidden = groups.length > 0;

  const compact = bounds.height < 310;
  const plot = { left: compact ? 27 : 29, right: bounds.width - 1, top: compact ? 5 : 7, bottom: bounds.height - 4 };
  const unit = (plot.bottom - plot.top) / 19;
  const y1800 = plot.top + unit;
  const yFor = (value) => {
    const calories = Math.max(0, Number(value) || 0);
    if (calories <= 1800) return plot.bottom - calories / 100 * unit;
    const overflow = Math.max(1, dailyTotal - 1800);
    return y1800 - Math.min(1, (calories - 1800) / overflow) * unit;
  };

  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = `${compact ? 6 : 7}px system-ui, sans-serif`;
  for (let step = 0; step <= 18; step += 1) {
    const y = plot.bottom - step * unit;
    ctx.strokeStyle = step === 0 || step === 18 ? '#d3cec5' : '#e9e5de';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(plot.left, y); ctx.lineTo(plot.right, y); ctx.stroke();
    ctx.fillStyle = '#88847c';
    ctx.fillText(String(step * 100), plot.left - 4, y);
  }
  ctx.strokeStyle = '#d3cec5';
  ctx.beginPath(); ctx.moveTo(plot.left, plot.top); ctx.lineTo(plot.right, plot.top); ctx.stroke();
  ctx.font = `${compact ? 5.5 : 6}px system-ui, sans-serif`;
  ctx.fillStyle = '#8A1C1C';
  ctx.fillText('>1800', plot.left - 4, plot.top + unit / 2);

  const barX = plot.left + Math.max(28, (plot.right - plot.left) * .12);
  const barWidth = Math.min(64, Math.max(38, (plot.right - plot.left) * .2));
  let cumulative = 0;
  chartBars = groups.map((group) => {
    const start = cumulative;
    cumulative += group.total;
    const visibleEnd = Math.min(cumulative, visibleTotal);
    const y = yFor(Math.max(start, visibleEnd));
    const bottom = yFor(start);
    const rawHeight = Math.max(0, bottom - y);
    const gap = Math.min(1.5, rawHeight * .18);
    return { ...group, x: barX, y: y + gap / 2, width: barWidth, height: Math.max(0, rawHeight - gap), start, end: cumulative, fullyVisible: visibleEnd >= cumulative };
  }).filter((bar) => bar.height > .25);

  chartBars.forEach((bar) => {
    const radius = 7;
    ctx.fillStyle = colorForCalories(bar.total);
    roundedBarPath(ctx, bar.x, bar.y, bar.width, bar.height, radius);
    ctx.fill();
    const isTarget = pointerState?.dragging && pointerState.targetId === bar.id;
    const isSelected = selectedGroupId === bar.id;
    if (isTarget || isSelected) {
      ctx.strokeStyle = isTarget ? '#ffffff' : '#24231f';
      ctx.lineWidth = isTarget ? 4 : 2;
      roundedBarPath(ctx, bar.x - 2, bar.y - 2, bar.width + 4, bar.height + 4, radius + 2);
      ctx.stroke();
    }
  });

  if (pointerState?.dragging) {
    const source = chartBars.find((bar) => bar.id === pointerState.sourceId);
    if (source) {
      const ghostY = Math.max(plot.top, Math.min(plot.bottom - source.height, pointerState.currentY - source.height / 2));
      ctx.save();
      ctx.globalAlpha = .72;
      ctx.fillStyle = colorForCalories(source.total);
      roundedBarPath(ctx, source.x, ghostY, source.width, source.height, 7);
      ctx.fill();
      ctx.restore();
    }
  }

  const labelX = barX + barWidth + 12;
  const labels = chartBars.filter((bar) => bar.fullyVisible)
    .map((bar) => ({ bar, desired: bar.y + bar.height / 2, y: bar.y + bar.height / 2 }))
    .sort((first, second) => first.desired - second.desired);
  const minGap = compact ? 15 : 17;
  labels.forEach((label, index) => {
    if (index) label.y = Math.max(label.y, labels[index - 1].y + minGap);
  });
  if (labels.length && labels.at(-1).y > plot.bottom - 5) {
    const shift = labels.at(-1).y - (plot.bottom - 5);
    labels.forEach((label) => { label.y -= shift; });
  }
  if (labels.length && labels[0].y < plot.top + 5) {
    const shift = plot.top + 5 - labels[0].y;
    labels.forEach((label) => { label.y += shift; });
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `${compact ? 8.5 : 9.5}px system-ui, sans-serif`;
  labels.forEach(({ bar, y }) => {
    ctx.strokeStyle = '#c9c4bb';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(bar.x + bar.width + 2, bar.y + bar.height / 2); ctx.lineTo(labelX - 3, y); ctx.stroke();
    const food = foodLabelForGroup(bar) || '未填写名称';
    const suffix = bar.merged ? `（合并${bar.entries.length}条）` : '';
    ctx.fillStyle = '#88847c';
    ctx.fillText(`${food} · ${bar.total} kcal${suffix}`, labelX, y, Math.max(30, plot.right - labelX));
  });

  const selected = chartBars.find((bar) => bar.id === selectedGroupId);
  if (selected) {
    const foodText = foodLabelForGroup(selected) || '未填写食物名称';
    elements.chartTooltip.textContent = `${foodText} ｜ ${selected.total} kcal${selected.merged ? ` ｜ 已合并${selected.entries.length}条` : ''}`;
    elements.chartTooltip.hidden = false;
  }
}

function animateChartGrowth(fromTotal, toTotal) {
  if (chartAnimation) cancelAnimationFrame(chartAnimation);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || toTotal <= fromTotal) {
    renderChart();
    return;
  }
  const startTime = performance.now();
  const duration = 760;
  const frame = (now) => {
    const progress = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    renderChart(fromTotal + (toTotal - fromTotal) * eased);
    if (progress < 1) chartAnimation = requestAnimationFrame(frame);
    else chartAnimation = null;
  };
  chartAnimation = requestAnimationFrame(frame);
}

function chartPoint(event) {
  const rect = elements.chart.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function hitChartBar(point) {
  return chartBars.find((bar) => point.x >= bar.x - 8 && point.x <= bar.x + bar.width + 8 && point.y >= bar.y - 4 && point.y <= bar.y + bar.height + 4);
}

function startChartInteraction(event) {
  const hit = hitChartBar(chartPoint(event));
  if (!hit) { selectedGroupId = null; renderChart(); return; }
  elements.chart.setPointerCapture?.(event.pointerId);
  const point = chartPoint(event);
  pointerState = { pointerId: event.pointerId, sourceId: hit.id, targetId: null, startX: event.clientX, startY: event.clientY, currentY: point.y, dragging: false, longPressed: false };
  clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => {
    if (!pointerState || pointerState.dragging) return;
    pointerState.longPressed = true;
    splitGroup(pointerState.sourceId);
  }, 650);
}

function moveChartInteraction(event) {
  if (!pointerState || pointerState.pointerId !== event.pointerId) return;
  const distance = Math.hypot(event.clientX - pointerState.startX, event.clientY - pointerState.startY);
  if (distance > 8 && !pointerState.longPressed) {
    pointerState.dragging = true;
    clearTimeout(longPressTimer);
    const point = chartPoint(event);
    pointerState.currentY = point.y;
    const target = hitChartBar(point);
    pointerState.targetId = target && target.id !== pointerState.sourceId ? target.id : null;
    renderChart();
  }
}

function endChartInteraction(event) {
  if (!pointerState || pointerState.pointerId !== event.pointerId) return;
  clearTimeout(longPressTimer);
  const action = pointerState;
  pointerState = null;
  if (action.dragging && action.targetId) mergeGroups(action.sourceId, action.targetId);
  else if (!action.longPressed) { selectedGroupId = action.sourceId; renderChart(); }
  else renderChart();
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('is-visible');
  toastTimer = setTimeout(() => elements.toast.classList.remove('is-visible'), 1900);
}

elements.statsFoodCalories.addEventListener('input', updateStatsSaveButton);
elements.statsQuickEntry.addEventListener('submit', saveStatsRecord);
elements.todayRecords.addEventListener('click', (event) => {
  const deleteButton = event.target.closest('[data-delete]');
  if (deleteButton) { deleteRecord(deleteButton.dataset.delete); return; }
  const editButton = event.target.closest('[data-edit]');
  if (editButton) openRecordEditor(editButton.dataset.edit);
});
elements.editRecordForm.addEventListener('submit', saveEditedRecord);
document.querySelectorAll('[data-close-edit]').forEach((button) => button.addEventListener('click', () => {
  editingId = null;
  elements.editRecordDialog.close();
}));
document.querySelector('#previous-day').addEventListener('click', () => moveStatsDay(-1));
elements.nextDay.addEventListener('click', () => moveStatsDay(1));
elements.statsDateInput.addEventListener('change', () => {
  if (!elements.statsDateInput.value) return;
  statsDate = elements.statsDateInput.value;
  selectedGroupId = null;
  rememberUiState();
  renderHome();
  renderChart();
});
elements.chart.addEventListener('pointerdown', startChartInteraction);
elements.chart.addEventListener('pointermove', moveChartInteraction);
elements.chart.addEventListener('pointerup', endChartInteraction);
elements.chart.addEventListener('pointercancel', endChartInteraction);
elements.chart.addEventListener('contextmenu', (event) => event.preventDefault());
elements.chart.addEventListener('selectstart', (event) => event.preventDefault());
elements.chart.addEventListener('dragstart', (event) => event.preventDefault());

if ('ResizeObserver' in window) {
  const resizeObserver = new ResizeObserver(() => renderChart());
  resizeObserver.observe(elements.chartWrap);
} else {
  window.addEventListener('resize', renderChart);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) rememberUiState();
  else {
    if (statsDate > dateKey(new Date())) statsDate = dateKey(new Date());
    renderChart();
  }
});
window.addEventListener('pagehide', rememberUiState);
window.addEventListener('pageshow', renderChart);

renderHome();
updateStatsSaveButton();
requestAnimationFrame(renderChart);
