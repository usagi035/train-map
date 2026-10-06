/* ===========================================================================
   画面側の入口。初期化・入力(マウス/キー/ファイル)・各モジュールの配線を担当する。
   (元は src/ui/renderer.js の1ファイル。指示書 §8〜§12 に沿って画面側を分割した)
   =========================================================================== */
import { S, G, mw, mh, clamp, mkMap, findStationIn, linesOfIn, lw, isDark, BG, SHAPES } from '../core/model.js';
import { dist } from '../core/geometry.js';
import { core, ui, replaceUi, esc, curMap, curLine, findStation, linesOf, viewNow, updateUndoButtons,
         setRender,
         save, getBulk, clearBulk, rectOf, pickInBox, isStationLocked, hitLocked, lineEditBlocked,
         snapOn, snapPt, renderAll, renderTools, del, cancelRoad, finishRoad, startRoadDrawing,
         addRoadPoint, updateRoadHint, imgPick } from './ui-state.js';
import { cv, stage, pt, setZoom, renderCanvas, setBandSource } from './canvas.js';
import { renderSide } from './side-panel.js';
import { renderLeft } from './left-panel.js';
import { renderTabs, renderHome, persistOpen } from './tabs.js';

// 履歴のスナップを画面へ適用する(表示中の路線図・路線を、そのときのものへ合わせ直す)
function applySnap(e) {
  // 状態そのものは core.undo() / core.redo() が入れ替え済み
  try { localStorage.setItem('railmaps', e.s); } catch (err) {}
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
  if (res.error) {   // ロック中・非表示の路線には追加できない
    const l = res.line;
    alert('「' + l.name + '」は' + (res.error === 'locked' ? 'ロック中' : '非表示') + 'です。\n右パネルの ' +
          (res.error === 'locked' ? '🔒 を解除' : '👁 で表示に戻す') + 'してから追加してください。');
    return;
  }
  ui.line = res.line.id; ui.sel = { t: 'cx', id: res.crossing.id };
  afterAdd(); save(); renderAll();
}

function afterAdd() { if (document.getElementById('autosel').checked) ui.tool = 'select'; }

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

// 画面のパン(Space+ドラッグ または 中ボタンドラッグ)
stage.addEventListener('mousedown', e => {
  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    e.preventDefault();
    pan = { x: e.clientX, y: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop };
    stage.style.cursor = 'grabbing';
  }
});
window.addEventListener('mousemove', e => {
  if (!pan) return;
  stage.scrollLeft = pan.sl - (e.clientX - pan.x);
  stage.scrollTop = pan.st - (e.clientY - pan.y);
});
window.addEventListener('mouseup', () => {
  if (pan) { pan = null; stage.style.cursor = spaceDown ? 'grab' : ''; }
});

cv.addEventListener('mousedown', e => {
  if (e.button !== 0 || spaceDown) return;   // 中ボタン / Space押下中はパン処理へ
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
    return addStation(p);
  }
  if (ui.tool === 'hub') return addHubStation(p);
  if (ui.tool === 'crossing') return addCrossing(p);
  if (ui.tool === 'busstop') return addBusStop(p, 'stop');
  if (ui.tool === 'terminal') return addBusStop(p, 'terminal');
  if (ui.tool === 'road') { if (!ui.drawing) ui.drawing = { pts: [], hover: null }; addRoadPoint(p); return; }
  if (ui.tool === 'box') {
    const b = core.addBox(m, snapPt(p));   // 既定サイズのラベル枠を追加
    ui.sel = { t: 'bx', id: b.id }; drag = { t: 'bxnew', id: b.id, a: { x: b.x, y: b.y }, p0: p };
    renderAll(); return;
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
window.addEventListener('mousemove', e => {
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
window.addEventListener('mouseup', () => {
  if (band) { finishBand(); return; }
  if (!drag) return;
  const was = drag; drag = null; save();
  if (was.t === 'bxnew') { afterAdd(); renderAll(); }
});
// 幹線道路ツール: マウス位置への予告線
window.addEventListener('mousemove', e => {
  if (!ui.drawing || drag) return;
  ui.drawing.hover = snapPt(pt(e));
  renderCanvas();
});
// ダブルクリックで道路を確定
cv.addEventListener('dblclick', () => { if (ui.drawing) finishRoad(); });
window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') { e.preventDefault(); if (!window.__closeTab()) window.close(); return; }
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
    a.download = 'railmaps.json'; a.click(); URL.revokeObjectURL(a.href);
  }
  if (b.id === 'expimg') exportImage();
});
document.getElementById('file').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      core.importDocument(d);   // 形式が違うデータは例外を投げる(下でまとめて案内する)
      replaceUi({ map: S.maps[0].id, line: S.maps[0].lines[0].id, sel: null, tool: 'select', open: S.maps.map(m => m.id), home: false, zoom: ui.zoom, drawing: null }); persistOpen();
      save(); renderAll();
    } catch (err) { alert('読み込めませんでした。書き出したJSONファイルを選んでください。'); }
  };
  r.readAsText(f); e.target.value = '';
});

/* ---------- 画像のインポート ---------- */
// 保存領域の上限に近づいたら注意(画像を取り込むと超えやすい)
function checkQuota() {
  if (core.snapshot().length > 4500000) alert('画像の取り込みで保存領域の上限に近づいています。\n保存に失敗する場合は、画像を小さくするか削除してください。');
}
// 画像ファイルを読み込んでキャンバスに配置。大きい画像は縮小してdata URLに畳む(localStorage対策)
function importImageFile(file, replaceId) {
  if (!file) return;
  if (file.type && file.type.indexOf('image/') !== 0) { alert('画像ファイル(PNG・JPG・GIF・WebPなど)を選んでください。'); return; }
  const rd = new FileReader();
  rd.onerror = () => alert('画像を読み込めませんでした。');
  rd.onload = () => {
    const im = new Image();
    im.onerror = () => alert('画像を読み込めませんでした。');
    im.onload = () => {
      const m = curMap(), MAX = 1600;
      const nw = im.naturalWidth || 100, nh = im.naturalHeight || 100;
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
      a.download = (curMap().name || '路線図') + '.png';
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  };
  img.onerror = () => alert('画像の書き出しに失敗しました。');
  img.src = 'data:image/svg+xml;base64,' + svg64;
}

// 別ウィンドウでの変更を取り込む
window.addEventListener('storage', e => {
  if (e.key !== 'railmaps' || !e.newValue || drag) return;
  try {
    const d = JSON.parse(e.newValue);
    if (!Array.isArray(d.maps) || !d.maps.length) return;
    core.replace(d);
    // 別ウィンドウの変更を取り込んだ時点で履歴をリセット
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
});

/* 各モジュールの描画関数を登録してから最初の描画(登録は renderAll より前に行う) */
setRender({ tabs: renderTabs, home: renderHome, canvas: renderCanvas, side: renderSide, left: renderLeft });
renderAll();
