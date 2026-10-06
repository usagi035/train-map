/* ===========================================================================
   画面側の共通状態と、その状態を動かす共通の操作。画面の各モジュールはここからのみ import する(循環を避ける)。
   (元は src/ui/renderer.js の1ファイル。指示書 §8〜§12 に沿って画面側を分割した)
   =========================================================================== */
import { S, G, mw, mh, clamp, mkMap, findStationIn, linesOfIn } from '../core/model.js';
import { dist, segPt } from '../core/geometry.js';
import { createCore } from '../core/operations.js';

// 状態の読み書き・編集操作はすべて core 経由(画面が直接書き換えない。指示書 §6/§7)
export const core = createCore();

// HTMLエスケープ(画面表示のための都合なので core には置かない)
export const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export const HINTS = {
  select:   '駅・バス停・道路をドラッグして移動 / 空白をドラッグして□で複数選択→Deleteで一括削除 / Deleteキーで削除 / Space+ドラッグで画面移動',
  station:  'クリックで駅を追加(線の上なら間に挿入) / 既存の駅をクリックすると追加せず、選択・移動へ自動で切り替わる',
  hub:      'クリックで乗り換え駅を追加(どの路線にも属さない独立駅。左のクイック操作パネルで路線に組み込める)',
  crossing: '線の近くをクリックして踏切を置く',
  busstop:  'クリックでバス停を配置(幹線道路とは独立して置けます)',
  terminal: 'クリックでバスターミナルを配置',
  road:     'クリックで頂点を追加 / Enterで確定 / Escで中止 / 最初の頂点で閉じる',
  box:      'ドラッグで四角形(ラベル枠)を追加。クリックだけなら標準サイズ'
};

/* ---------- 状態の読み込み(localStorage の読み書きは画面側の責務) ---------- */
let stored = null;
try { stored = JSON.parse(localStorage.getItem('railmaps')); } catch (e) {}
if (!stored || !Array.isArray(stored.maps) || !stored.maps.length) stored = { maps: [mkMap('路線図 1')] };
core.importDocument(stored);

export let ui = { map: S.maps[0].id, line: S.maps[0].lines[0].id, sel: null, tool: 'select', open: S.maps.map(m => m.id), home: false, zoom: 1, drawing: null, bulk: [], bulkRect: null, bulkMap: null };
const hm = S.maps.find(m => m.id === decodeURIComponent(location.hash.slice(1)));   // 別ウィンドウで開いたときの路線図
if (hm) { ui.map = hm.id; ui.line = hm.lines[0].id; ui.open = [hm.id]; }
else {
  try { const o = JSON.parse(localStorage.getItem('railopen')); if (Array.isArray(o)) ui.open = o.filter(id => S.maps.some(m => m.id === id)); } catch (e) {}
  const om = S.maps.find(m => m.id === ui.open[0]);
  if (om) { ui.map = om.id; ui.line = om.lines[0].id; } else ui.home = true;
}

/* ---------- いま開いている路線図・路線(画面側の現在位置) ---------- */
export const curMap  = () => S.maps.find(m => m.id === ui.map) || S.maps[0];
export const curLine = () => { const m = curMap(); return m.lines.find(l => l.id === ui.line) || m.lines[0]; };
// 駅を探す(路線のstationsにも、路線に属さない乗り換え駅のm.hubsにも入っている)
export const findStation = id => findStationIn(curMap(), id);
// その駅が属する路線(0〜複数。乗り換え駅は0本のこともある)
export const linesOf = id => linesOfIn(curMap(), id);

