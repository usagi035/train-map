/* ===========================================================================
   タブと路線図の一覧(ホーム)の描画と操作。
   (元は src/ui/renderer.js の1ファイル。指示書 §8〜§12 に沿って画面側を分割した)
   =========================================================================== */
import { S, allStations } from '../core/model.js';
import { core, ui, esc, idf, curMap, viewNow, save, renderAll, mapUpdated, touchMap, forgetMap } from './ui-state.js';
import { LIMITS } from '../core/sanitize.js';
import { KEYS } from './storage.js';
import { toast } from './toast.js';

export function renderTabs() {
  document.getElementById('tabs').innerHTML =
    ui.open.map(id => S.maps.find(m => m.id === id)).filter(Boolean).map(m =>
      `<div class="tab ${m.id === ui.map && !ui.home ? 'on' : ''}"><span data-id="${idf(m.id)}">${esc(m.name)}</span><button class="x" data-x="${idf(m.id)}" title="閉じる (Alt+W)" aria-label="閉じる">✕</button></div>`).join('') +
    '<button id="addmap" title="路線図を追加">＋</button><button id="listbtn" title="路線図の一覧">一覧</button>';
}
/* ---------- 一覧に出す情報(U5: 件数と最終更新) ---------- */
// 時刻はロケールに左右されないよう、自分で組み立てる
const fmtTime = t => {
  const d = new Date(t), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
// 件数。0件の種類は出さない(行が横に伸びてしまうため)。駅は乗り換え駅・路線外駅も含む
function describeMap(m) {
  const parts = [`路線 ${m.lines.length}`, `駅 ${allStations(m).length}`];
  if ((m.stops || []).length) parts.push(`バス停 ${m.stops.length}`);
  if ((m.roads || []).length) parts.push(`幹線道路 ${m.roads.length}`);
  if ((m.boxes || []).length) parts.push(`ラベル枠 ${m.boxes.length}`);
  if ((m.images || []).length) parts.push(`画像 ${m.images.length}`);
  const t = mapUpdated(m.id);
  return parts.join(' ・ ') + (t ? ` ・ 最終更新 ${fmtTime(t)}` : '');
}
export function renderHome() {
  document.getElementById('home').innerHTML = '<h2>路線図</h2><ul>' +
    S.maps.map(m => `<li data-row="${idf(m.id)}"><span class="hname">${esc(m.name)}</span><span class="st">${
      ui.open.includes(m.id) ? '開いています' : ''}</span><button data-open="${idf(m.id)}">開く</button><button data-dup="${idf(m.id)}" title="この路線図を丸ごとコピーする">複製</button><button data-ren="${idf(m.id)}" title="名前を変更">名前を変更</button><button data-del="${idf(m.id)}">削除</button><span class="meta">${describeMap(m)}</span></li>`).join('') +
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
function newMap() { const m = core.addMap('路線図 ' + (S.maps.length + 1)); save(m.id); openMap(m.id); }
// U2: 削除は取り消せる。消した直後に「取り消し」を押せるよう、メモリにだけ1件覚えておく
let trashed = null;   // { map, index, dropId, wasOpen }

export function deleteMap(id) {
  const gone = S.maps.find(x => x.id === id);
  trashed = gone ? { map: JSON.parse(JSON.stringify(gone)), index: S.maps.indexOf(gone),
                     dropId: null, wasOpen: ui.open.includes(id) } : null;
  const dropId = core.deleteMap(id);   // 最後の1つを消したときは代わりに作られた路線図のID
  if (trashed) trashed.dropId = dropId;
  save(id);                     // 表示を切り替える前に履歴へ(削除前の路線図に戻せるように)
  forgetMap(id);                // 消した路線図の最終更新も消す(U5)
  if (dropId) touchMap(dropId); // 代わりに作った路線図にも記録を付ける
  ui.open = ui.open.filter(x => x !== id);
  if (ui.map === id) {
    if (ui.open.length) { ui.map = ui.open[0]; ui.line = curMap().lines[0].id; ui.sel = null; } else ui.home = true;
  }
  core.syncView(viewNow()); persistOpen(); renderAll();
  if (gone) toast('「' + gone.name + '」を削除しました', {
    key: 'delmap', ms: 8000,      // 取り消しは少し長めに押せるように
    actions: [{ label: '取り消し', onClick: restoreDeleted }],
  });
}
// 削除を取り消す(8秒以内なら押せる)。取り消したら消す場所を1件だけ保持する
function restoreDeleted() {
  if (!trashed) return;
  const t = trashed; trashed = null;
  if (!core.restoreMap(t.map, t.index, t.dropId)) return;
  save(t.map.id);   // 復元した路線図の最終更新として記録する(U5)
  if (t.wasOpen) openMap(t.map.id); else { persistOpen(); renderAll(); }
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
// 一覧の「複製」(U5): 中身を丸ごとコピーした路線図を作る。開いているタブは変えない
function duplicateMap(id) {
  const m = core.duplicateMap(id);
  if (!m) return;
  save(m.id);        // 複製した路線図の最終更新として記録する(U5)
  renderAll();
  toast(`「${m.name}」を作成しました`);
}
// 一覧の「名前を変更」(U5): ダイアログは出さず、その行だけを入力欄に入れ替える。
// Enter かフォーカスが外れたら確定、Esc で中止。一覧ごと描き直さない
// (描き直すと、いま押しているボタンの次のクリックが届かなくなるため)。
function startRename(id) {
  const m = S.maps.find(x => x.id === id);
  const row = document.querySelector(`#home li[data-row="${idf(id)}"]`);
  const name = row && row.querySelector('.hname');
  if (!m || !name || name.tagName === 'INPUT') return;   // すでに入力中なら何もしない
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'hname ren';
  inp.value = m.name;
  inp.maxLength = LIMITS.nameLen;
  inp.setAttribute('aria-label', '路線図の名前');
  name.replaceWith(inp);
  inp.focus();
  inp.select();
  let done = false;
  const finish = commit => {
    if (done) return;
    done = true;
    // 空の名前は受け付けない(= 名前を変えない)。長さは入力欄の maxLength でも制限している
    const v = inp.value.trim().slice(0, LIMITS.nameLen);
    const changed = !!(commit && v && v !== m.name && core.renameMap(m.id, v));
    if (changed) save(m.id);                 // 最終更新として記録する(U5)
    name.textContent = m.name;               // renameMap で変わっている
    inp.replaceWith(name);
    // 一覧ごとは描き直さず、変わった所だけ更新する(最終更新も今日付になる)
    const meta = row.querySelector('.meta');
    if (meta) meta.textContent = describeMap(m);
    if (changed) renderTabs();               // 開いているタブの名前も同時に更新
  };
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  inp.addEventListener('blur', () => finish(true));
}
document.getElementById('home').addEventListener('click', e => {
  const o = e.target.closest('[data-open]'), d = e.target.closest('[data-del]'),
        p = e.target.closest('[data-dup]'), r = e.target.closest('[data-ren]');
  if (o) openMap(o.dataset.open);
  else if (d) {
    const m = S.maps.find(x => x.id === d.dataset.del);
    // 削除はそのまま実行し、後から「取り消し」で戻せる(U2)
    if (m) deleteMap(m.id);
  }
  else if (p) duplicateMap(p.dataset.dup);
  else if (r) startRename(r.dataset.ren);
  else if (e.target.id === 'hnew') newMap();
});
