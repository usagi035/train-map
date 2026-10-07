/* ===========================================================================
   画面側の入口。初期化・入力(マウス/キー/ファイル)・各モジュールの配線を担当する。
   (元は src/ui/renderer.js の1ファイル。指示書 §8〜§12 に沿って画面側を分割した)
   =========================================================================== */
import { S, G, mw, mh, clamp, mkMap, findStationIn, linesOfIn, lw, isDark, BG, SHAPES } from '../core/model.js';
import { dist } from '../core/geometry.js';
import { LIMITS, safeFilename } from '../core/sanitize.js';
import { core, ui, replaceUi, esc, curMap, curLine, findStation, linesOf, viewNow, updateUndoButtons,
         setRender,
         save, getBulk, clearBulk, rectOf, pickInBox, isStationLocked, hitLocked, lineEditBlocked,
         snapOn, autoselOn, snapPt, renderAll, renderTools, del, cancelRoad, finishRoad, startRoadDrawing,
         addRoadPoint, updateRoadHint, imgPick,
         keepLocalVersion, clearLocalAuthority, shouldAskRemote, setSaveFailed } from './ui-state.js';
import { cv, stage, pt, setZoom, renderCanvas, setBandSource } from './canvas.js';
import { renderSide } from './side-panel.js';
import { renderLeft } from './left-panel.js';
import { renderTabs, renderHome, persistOpen } from './tabs.js';
import { KEYS } from './storage.js';
import { setBanner, clearBanner, hasBanner } from './banner.js';
import { toast } from './toast.js';

// 履歴のスナップを画面へ適用する(表示中の路線図・路線を、そのときのものへ合わせ直す)
function applySnap(e) {
  // 状態そのものは core.undo() / core.redo() が入れ替え済み
  // ここは文書本体の保存なので、失敗は黙らず「保存失敗」の知らせへ回す(S5)
  try { localStorage.setItem(KEYS.maps, e.s); setSaveFailed(false); } catch (err) {
    console.warn('元に戻す/やり直し後の保存に失敗しました:', err);
    setSaveFailed(true);
  }
  const v = e.v || {};
  ui.open = ui.open.filter(id => S.maps.some(m => m.id === id));
  const mid = S.maps.some(m => m.id === v.map) ? v.map : S.maps[0].id;
  if (!ui.open.includes(mid)) ui.open.push(mid);
  ui.map = mid; ui.home = false;
  const m = curMap();
  ui.line = (v.line && m.lines.some(l => l.id === v.line)) ? v.line : m.lines[0].id;
  ui.sel = null; ui.drawing = null; clearBulk();   // 履歴を戻すと矩形選択も解除
  persistOpen();
  updateUndoButtons();
  renderAll();
}
function undo() {
  if (ui.drawing) {   // 道路の描画中は最後に置いた頂点を戻す(0個になったら中止)
    if (ui.drawing.pts.length) {
      ui.drawing.pts.pop(); ui.drawing.hover = null;
      if (!ui.drawing.pts.length) cancelRoad();
      else { updateRoadHint(); renderCanvas(); }
    } else cancelRoad();
    return;
  }
  const e = core.undo();
  if (e) applySnap(e);
}
function redo() {
  if (ui.drawing) return;
  const e = core.redo();
  if (e) applySnap(e);
}

/* ---------- editing: 操作そのものは core へ。ここは選択・履歴・再描画の受け持ち ---------- */
function addStation(p) {
  if (lineEditBlocked()) return;   // ロック中・非表示の路線には追加できない
  const st = core.addStation({ map: curMap(), line: curLine(), p, snap: snapOn() });
  ui.sel = { t: 'st', id: st.id };
  afterAdd(); save(); renderAll();
}
function addHubStation(p) {
  // どの路線にも属さない独立した乗り換え駅として置く(左のクイック操作パネルのチェックリストで路線に組み込める)
  const st = core.addHubStation({ map: curMap(), p, snap: snapOn() });
  ui.sel = { t: 'st', id: st.id };
  ui.tool = 'select';
  save(); renderAll();
}
/* --- バス停(独立要素) --- */
function addBusStop(p, kind) {
  const st = core.addBusStop({ map: curMap(), p, kind, snap: snapOn() });
  ui.sel = { t: 'stop', id: st.id };
  afterAdd(); save(); renderAll();
}

function addCrossing(p) {
  const res = core.addCrossing({ map: curMap(), p, snap: snapOn() });
  if (res.error === 'none') return;
  if (res.error) {   // ロック中・非表示の路線には追加できない(その場で直せるようにボタンも添える)
    const l = res.line, locked = res.error === 'locked';
    toast('「' + l.name + '」は' + (locked ? 'ロック中' : '非表示') + 'です。追加できません。', {
      key: 'line-blocked',
      actions: [{ label: locked ? 'ロックを解除' : '表示に戻す',
                  onClick: () => { core.update(l, locked ? { lock: false } : { hidden: false }); save(); renderAll(); } }],
    });
    return;
  }
  ui.line = res.line.id; ui.sel = { t: 'cx', id: res.crossing.id };
  afterAdd(); save(); renderAll();
}

