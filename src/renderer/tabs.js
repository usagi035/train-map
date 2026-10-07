/* ===========================================================================
   タブと路線図の一覧(ホーム)の描画と操作。
   (元は src/ui/renderer.js の1ファイル。指示書 §8〜§12 に沿って画面側を分割した)
   =========================================================================== */
import { S } from '../core/model.js';
import { core, ui, esc, idf, curMap, viewNow, save, renderAll } from './ui-state.js';
import { KEYS } from './storage.js';

export function renderTabs() {
  document.getElementById('tabs').innerHTML =
    ui.open.map(id => S.maps.find(m => m.id === id)).filter(Boolean).map(m =>
      `<div class="tab ${m.id === ui.map && !ui.home ? 'on' : ''}"><span data-id="${idf(m.id)}">${esc(m.name)}</span><button class="x" data-x="${idf(m.id)}" title="閉じる (Alt+W)" aria-label="閉じる">✕</button></div>`).join('') +
    '<button id="addmap" title="路線図を追加">＋</button><button id="listbtn" title="路線図の一覧">一覧</button>';
}
export function renderHome() {
  document.getElementById('home').innerHTML = '<h2>路線図</h2><ul>' +
    S.maps.map(m => `<li><span>${esc(m.name)}</span><span class="st">${ui.open.includes(m.id) ? '開いています' : ''}</span><button data-open="${idf(m.id)}">開く</button><button data-del="${idf(m.id)}">削除</button></li>`).join('') +
    '</ul><button id="hnew">新しい路線図</button>';
}

// 開いているタブの並びは表示だけの設定(文書本体ではない)。書けなくても内容は失われないので
// 握りつぶす。文書本体の保存失敗は ui-state の save() が必ず知らせる(S5)。
export function persistOpen() { if (!location.hash) try { localStorage.setItem(KEYS.open, JSON.stringify(ui.open)); } catch (e) {} }

function openMap(id) {
  if (!ui.open.includes(id)) ui.open.push(id);
  ui.map = id; ui.line = curMap().lines[0].id; ui.sel = null; ui.home = false;
  core.syncView(viewNow()); persistOpen(); renderAll();
}
function closeTab(id) {
  const i = ui.open.indexOf(id); if (i < 0) return;
  ui.open.splice(i, 1);
  if (ui.map === id) {
    const n = ui.open[Math.min(i, ui.open.length - 1)];
    if (n) { ui.map = n; ui.line = curMap().lines[0].id; ui.sel = null; } else ui.home = true;
  }
  core.syncView(viewNow()); persistOpen(); renderAll();
}
function newMap() { const m = core.addMap('路線図 ' + (S.maps.length + 1)); save(); openMap(m.id); }
export function deleteMap(id) {
  core.deleteMap(id);
  save();                       // 表示を切り替える前に履歴へ(削除前の路線図に戻せるように)
  ui.open = ui.open.filter(x => x !== id);
  if (ui.map === id) {
    if (ui.open.length) { ui.map = ui.open[0]; ui.line = curMap().lines[0].id; ui.sel = null; } else ui.home = true;
  }
  core.syncView(viewNow()); persistOpen(); renderAll();
}
// Alt+W から呼ばれる。true=路線図を閉じた(タブは閉じない) / false=開いている路線図がないのでウィンドウを閉じてよい
window.__closeTab = () => {
  if (ui.home) { if (ui.open.length) { ui.home = false; renderAll(); return true; } return false; }
  closeTab(ui.map); return true;
};
document.getElementById('tabs').addEventListener('click', e => {
  const x = e.target.closest('[data-x]'), t = e.target.closest('[data-id]');
  if (x) closeTab(x.dataset.x);
  else if (t) openMap(t.dataset.id);
  else if (e.target.closest('#addmap')) newMap();
  else if (e.target.closest('#listbtn')) { ui.home = true; renderAll(); }
});
document.getElementById('home').addEventListener('click', e => {
  const o = e.target.closest('[data-open]'), d = e.target.closest('[data-del]');
  if (o) openMap(o.dataset.open);
  else if (d) {
    const m = S.maps.find(x => x.id === d.dataset.del);
    if (m && confirm('「' + m.name + '」を削除しますか?')) deleteMap(m.id);
  } else if (e.target.id === 'hnew') newMap();
});
