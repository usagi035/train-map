/* ===========================================================================
   左パネル(選択中の路線の駅リスト)の描画と並べ替え操作。
   (元は src/ui/renderer.js の1ファイル。指示書 §8〜§12 に沿って画面側を分割した)
   =========================================================================== */
import { core, ui, esc, curLine, save, renderAll, clearBulk } from './ui-state.js';
import { centerStation } from './canvas.js';

/* ---------- 左パネル: 選択中の路線の駅(並べ替え) ---------- */
function stationGlyph(s, l) {
  const c = s.color || l.color, sh = s.shape || 'circle';
  const body = sh === 'square' ? `<rect x="2" y="2" width="10" height="10" fill="${c}"/>`
    : sh === 'diamond' ? `<polygon points="7,1.5 12.5,7 7,12.5 1.5,7" fill="${c}"/>`
    : `<circle cx="7" cy="7" r="5" fill="${c}"/>`;
  return `<svg width="14" height="14" viewBox="0 0 14 14">${body}${sh === 'double' ? '<circle cx="7" cy="7" r="2.4" fill="#fff"/>' : ''}</svg>`;
}
// 選択中の路線の駅を、線を引く順(経路)に並べて表示
export function renderLeft() {
  const el = document.getElementById('left');
  if (ui.home) { el.innerHTML = ''; return; }
  const l = curLine();
  const rows = l.stations.map((s, i) => {
    const on = ui.sel && ui.sel.t === 'st' && ui.sel.id === s.id;
    return `<li data-id="${s.id}" draggable="true"${on ? ' class="on"' : ''}>` +
      `<span class="lhandle" title="ドラッグで並べ替え">⇅</span>` +
      stationGlyph(s, l) +
      `<span class="lname">${esc(s.name)}</span>` +
      (s.hub ? '<span class="badge" title="乗り換え駅">乗</span>' : '') +
      '<span class="lbtns">' +
        `<button class="sup" title="上へ移動"${i === 0 ? ' disabled' : ''}>↑</button>` +
        `<button class="sdown" title="下へ移動"${i === l.stations.length - 1 ? ' disabled' : ''}>↓</button>` +
      '</span></li>';
  }).join('');
  el.innerHTML = `<h3><i style="background:${l.color}"></i>${esc(l.name)} の駅` +
    (l.hidden ? ' <span style="font-size:11px;opacity:.75">(非表示)</span>' : '') +
    (l.lock ? ' <span style="font-size:11px;opacity:.75">(ロック中)</span>' : '') + '</h3>' +
    '<p class="note">上から順に線を引く経路です。↑↓ボタンかドラッグで並べ替えると線の形が変わります(踏切は位置を保ちます)。行をクリックするとその駅を選択して表示を移動します</p>' +
    (l.stations.length ? `<ul class="linklist" id="stlist">${rows}</ul>` : '<p class="note">まだ駅がありません</p>');
}
// 駅の並べ替え(踏切が指す区間を保てるよう core 側で keepCrossings してから入れ替える)
function moveStation(l, from, to) {
  core.moveStationInLine(l, from, to);
  save(); renderAll();
}

/* ---------- 左パネル: 駅の並べ替え(↑↓ボタン / ドラッグ) ---------- */
const leftEl = document.getElementById('left');
let stDrag = null;
const stRow = e => (e.target && e.target.closest) ? e.target.closest('#stlist li') : null;
leftEl.addEventListener('click', e => {
  const row = stRow(e); if (!row) return;
  const l = curLine(), i = l.stations.findIndex(s => s.id === row.dataset.id);
  if (i < 0) return;
  const b = e.target.closest('button');
  if (b && b.classList.contains('sup') && i > 0) { moveStation(l, i, i - 1); return; }
  if (b && b.classList.contains('sdown') && i < l.stations.length - 1) { moveStation(l, i, i + 1); return; }
  if (b) return;
  ui.sel = { t: 'st', id: row.dataset.id };   // 行をクリック → その駅を選択して表示を移動
  clearBulk();
  renderAll();
  centerStation(l.stations[i]);
});
leftEl.addEventListener('dragstart', e => {
  const row = stRow(e); if (!row) return;
  stDrag = row.dataset.id; row.classList.add('dragging');
  try { e.dataTransfer.setData('text/plain', stDrag); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
});
leftEl.addEventListener('dragover', e => {
  const row = stRow(e); if (!row || !stDrag) return;
  e.preventDefault();
  try { e.dataTransfer.dropEffect = 'move'; } catch (err) {}
  row.classList.add('dropto');
});
leftEl.addEventListener('dragleave', e => { const row = stRow(e); if (row) row.classList.remove('dropto'); });
leftEl.addEventListener('drop', e => {
  const row = stRow(e); if (!row || !stDrag) return;
  e.preventDefault();
  const l = curLine();
  const from = l.stations.findIndex(s => s.id === stDrag), to = l.stations.findIndex(s => s.id === row.dataset.id);
  stDrag = null;
  if (from >= 0 && to >= 0 && from !== to) moveStation(l, from, to);
});
leftEl.addEventListener('dragend', () => {
  stDrag = null;
  leftEl.querySelectorAll('.dragging, .dropto').forEach(x => x.classList.remove('dragging', 'dropto'));
});