function afterAdd() { if (autoselOn()) ui.tool = 'select'; }   // 追加後に選択へ戻る(クイック操作パネルのスイッチ)

stage.addEventListener('wheel', e => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  const r = stage.getBoundingClientRect();
  setZoom(ui.zoom * Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
let drag = null;
let band = null;   // 空白のドラッグで引く□(矩形選択)
let spaceDown = false, pan = null;   // Space+ドラッグ / 中ボタンで画面をスクロール
setBandSource(() => band);   // 描画へは画面が持つ□の状態を渡す

// 画面のパン(Space+ドラッグ または 中ボタンドラッグ。2本指のパンは下の movePinch() 側)
stage.addEventListener('pointerdown', e => {
  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    e.preventDefault();
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}   // ドラッグ中は指(カーソル)を受け取り続ける
    pan = { x: e.clientX, y: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop };
    stage.style.cursor = 'grabbing';
  }
});
window.addEventListener('pointermove', e => {
  if (!pan) return;
  stage.scrollLeft = pan.sl - (e.clientX - pan.x);
  stage.scrollTop = pan.st - (e.clientY - pan.y);
});
window.addEventListener('pointerup', () => {
  if (pan) { pan = null; stage.style.cursor = spaceDown ? 'grab' : ''; }
});

/* ---------- ポインタ入力(マウス / タッチ / ペン)(U1) ----------
   マウスは従来どおり「押した瞬間」に行動する。タッチ/ペンは、
   ① 追加する行動(駅・乗り換え・踏切・バス停・終点・道路・ラベル枠)は
      「動かずに離した(=タップ)」に実行 → 押した指のまま2本目が来たら取り消す
      (ピンチの開始と誤爆しないため)。
   ② 2本指 = 開いた距離でズーム、中点の移動でパン(Space+ドラッグと同じ scroll 操作)。
   ③ 押した指は `setPointerCapture` で canvas が受け取り続ける(画面外へ出ても追える)。 */
const pointers = new Map();   // pointerId → そのときのクライアント座標(マウスは対象外)
let pinch = null;             // 2本指の基準(距離・中点・スクロール位置・開始時のズーム)
let pendingAct = null;        // タッチで保留中の「追加する」行動
let lastTapAt = 0;            // タッチのダブルタップ(道路の確定 = マウスのダブルクリック相当)