/* ---------- 履歴 (元に戻す / やり直す) ---------- */
export const viewNow = () => ({ map: ui.map, line: ui.line });
let saveTimer = 0;
let quotaWarned = false;   // 保存失敗の注意は1セッションに1回だけ表示
export function updateUndoButtons() {
  const u = document.getElementById('undo'), r = document.getElementById('redo');
  if (u) u.disabled = !core.canUndo();
  if (r) r.disabled = !core.canRedo();
}
// 保存しつつ、変更前の状態を履歴に積む
export const save = () => {
  clearTimeout(saveTimer); saveTimer = 0;
  const now = core.commit(viewNow());   // 変化が無ければ null(そのときは保存もしない)
  if (!now) return;
  try { localStorage.setItem('railmaps', now); } catch (e) {
    // 保存できないと黙っていると消えてしまうので注意を出す(画像を取り込むと容量上限に当たりやすい)
    console.warn('自動保存に失敗しました:', e);
    if (!quotaWarned) {
      quotaWarned = true;
      alert('自動保存に失敗しました。\n保存領域の上限に達した可能性があります。\n画像が大きい場合は削除するか、「書き出し」でJSONをバックアップしてください。');
    }
  }
  updateUndoButtons();
};
// 文字入力やスライダーは、連続入力をまとめて1回の履歴にする
export const deferSave = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = 0; save(); }, 600);
};
// 読み込んだ文書ごとに画面の状態をまとめて入れ替える(JSONの読み込み・別ウィンドウとの同期で使う)
export function replaceUi(next) { ui = next; }
core.resetHistory(viewNow());
/* ---------- マウスの□(矩形)で複数選択 ---------- */
export const BAND_COLOR = '#2f7d64';
// 矩形選択でまとめて選んだ要素 {t,id} の一括分。別地図のときは無効扱い
export const getBulk = () => (ui.bulk && ui.bulk.length && ui.bulkMap === ui.map) ? ui.bulk : [];
export const clearBulk = () => { ui.bulk = []; ui.bulkRect = null; ui.bulkMap = null; };
export const rectOf = (a, z) => ({ x0: Math.min(a.x, z.x), y0: Math.min(a.y, z.y), x1: Math.max(a.x, z.x), y1: Math.max(a.y, z.y) });
// 中心が矩形に入っていれば選択(少し余裕を持たせる)
export const inBox = (p, b, pad) => p.x >= b.x0 - pad && p.x <= b.x1 + pad && p.y >= b.y0 - pad && p.y <= b.y1 + pad;
/* ---------- レイヤー(表示/非表示・重ね順・編集ロック) ---------- */
// 種類ごとの表示/非表示(幹線道路・バス停・ラベル枠・画像)
export const showEl = (m, k) => !m.show || m.show[k] !== false;
// 駅がロック中の路線に属しているか(属している路線の1つでもロック中ならロック)
export const isStationLocked = s => linesOf(s.id).some(l => l.lock);
// クリック対象がロック中(編集できない)の要素か
export function hitLocked(el) {
  if (!el) return false;
  if (el.dataset.t === 'st' || el.dataset.t === 'stname') {
    const s = findStation(el.dataset.id); return !!s && isStationLocked(s);
  }
  if (el.dataset.t === 'cx') {
    const o = curMap().lines.find(x => x.crossings.some(c => c.id === el.dataset.id));
    return !!o && !!o.lock;
  }
  return false;
}
// 表示設定を変えたあと、選択中の要素がまだ見えているか
export function selVisible(sel) {
  if (!sel) return true;
  const m = curMap();
  if (sel.t === 'st') {
    const s = findStation(sel.id); if (!s) return false;
    const ls = linesOf(sel.id);
    return !ls.length || ls.some(x => !x.hidden);   // 路線外の乗り換え駅は常に表示
  }
  if (sel.t === 'cx') { const o = m.lines.find(x => x.crossings.some(c => c.id === sel.id)); return !!o && !o.hidden; }
  if (sel.t === 'road') return showEl(m, 'road');
  if (sel.t === 'stop') return showEl(m, 'stop');
  if (sel.t === 'bx') return showEl(m, 'box');
  if (sel.t === 'img') return showEl(m, 'img');
  return true;
}
// 非表示・ロック中の路線には駅や踏切を追加できない(理由を出して戻す)
export function lineEditBlocked() {
  const l = curLine();
  if (l.lock) { alert('「' + l.name + '」はロック中です。\n右パネルの 🔒 を解除すると編集できます。'); return true; }
  if (l.hidden) { alert('「' + l.name + '」は非表示です。\n右パネルの 👁 で表示に戻すと追加できます。'); return true; }
  return false;
}
// 矩形に重なる要素を集める(駅・乗り換え駅・バス停・踏切・ラベル枠・幹線道路)
export function pickInBox(m, b) {
  const hit = [], has = id => hit.some(x => x.id === id);
  // 非表示・ロック中の路線は選択対象にしない
  m.lines.forEach(l => {
    if (l.hidden || l.lock) return;
    l.stations.forEach(s => { if (!has(s.id) && !isStationLocked(s) && inBox(s, b, 12)) hit.push({ t: 'st', id: s.id }); });
  });
  (m.hubs || []).forEach(s => { if (!has(s.id) && inBox(s, b, 12)) hit.push({ t: 'st', id: s.id }); });
  if (showEl(m, 'stop')) (m.stops || []).forEach(s => { if (!has(s.id) && inBox(s, b, 14)) hit.push({ t: 'stop', id: s.id }); });
  m.lines.forEach(l => {
    if (l.hidden || l.lock) return;
    l.crossings.forEach(c => {
      if (l.stations.length < 2 || has(c.id)) return;
      const p = segPt(l, c.seg, c.t);
      if (inBox(p, b, 16)) hit.push({ t: 'cx', id: c.id });
    });
  });
  if (showEl(m, 'box')) (m.boxes || []).forEach(x => {
    if (x.x + x.w >= b.x0 && x.x <= b.x1 && x.y + x.h >= b.y0 && x.y <= b.y1) hit.push({ t: 'bx', id: x.id });
  });
  if (showEl(m, 'img')) (m.images || []).forEach(x => {
    if (x.x + x.w >= b.x0 && x.x <= b.x1 && x.y + x.h >= b.y0 && x.y <= b.y1) hit.push({ t: 'img', id: x.id });
  });
  if (showEl(m, 'road')) (m.roads || []).forEach(r => {
    if (!r.pts.length || has(r.id)) return;
    const inAll = r.pts.every(p => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1);
    if (inAll || r.pts.some(p => inBox(p, b, 8))) hit.push({ t: 'road', id: r.id });
  });
  return hit;
}
export function renderTools() {
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === ui.tool));
  document.getElementById('hint').textContent = HINTS[ui.tool] || '';
  document.getElementById('cv').style.cursor = ui.tool === 'select' ? 'default' : 'crosshair';
  updateUndoButtons();
}
/* ---------- 再描画(画面の各モジュールが自分の描画関数を登録する) ---------- */
const parts = {};   // { tabs, home, canvas, side, left }
export function setRender(fns) { Object.assign(parts, fns); }
// 1つだけ描き直す(全体を描き直すと入力中の欄が作り直されるため)
export function renderPart(name) { if (parts[name]) parts[name](); }
export function renderAll() {
  const home = ui.home;
  document.getElementById('stage').style.display = home ? 'none' : '';
  document.getElementById('side').style.display = home ? 'none' : '';
  document.getElementById('left').style.display = home ? 'none' : '';
  document.getElementById('quick').style.display = home ? 'none' : '';
  document.getElementById('tools').style.display = home ? 'none' : '';
  document.getElementById('hint').style.display = home ? 'none' : '';
  document.getElementById('home').style.display = home ? 'block' : 'none';
  renderPart('tabs');
  if (home) { renderPart('home'); return; }
  renderTools(); renderPart('canvas'); renderPart('side'); renderPart('left');
}
/* --- 幹線道路(独立要素・頂点をクリックして引く) --- */
export function startRoadDrawing() {
  core.setShow(curMap(), 'road', true);   // 非表示でも引くときは表示に戻す
  ui.drawing = { pts: [], hover: null };
  save(); renderAll();
}
export function finishRoad() {
  const d = ui.drawing; ui.drawing = null;
  if (d && d.pts.length >= 2) {
    const r = core.addRoad(curMap(), d.pts);
    ui.sel = { t: 'road', id: r.id };
    ui.tool = 'select';
    save();
  } else {
    ui.tool = 'select';   // 頂点不足なら中止
  }
  renderAll();
}
export function cancelRoad() { ui.drawing = null; ui.tool = 'select'; renderAll(); }
export function addRoadPoint(p) {
  const m = curMap();
  core.ensureRoom(m, p.x, p.y);
  const snap = snapOn();
  const q = { x: clamp(snap ? Math.round(p.x / G) * G : Math.round(p.x), 0, mw(m)), y: clamp(snap ? Math.round(p.y / G) * G : Math.round(p.y), 0, mh(m)) };
  const d = ui.drawing;
  // 最初の頂点付近をクリックしたら閉じて確定
  if (d.pts.length >= 2 && dist(d.pts[0], q) < 14) { finishRoad(); return; }
  d.pts.push(q);
  updateRoadHint();
  renderPart('canvas');
}
// 描画中にいることを下のヒントに表示する
export function updateRoadHint() {
  const n = ui.drawing ? ui.drawing.pts.length : 0;
  document.getElementById('hint').textContent =
    n ? `頂点を${n}個配置 — Enterで確定 / Ctrl+Zで1つ戻す / Escで中止` : HINTS.road;
}
// 1つの要素を削除(□で選んだ複数をまとめて削除するときも使う)
export function delOne(sel) { core.deleteElement({ map: curMap(), sel, fallbackLine: curLine() }); }
export function del() {
  const bulk = getBulk();
  if (bulk.length) {   // □で選んだ複数をまとめて削除
    const items = bulk.slice();
    clearBulk(); ui.sel = null;
    items.forEach(delOne);
    save(); renderAll();
    return;
  }
  if (!ui.sel) return;
  delOne(ui.sel);
  ui.sel = null; save(); renderAll();
}
/* ---------- クイック操作パネルの2つの設定(画面だけの状態・保存しない) ----------
   もとはツールバーのチェックボックス(#snap / #autosel)。クイック操作パネルは描き直しが多いので、
   値の本体は DOM ではなくここに持たせ、renderQuick() がその都度 checked に反映する。 */
let snapSetting = true, autoselSetting = true;
export const snapOn = () => snapSetting;         // グリッドに合わせる
export const autoselOn = () => autoselSetting;   // 追加後に選択へ戻る
export const setSnap = v => { snapSetting = !!v; };
export const setAutosel = v => { autoselSetting = !!v; };
export const snapPt = p => snapOn() ? { x: Math.round(p.x / G) * G, y: Math.round(p.y / G) * G } : p;
/* ---------- 「画像を変更」で差し替える対象(未指定なら新規追加) ---------- */
// 右パネルが指定し、ツールバー側の読み込みが受け取る(2つのモジュールが共有する小さな状態)
export const imgPick = { replaceId: null };