// 追加する行動の置き場所。マウスは即、タッチ/ペンはタップ(離したとき)に実行する。
function actAt(e, fn) {
  if (e.pointerType === 'mouse') { fn(); return; }
  pendingAct = { fn, x: e.clientX, y: e.clientY, moved: false, at: Date.now() };
}
// 2本目が来たら、進行中の操作を確定して止めてからズーム/パンへ移る
function beginPinch() {
  if (band) finishBand();
  if (drag) { drag = null; save(); }
  pendingAct = null;
  const [a, b] = [...pointers.values()];
  pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
            sl: stage.scrollLeft, st: stage.scrollTop, z0: ui.zoom };
}
function movePinch() {
  if (!pinch) return;
  const [a, b] = [...pointers.values()];
  if (!a || !b) return;
  // 中点が動いた分だけパン(Space+ドラッグと同じ)
  stage.scrollLeft = pinch.sl - ((a.x + b.x) / 2 - pinch.cx);
  stage.scrollTop = pinch.st - ((a.y + b.y) / 2 - pinch.cy);
  // 開いた距離の比だけズーム(既存の setZoom を使う = マウスのズームと同じ挙動)
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  if (pinch.d > 8 && d > 8) {
    const r = stage.getBoundingClientRect();
    setZoom(pinch.z0 * (d / pinch.d), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
  }
}

cv.addEventListener('pointerdown', e => {
  if (e.button !== 0 || spaceDown) return;   // 中ボタン / Space押下中はパン処理へ
  // 押した指(マウス)を受け取り続ける。指がキャンバスの外へ出ても移動・離しを追える
  try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  if (e.pointerType !== 'mouse') {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { beginPinch(); return; }   // 2本目 → いまの操作を止めてズーム/パンへ
    if (pointers.size > 2) return;                      // 3本目以降は無視
  }
  const el = e.target.closest('[data-t]'), p = pt(e), m = curMap();
  clearBulk();   // クリックされた時点で矩形選択のまとまりは解除(下で□選択を始める場合はまた設定される)
  // ロック中の路線の駅・踏切は、どのツールでも選択・操作しない(誤操作防止)
  if (hitLocked(el)) { ui.sel = null; renderAll(); return; }
  if (ui.tool === 'station') {
    // 追加モード中に既存の駅(本体・駅名)をクリックしたら追加はしない。
    // その駅を選択した状態で「選択・移動」モードへ自動で切り替える(そのままドラッグすれば移動できる)
    const hit = el && (el.dataset.t === 'st' || el.dataset.t === 'stname') ? findStation(el.dataset.id) : null;
    if (hit) {
      const ls = linesOf(hit.id);
      if (ls.length && !ls.some(x => x.id === ui.line)) ui.line = ls[0].id;
      ui.sel = { t: 'st', id: hit.id };
      ui.tool = 'select';
      drag = el.dataset.t === 'stname'
        ? { t: 'stname', id: hit.id, ox: p.x - (hit.x + (hit.nameX || 0)), oy: p.y - (hit.y + (hit.nameY || 0)) }
        : { t: 'st', id: hit.id };
      renderAll();
      return;
    }
    actAt(e, () => addStation(p));
    return;
  }
  if (ui.tool === 'hub') { actAt(e, () => addHubStation(p)); return; }
  if (ui.tool === 'crossing') { actAt(e, () => addCrossing(p)); return; }
  if (ui.tool === 'busstop') { actAt(e, () => addBusStop(p, 'stop')); return; }
  if (ui.tool === 'terminal') { actAt(e, () => addBusStop(p, 'terminal')); return; }
  if (ui.tool === 'road') { actAt(e, () => { if (!ui.drawing) ui.drawing = { pts: [], hover: null }; addRoadPoint(p); }); return; }
  if (ui.tool === 'box') {
    actAt(e, () => {
      const b = core.addBox(m, snapPt(p));   // 既定サイズのラベル枠を追加
      ui.sel = { t: 'bx', id: b.id }; drag = { t: 'bxnew', id: b.id, a: { x: b.x, y: b.y }, p0: p };
      renderAll();
    });
    return;
  }
  // 選択モードで空白(または線)をドラッグ → □で複数選択
  if (ui.tool === 'select' && (!el || el.dataset.t === 'line')) {
    ui.sel = null;
    band = { a: p, b: p, moved: false, line: el && el.dataset.t === 'line' ? el.dataset.l : null };
    renderAll();
    return;
  }
  if (el && el.dataset.t === 'bxr') { ui.sel = { t: 'bx', id: el.dataset.id }; drag = { t: 'bxr', id: el.dataset.id }; }
  else if (el && el.dataset.t === 'imgr') { ui.sel = { t: 'img', id: el.dataset.id }; drag = { t: 'imgr', id: el.dataset.id }; }
  else if (el && (el.dataset.t === 'stname' || el.dataset.t === 'st')) {
    const s = findStation(el.dataset.id);
    if (s) {
      // 属する路線があればそれに合わせる(路線外の乗り換え駅なら、いま選んでいる路線のまま)
      const ls = linesOf(s.id);
      if (ls.length && !ls.some(x => x.id === ui.line)) ui.line = ls[0].id;
      ui.sel = { t: 'st', id: s.id };
      drag = el.dataset.t === 'stname'
        ? { t: 'stname', id: s.id, ox: p.x - (s.x + (s.nameX || 0)), oy: p.y - (s.y + (s.nameY || 0)) }
        : { t: 'st', id: s.id };
    }
  }
  else if (el && el.dataset.t === 'stopname') {
    const s = (m.stops || []).find(s => s.id === el.dataset.id);
    if (s) {
      ui.sel = { t: 'stop', id: s.id };
      drag = { t: 'stopname', id: s.id, ox: p.x - (s.x + (s.nameX || 0)), oy: p.y - (s.y + (s.nameY || 0)) };
    }
  }
  else if (el && el.dataset.t === 'roadpt') {
    ui.sel = { t: 'road', id: el.dataset.id };
    drag = { t: 'roadpt', id: el.dataset.id, i: +el.dataset.i };
  }
  else if (el && el.dataset.t === 'road') {
    const r = (m.roads || []).find(r => r.id === el.dataset.id);
    if (r && r.pts.length) {
      ui.sel = { t: 'road', id: r.id };
      drag = { t: 'road', id: r.id, ox: p.x - r.pts[0].x, oy: p.y - r.pts[0].y, start: r.pts.map(q => ({ x: q.x, y: q.y })) };
    }
  }
  else if (el && el.dataset.t === 'stop') {
    const s = (m.stops || []).find(s => s.id === el.dataset.id);
    if (s) { ui.sel = { t: 'stop', id: s.id }; drag = { t: 'stop', id: s.id, ox: p.x - s.x, oy: p.y - s.y }; }
  }
  else if (el && el.dataset.t === 'bx') {
    const b = m.boxes.find(b => b.id === el.dataset.id);
    ui.sel = { t: 'bx', id: b.id }; drag = { t: 'bx', id: b.id, ox: p.x - b.x, oy: p.y - b.y };
  }
  else if (el && el.dataset.t === 'img') {
    const im = (m.images || []).find(x => x.id === el.dataset.id);
    if (im) { ui.sel = { t: 'img', id: im.id }; drag = { t: 'img', id: im.id, ox: p.x - im.x, oy: p.y - im.y }; }
  }
  else if (el && el.dataset.t !== 'line') { if (el.dataset.l) ui.line = el.dataset.l; ui.sel = { t: el.dataset.t, id: el.dataset.id }; drag = { ...ui.sel }; }
  else if (el) { if (el.dataset.l) ui.line = el.dataset.l; ui.sel = null; }
  else ui.sel = null;
  renderAll();
});
window.addEventListener('pointermove', e => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size >= 2) { movePinch(); return; }   // 2本指 = パン + ズーム
  // タップにしていた指が動いたら「追加」は実行しない(誤爆防止)
  if (pendingAct && Math.hypot(e.clientX - pendingAct.x, e.clientY - pendingAct.y) > 8) pendingAct.moved = true;
  if (band) {   // □(矩形選択)を引いている間
    band.b = pt(e);
    if (!band.moved && Math.hypot(band.b.x - band.a.x, band.b.y - band.a.y) > 3) band.moved = true;
    renderCanvas();
    return;
  }
  if (!drag) return;
  const m = curMap(), l = curLine(), p = pt(e);
  if (drag.t === 'st') {
    const s = findStation(drag.id); if (!s) return;
    const q = snapPt(p);
    core.ensureRoom(m, q.x, q.y);
    // 乗り換え駅の場合はすべての路線の同じ駅も動かす(その判定も core 側)
    core.moveStationTo(m, s, clamp(q.x, 0, mw(m)), clamp(q.y, 0, mh(m)));
  } else if (drag.t === 'stname') {
    const s = findStation(drag.id); if (!s) return;
    const q = snapPt(p);
    core.update(s, { nameX: q.x - drag.ox - s.x, nameY: q.y - drag.oy - s.y });
  } else if (drag.t === 'cx') {
    const c = l.crossings.find(c => c.id === drag.id); if (!c) return;
    core.moveCrossingTo(l, c, p, snapOn());
  } else if (drag.t === 'stop') {
    const s = (m.stops || []).find(s => s.id === drag.id); if (!s) return;
    const q = snapPt({ x: p.x - drag.ox, y: p.y - drag.oy });
    core.ensureRoom(m, q.x, q.y);
    core.update(s, { x: clamp(q.x, 0, mw(m)), y: clamp(q.y, 0, mh(m)) });
  } else if (drag.t === 'stopname') {
    const s = (m.stops || []).find(s => s.id === drag.id); if (!s) return;
    const q = snapPt(p);
    core.update(s, { nameX: q.x - drag.ox - s.x, nameY: q.y - drag.oy - s.y });
  } else if (drag.t === 'road') {
    const r = (m.roads || []).find(r => r.id === drag.id); if (!r) return;
    const q = snapPt({ x: p.x - drag.ox, y: p.y - drag.oy });
    const dx = q.x - drag.start[0].x, dy = q.y - drag.start[0].y;
    const maxR = Math.max(...r.pts.map(pt => pt.x)) + dx, maxD = Math.max(...r.pts.map(pt => pt.y)) + dy;
    core.ensureRoom(m, maxR, maxD);
    r.pts.forEach((pt, i) => core.update(pt, { x: clamp(drag.start[i].x + dx, 0, mw(m)), y: clamp(drag.start[i].y + dy, 0, mh(m)) }));
  } else if (drag.t === 'roadpt') {
    const r = (m.roads || []).find(r => r.id === drag.id); if (!r) return;
    const q = snapPt(p);
    core.ensureRoom(m, q.x, q.y);
    core.update(r.pts[drag.i], { x: clamp(q.x, 0, mw(m)), y: clamp(q.y, 0, mh(m)) });
  } else if (drag.t === 'img') {
    const im = (m.images || []).find(x => x.id === drag.id); if (!im) return;
    const q = snapPt({ x: p.x - drag.ox, y: p.y - drag.oy });
    core.ensureRoom(m, q.x + im.w, q.y + im.h);
    core.update(im, { x: clamp(q.x, 0, Math.max(0, mw(m) - im.w)), y: clamp(q.y, 0, Math.max(0, mh(m) - im.h)) });
  } else if (drag.t === 'imgr') {
    const im = (m.images || []).find(x => x.id === drag.id); if (!im) return;
    const q = snapPt(p);
    core.ensureRoom(m, q.x, q.y);
    core.update(im, { w: Math.max(G, q.x - im.x), h: Math.max(G, q.y - im.y) });
  } else {
    const b = (m.boxes || []).find(b => b.id === drag.id); if (!b) return;
    if (drag.t === 'bx') { const q = snapPt({ x: p.x - drag.ox, y: p.y - drag.oy }); core.ensureRoom(m, q.x + b.w, q.y + b.h); core.update(b, { x: clamp(q.x, 0, mw(m) - b.w), y: clamp(q.y, 0, mh(m) - b.h) }); }
    else if (drag.t === 'bxr') { const q = snapPt(p); core.ensureRoom(m, q.x, q.y); core.update(b, { w: Math.max(G, q.x - b.x), h: Math.max(G, q.y - b.y) }); }
    else if (drag.t === 'bxnew') {
      if (!drag.moved && Math.hypot(p.x - drag.p0.x, p.y - drag.p0.y) < 4) return;
      drag.moved = true;
      const q = snapPt(p);
      core.ensureRoom(m, q.x, q.y);
      core.update(b, { x: Math.min(drag.a.x, q.x), y: Math.min(drag.a.y, q.y),
                       w: Math.max(G, Math.abs(q.x - drag.a.x)), h: Math.max(G, Math.abs(q.y - drag.a.y)) });
    }
  }
  renderCanvas(); renderSide();
});
// □のドラッグ確定:中に収まった要素をまとめて選択する(ドラッグしなかったクリックは従来どおり)
function finishBand() {
  const b = band; band = null;
  if (!b) return;
  if (!b.moved) {
    if (b.line) ui.line = b.line;   // 線を単にクリック → その路線を選択(従来どおり)
    ui.sel = null; clearBulk();
    renderAll(); return;
  }
  const r = rectOf(b.a, b.b), hit = pickInBox(curMap(), r);
  ui.sel = null;
  if (hit.length) { ui.bulk = hit; ui.bulkRect = r; ui.bulkMap = ui.map; }
  else clearBulk();
  renderAll();
}
// 指を離した(タップの確定) / ブラウザが操作を取り消した(pointercancel)
function endPointer(e, runTap) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;   // 2本いなくなったらズーム/パン終了
  if (runTap) {
    const a = pendingAct; pendingAct = null;
    if (a && !a.moved && Date.now() - a.at < 800) {   // 動いていない指 = タップ
      a.fn();
      // タッチのダブルタップ = マウスのダブルクリック相当(幹線道路の確定)
      if (ui.drawing && Date.now() - lastTapAt < 320) finishRoad();
      lastTapAt = Date.now();
    }
  } else {
    pendingAct = null;
  }
  if (band) { finishBand(); return; }
  if (!drag) return;
  const was = drag; drag = null; save();
  if (was.t === 'bxnew') { afterAdd(); renderAll(); }
}
window.addEventListener('pointerup', e => endPointer(e, true));
window.addEventListener('pointercancel', e => endPointer(e, false));
// 幹線道路ツール: マウス位置への予告線(タッチにホバーは無い)
window.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') return;
  if (!ui.drawing || drag) return;
  ui.drawing.hover = snapPt(pt(e));
  renderCanvas();
});
// ダブルクリックで道路を確定
cv.addEventListener('dblclick', () => { if (ui.drawing) finishRoad(); });
window.addEventListener('keydown', e => {
  // タブを閉じる。Ctrl+W/Cmd+W はブラウザ(タブを閉じる)が先に掴むため Web 版では Alt+W。
  // e.code は配列・OS に依存しない物理キー(Mac の Option+W は表示文字が '∫' になる)。key の方でも受ける。
  if (e.altKey && (e.code === 'KeyW' || e.key.toLowerCase() === 'w')) { e.preventDefault(); if (!window.__closeTab()) window.close(); return; }
  const k = e.key.toLowerCase();
  const ae = document.activeElement;
  const inText = ae && /INPUT|TEXTAREA/.test(ae.tagName) && !/^(checkbox|radio|range|color|button|submit|file|hidden)$/i.test(ae.type);
  if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y') && !e.altKey) {
    if (inText) return;                       // テキスト欄ではブラウザ標準の取り消しを使う
    e.preventDefault();
    if (k === 'y' || e.shiftKey) redo(); else undo();
    return;
  }
  if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (e.key === 'Delete' || e.key === 'Backspace') del();
  if (e.key === 'Enter' && ui.drawing) { e.preventDefault(); finishRoad(); return; }   // 確定(ボタンの再発火も止める)
  if (e.key === 'Escape') {
    if (ui.drawing) cancelRoad();
    else if (getBulk().length) { clearBulk(); renderAll(); }   // □選択の解除
    else { ui.tool = 'select'; renderTools(); }
  }
  if (e.code === 'Space') {   // Space押下中はドラッグで画面をスクロール
    e.preventDefault();
    if (!spaceDown) { spaceDown = true; stage.style.cursor = 'grab'; }
  }
});
window.addEventListener('keyup', e => {
  if (e.code === 'Space') { spaceDown = false; if (!pan) stage.style.cursor = ''; }
});

/* ---------- 書き出しファイル名(S6) ----------
   JSON は日時を入れて同じ名前のまま保存しにくくする(地図名は使わない:
   同じ名前が並ぶと上書きしてしまい、いつの版か分からなくなるため)。
   PNG は地図名を使うが、入力値はそのまま使わず `safeFilename()` で
   ファイル名に使える文字だけ残す。 */
const stamp = () => {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};
const jsonFileName = () => `railmaps-${stamp()}.json`;

/* ---------- toolbar / tabs ---------- */
document.getElementById('tools').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  b.blur();   // ボタンにフォーカスが残るとEnter/Spaceで誤爆するため
  if (b.dataset.tool) {
    if (ui.drawing && b.dataset.tool !== 'road') finishRoad();
    ui.tool = b.dataset.tool;
    if (ui.tool === 'road') startRoadDrawing();
    renderTools(); renderCanvas();
  }
  if (b.id === 'del') del();
  if (b.id === 'undo') undo();
  if (b.id === 'redo') redo();
  if (b.id === 'zin') setZoom(ui.zoom * 1.25);
  if (b.id === 'zout') setZoom(ui.zoom / 1.25);
  if (b.id === 'zreset') setZoom(1);
  if (b.id === 'imp') document.getElementById('file').click();
  if (b.id === 'addimg') { imgPick.replaceId = null; document.getElementById('imgfile').click(); }
  if (b.id === 'exp') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(core.getState(), null, 2)], { type: 'application/json' }));
    a.download = jsonFileName(); a.click(); URL.revokeObjectURL(a.href);
  }
  if (b.id === 'expimg') exportImage();
});
document.getElementById('file').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  // 読む前に大きさを断つ(大きいJSONでフリーズさせない。S6)
  if (f.size > LIMITS.jsonFileBytes) {
    toast('JSONファイルが大きすぎます(上限10MB)。このアプリで書き出したJSONを選んでください。', { key: 'import' });
    e.target.value = ''; return;
  }
  const r = new FileReader();
  r.onerror = () => toast('ファイルを読み込めませんでした。', { key: 'import' });
  r.onload = () => {
    let d = null;
    // どこで失敗したかを分けて出す(「読み込めませんでした」だけでは直しようが無い)
    try { d = JSON.parse(r.result); }
    catch (err) { toast('このファイルはJSONではありません。書き出したJSONファイルを選んでください。', { key: 'import' }); return; }
    try {
      const warns = core.importDocument(d);   // 使いものにならない文書だけ例外を投げる
      replaceUi({ map: S.maps[0].id, line: S.maps[0].lines[0].id, sel: null, tool: 'select', open: S.maps.map(m => m.id), home: false, zoom: ui.zoom, drawing: null }); persistOpen();
      dropRemote();   // 文書を入れ替えたので、いま出ている「別タブの変更」は無効(S4)
      save(); renderAll();
      toast((warns && warns.length) ? '取り込みました。' + warns.length + '件の項目を補正しました。' : '取り込みました。',
        { key: 'import' });
      if (warns && warns.length) console.warn('読み込んだデータで直した項目:', warns);
    } catch (err) {
      toast((err && err.message === 'invalid document')
        ? 'このファイルは路線図のデータではありません。書き出したJSONファイルを選んでください。'
        : '取り込めませんでした(' + (err && err.message ? err.message : '理由不明') + ')。',
        { key: 'import' });
    }
  };
  r.readAsText(f); e.target.value = '';
});

/* ---------- 画像のインポート ---------- */
// 保存領域の上限に近づいたら注意(画像を取り込むと超えやすい)
function checkQuota() {
  if (core.snapshot().length > 4500000) toast('画像の取り込みで保存領域の上限に近づいています。保存に失敗する場合は、画像を小さくするか削除してください。', { key: 'quota', ms: 7000 });
}
// 画像ファイルを読み込んでキャンバスに配置。大きい画像は縮小してdata URLに畳む(localStorage対策)
// `accept="image/*"` は見た目で何も強制しないので、型・大きさ・解像度はすべてここで確かめる(S6)。
// SVG は取り込めない: 保存側の許可リスト(S1: png/jpeg/webp/gif)に無いため、
// 入れても再読込のときに画像ごと捨てられ、ユーザーのデータが消えるため。
const IMG_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
function importImageFile(file, replaceId) {
  if (!file) return;
  if (!file.type || IMG_TYPES.indexOf(file.type) < 0) {
    toast(file.type === 'image/svg+xml'
      ? 'SVG画像は取り込めません。PNG・JPG・GIF・WebPのいずれかに変換してから読み込んでください。'
      : '画像ファイル(PNG・JPG・GIF・WebP)を選んでください。', { key: 'img' });
    return;
  }
  if (file.size > LIMITS.imageFileBytes) {
    toast('画像ファイルが大きすぎます(上限15MB)。小さくしてから読み込んでください。', { key: 'img' });
    return;
  }
  const rd = new FileReader();
  rd.onerror = () => toast('画像ファイルを読み込めませんでした。', { key: 'img' });
  rd.onload = () => {
    const im = new Image();
    im.onerror = () => toast('画像として読めませんでした。ファイルが壊れていないか確認してください。', { key: 'img' });
    im.onload = () => {
      const m = curMap(), MAX = 1600;
      const nw = im.naturalWidth || 100, nh = im.naturalHeight || 100;
      // 解像度の上限は canvas に描く前(= メモリを食う処理の前)に確かめる(S6)
      if (nw * nh > LIMITS.imagePixels) {
        toast('画像の解像度が高すぎます(上限5000万画素)。小さくしてから読み込んでください。', { key: 'img' });
        return;
      }
      let src = rd.result;
      const scale = Math.min(1, MAX / Math.max(nw, nh));
      if (scale < 1 || file.size > 400 * 1024) {   // 多くの場合は縮小して再エンコード(WebP不可の環境ではPNG)
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(nw * scale));
        c.height = Math.max(1, Math.round(nh * scale));
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        const u = c.toDataURL('image/webp', 0.85);
        src = u.indexOf('data:image/webp') === 0 ? u : c.toDataURL('image/png');
      }
      if (replaceId) {   // 既存の画像を差し替える(位置・大きさはそのまま)
        const t = (m.images || []).find(x => x.id === replaceId);
        if (t) { core.update(t, { src }); ui.sel = { t: 'img', id: t.id }; save(); renderAll(); checkQuota(); return; }
      }
      // 最長辺900pxに収めた大きさで、いま表示している画面の中央に置く
      const fit = Math.min(1, 900 / Math.max(nw, nh));
      const w = Math.max(G, Math.round(nw * fit)), h = Math.max(G, Math.round(nh * fit));
      const st = document.getElementById('stage');
      const q = snapPt({ x: (st.scrollLeft + st.clientWidth / 2) / ui.zoom - w / 2,
                         y: (st.scrollTop + st.clientHeight / 2) / ui.zoom - h / 2 });
      const x = Math.max(0, Math.round(q.x)), y = Math.max(0, Math.round(q.y));
      core.ensureRoom(m, x + w, y + h);
      const a = core.addImage(m, { src, x, y, w, h });   // 非表示でも取り込んだら表示に戻す
      ui.sel = { t: 'img', id: a.id };
      afterAdd(); save(); renderAll(); checkQuota();
    };
    im.src = rd.result;
  };
  rd.readAsDataURL(file);
}
document.getElementById('imgfile').addEventListener('change', e => {
  const f = e.target.files[0], rid = imgPick.replaceId;
  e.target.value = ''; imgPick.replaceId = null;
  if (f) importImageFile(f, rid);
});

// SVGキャンバスをPNG画像として保存
function exportImage() {
  const svg = document.getElementById('cv');
  const xml = new XMLSerializer().serializeToString(svg);
  const svg64 = btoa(unescape(encodeURIComponent(xml)));
  const img = new Image();
  img.onload = () => {
    const m = curMap(), cw = mw(m), ch = mh(m);
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = m.bg || BG;
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);
    canvas.toBlob(blob => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = safeFilename(curMap().name) + '.png';
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  };
  img.onerror = () => toast('画像の書き出しに失敗しました。別の画像で試してください。', { key: 'expimg' });
  img.src = 'data:image/svg+xml;base64,' + svg64;
}

/* ---------- 別ウィンドウとの同期(S4) ----------
   相手の保存が届いても、こちらに未確定の作業(入力中・ドラッグ中・道路描画中・自動保存の保留)
   がある間は上書きしない。バナーでどちらを使うかを選ばせる。
   ・「相手の版を読み込む」= サニタイズを通した相手の版を適用して履歴をリセット
   ・「自分の版を残す」     = 次にこちらの保存が成功するまで相手の版を受け取らない
     (次の保存で上書きされる = ユーザーが選んだ結果)
   BroadcastChannel は「最適化」にすぎないので使わない(同じ経路が2本になり検証が二重になる)。 */
let remoteRaw = null;   // 保留中の相手の版(文字列のまま。読むとき初めてサニタイズする)

const isTextEditing = () => {
  const ae = document.activeElement;
  if (!ae || ae === document.body) return false;
  if (ae.tagName === 'TEXTAREA') return true;
  if (ae.tagName === 'INPUT') return !/^(checkbox|radio|button|submit|reset|range|color|file|image)$/.test(ae.type || 'text');
  return !!ae.isContentEditable;
};
const localBusy = () => !!drag || !!ui.drawing || isTextEditing();

function askRemote(raw) {
  remoteRaw = raw;
  setBanner('sync', '別のタブでこの路線図が変更されました。どちらを使うか選んでください。', [
    { label: '相手の版を読み込む', onClick: loadRemote },
    { label: '自分の版を残す', onClick: keepLocalVersion }
  ]);
}
function loadRemote() {
  const raw = remoteRaw;
  remoteRaw = null;
  clearLocalAuthority();
  if (raw) applyRemote(raw);
}
// 保留していた相手の版を捨てる(JSONの読み込みなどで文書を入れ替えたとき)
function dropRemote() { remoteRaw = null; clearBanner('sync'); }
// 相手の版を取り込む(保存ボタンと同じ入口 = サニタイズ + 移行)
function applyRemote(raw) {
  try {
    const d = JSON.parse(raw);
    const syncWarnings = core.importDocument(d);
    if (syncWarnings.length) console.warn('タブ間同期で直した項目:', syncWarnings);
    // 相手の変更を取り込んだ時点で履歴をリセット
    core.resetHistory(viewNow());
    updateUndoButtons();
    ui.open = ui.open.filter(id => S.maps.some(m => m.id === id));
    if (!S.maps.some(m => m.id === ui.map)) {
      if (ui.open.length) { ui.map = ui.open[0]; ui.line = curMap().lines[0].id; } else ui.home = true;
      ui.sel = null;
    } else if (!curMap().lines.some(l => l.id === ui.line)) { ui.line = curMap().lines[0].id; ui.sel = null; }
    if (ui.home) { renderAll(); return; }
    renderTabs(); renderCanvas();
    if (!/INPUT/.test(document.activeElement.tagName)) renderSide();
  } catch (err) {}
}

window.addEventListener('storage', e => {
  if (e.key !== KEYS.maps || !e.newValue) return;
  // 決着していない競合がある間は自動適用せず、バナーの中身だけ最新の相手の版へ入れ替える
  if (hasBanner('sync') || shouldAskRemote(localBusy())) { askRemote(e.newValue); return; }
  applyRemote(e.newValue);
});

/* ---------- サイドバーの幅(ドラッグで変更・localStorage に記憶) ----------
   左 = 「駅リスト + クイック操作」を統合した #leftcol、右 = #side。
   幅は CSS 変数 --lw / --rw で渡す(描画側は JS に依存しない)。ドラッグ以外に
   キーボード(←/→=10px、Shift=1px、Home/End=最小/最大、Enter=既定)でも変えられる。 */
const PWKEY = KEYS.panelw, PWDEF = { left: 400, right: 270 };
const PWRANGE = { left: [260, 640], right: [220, 560] };
const STAGE_MIN = 200;   // キャンバスに最低限残す幅
const pw = (() => {
  let v = {};
  try { v = JSON.parse(localStorage.getItem(PWKEY)) || {}; } catch (e) { v = {}; }
  const fix = s => {
    const n = Math.round(+v[s]);
    return Number.isFinite(n) ? Math.max(PWRANGE[s][0], Math.min(PWRANGE[s][1], n)) : PWDEF[s];
  };
  return { left: fix('left'), right: fix('right') };
})();
// 画面幅から実際に表示する幅を決める。まず希望幅を当て、キャンバスが STAGE_MIN を下回るなら
// 不足分を左→右の順に詰める(最小幅は下回らない)。ウィンドウが狭いと自動で両サイドが狭まる。
function effWidths() {
  const inner = window.innerWidth;
  const pick = (v, r) => Math.max(r[0], Math.min(r[1], Math.round(v)));
  let L = pick(pw.left, PWRANGE.left), R = pick(pw.right, PWRANGE.right);
  let need = L + R + 14 + STAGE_MIN - inner;   // キャンバスを確保できない不足分
  if (need > 0) { const c = Math.min(need, L - PWRANGE.left[0]); L -= c; need -= c; }
  if (need > 0) { const c = Math.min(need, R - PWRANGE.right[0]); R -= c; }
  return { left: L, right: R };
}
function applyPanelW() {
  const e = effWidths();
  document.documentElement.style.setProperty('--lw', e.left + 'px');
  document.documentElement.style.setProperty('--rw', e.right + 'px');
}
function setPanelW(side, w) {
  // 反対側の「実際の幅」を避けたうえで、そのサイドの上限までしか動かさない(見たまま保存する)
  const e = effWidths();
  const other = side === 'left' ? e.right : e.left;
  const hi = Math.max(PWRANGE[side][0],
                      Math.min(PWRANGE[side][1], window.innerWidth - other - 14 - STAGE_MIN));
  pw[side] = Math.max(PWRANGE[side][0], Math.min(hi, Math.round(w)));
  applyPanelW();
}
function savePanelW() {
  // 幅は見た目だけの設定(文書本体ではない)。書けなくても内容は失われないので握りつぶす。
  // 文書本体の保存失敗は ui-state の save() が必ず知らせる(S5)。
  try { localStorage.setItem(PWKEY, JSON.stringify(pw)); } catch (e) {}
}
applyPanelW();
// ウィンドウの大きさが変わったら、記憶した幅を今の画面幅に合わせて当て直す(記憶した値自体は変えない)
window.addEventListener('resize', applyPanelW);

function wireSplit(id, side) {
  const el = document.getElementById(id);
  if (!el) return;
  let startX = 0, startW = 0, dragging = false;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    dragging = true; startX = e.clientX; startW = pw[side];
    el.setPointerCapture(e.pointerId);
    el.classList.add('drag');
    document.body.style.userSelect = 'none';   // ドラッグ中のテキスト選択を止める
    e.preventDefault();
  });
  el.addEventListener('pointermove', e => {
    if (!dragging) return;
    setPanelW(side, startW + (side === 'left' ? e.clientX - startX : startX - e.clientX));
  });
  const end = e => {
    if (!dragging) return;
    dragging = false;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    el.classList.remove('drag');
    document.body.style.userSelect = '';
    savePanelW();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => { setPanelW(side, PWDEF[side]); savePanelW(); });   // 既定値へ戻す
  el.addEventListener('keydown', e => {
    const cur = pw[side], d = e.key === 'ArrowLeft' ? -10 : e.key === 'ArrowRight' ? 10 : null;
    if (d) setPanelW(side, cur + (side === 'left' ? d : -d));
    else if (e.key === 'Home') setPanelW(side, PWRANGE[side][0]);
    else if (e.key === 'End') setPanelW(side, PWRANGE[side][1]);
    else if (e.key === 'Enter') setPanelW(side, PWDEF[side]);
    else return;
    e.preventDefault();
    savePanelW();
  });
}
wireSplit('splleft', 'left');
wireSplit('splright', 'right');

/* 各モジュールの描画関数を登録してから最初の描画(登録は renderAll より前に行う) */
setRender({ tabs: renderTabs, home: renderHome, canvas: renderCanvas, side: renderSide, left: renderLeft });
renderAll();
