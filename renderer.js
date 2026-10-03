const COLORS = ['#E5352B','#1E7BC4','#2E9E5B','#F29B1F','#8A4FC9','#00A3A3'];
const G = 20, W = 2400, H = 1600;   // 1マス = 20px / W,Hは初期サイズ
const mw = m => m.w || W, mh = m => m.h || H;
// 必要なところまでキャンバスを広げる(draw.ioのように右・下へ自動拡張)
function ensureRoom(m, x, y) {
  const pad = 400, step = 400;
  const nx = Math.max(mw(m), Math.ceil((x + pad) / step) * step);
  const ny = Math.max(mh(m), Math.ceil((y + pad) / step) * step);
  if (nx !== mw(m)) m.w = nx;
  if (ny !== mh(m)) m.h = ny;
}
const SHAPES = { circle: '○ 丸', double: '◎ 二重丸(特急停車駅など)', square: '□ 四角', diamond: '◇ ひし形' };
const STOP_KINDS = { stop: 'バス停', terminal: '■ バスターミナル' };
const STOP_COLOR = '#1f2d36';   // バス停の既定色(道路とは無関係)
const HINTS = {
  select:   '駅・バス停・道路をドラッグして移動 / 空白をドラッグして□で複数選択→Deleteで一括削除 / Deleteキーで削除 / Space+ドラッグで画面移動',
  station:  'クリックで駅を追加(線の上なら間に挿入) / 既存の駅をクリックすると追加せず、選択・移動へ自動で切り替わる',
  hub:      'クリックで乗り換え駅を追加(どの路線にも属さない独立駅。右パネルで路線に組み込める)',
  crossing: '線の近くをクリックして踏切を置く',
  busstop:  'クリックでバス停を配置(幹線道路とは独立して置けます)',
  terminal: 'クリックでバスターミナルを配置',
  road:     'クリックで頂点を追加 / Enterで確定 / Escで中止 / 最初の頂点で閉じる',
  box:      'ドラッグで四角形(ラベル枠)を追加。クリックだけなら標準サイズ'
};
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const BG = '#f4f6f5';
const mkLine = (name, color) => ({ id: uid(), name, color, width: 8, stations: [], crossings: [] });
// 幹線道路(背景)。頂点(pts)の並びで形を表す独立要素
const mkRoad = (name, color, pts) => ({ id: uid(), name, color, width: 16, pts: pts || [] });
// バス停(独立要素)。路線・道路に属さない
const mkBusStop = (name, x, y, kind) => ({ id: uid(), name, x, y, kind: kind || 'stop' });
const mkMap = name => ({ id: uid(), name, bg: BG, lines: [mkLine('1号線', COLORS[0])], roads: [], stops: [], hubs: [] });
const mkStation = (name, x, y) => ({ id: uid(), name, x, y, hub: false });
const lw = l => l.width || 8;
const isDark = hex => { const n = parseInt(hex.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 120; };

let S = null;
try { S = JSON.parse(localStorage.getItem('railmaps')); } catch (e) {}
if (!S || !Array.isArray(S.maps) || !S.maps.length) S = { maps: [mkMap('路線図 1')] };
// 旧形式の移行: 道路を「路線のtype:road + 駅」で持っていたデータを、独立した道路・バス停へ変換する
function migrate(data) {
  data.maps.forEach(m => {
    if (!Array.isArray(m.roads)) m.roads = [];
    if (!Array.isArray(m.stops)) m.stops = [];
    if (!Array.isArray(m.hubs)) m.hubs = [];   // 路線に属さない乗り換え駅の置き場所
    if (!Array.isArray(m.lines) || !m.lines.length) { m.lines = [mkLine('1号線', COLORS[0])]; return; }
    // 接続駅リストを「路線ごと」に。旧形式(配列)は、その駅が属する路線の分へまとめる
    const all = [...m.lines.flatMap(l => l.stations), ...(m.hubs || [])];
    const ids = new Set(all.map(x => x.id));
    all.forEach(st => {
      if (Array.isArray(st.links)) {
        const home = m.lines.find(l => l.stations.some(x => x.id === st.id));
        const arr = st.links.slice();
        st.links = {}; st.links[home ? home.id : '-'] = arr;
      } else if (!st.links || typeof st.links !== 'object') {
        if (st.links !== undefined) delete st.links;
      }
      if (st.links && typeof st.links === 'object') {
        Object.keys(st.links).forEach(k => {
          if (Array.isArray(st.links[k])) st.links[k] = st.links[k].filter(x => ids.has(x));   // 存在しない駅への接続は捨てる
          else delete st.links[k];
        });
      }
    });
    const oldRoads = m.lines.filter(l => l.type === 'road');
    if (!oldRoads.length) return;
    oldRoads.forEach(l => {
      if (l.stations.length >= 2)
        m.roads.push(mkRoad(l.name, l.color, l.stations.map(s => ({ x: s.x, y: s.y }))));
      l.stations.forEach(s => {
        const st = mkBusStop(s.name, s.x, s.y, s.shape === 'terminal' ? 'terminal' : 'stop');
        st.color = s.color; st.nameX = s.nameX; st.nameY = s.nameY; st.nameRot = s.nameRot;
        m.stops.push(st);
      });
    });
    m.lines = m.lines.filter(l => l.type !== 'road');
    if (!m.lines.length) m.lines.push(mkLine('1号線', COLORS[0]));
  });
  return data;
}
S = migrate(S);
let ui = { map: S.maps[0].id, line: S.maps[0].lines[0].id, sel: null, tool: 'select', open: S.maps.map(m => m.id), home: false, zoom: 1, drawing: null, bulk: [], bulkRect: null, bulkMap: null };
const hm = S.maps.find(m => m.id === decodeURIComponent(location.hash.slice(1)));   // 別ウィンドウで開いたときの路線図
if (hm) { ui.map = hm.id; ui.line = hm.lines[0].id; ui.open = [hm.id]; }
else {
  try { const o = JSON.parse(localStorage.getItem('railopen')); if (Array.isArray(o)) ui.open = o.filter(id => S.maps.some(m => m.id === id)); } catch (e) {}
  const om = S.maps.find(m => m.id === ui.open[0]);
  if (om) { ui.map = om.id; ui.line = om.lines[0].id; } else ui.home = true;
}

const curMap  = () => S.maps.find(m => m.id === ui.map) || S.maps[0];
const curLine = () => { const m = curMap(); return m.lines.find(l => l.id === ui.line) || m.lines[0]; };
// 駅を探す(路線のstationsにも、路線に属さない乗り換え駅のm.hubsにも入っている)
const findStation = id => {
  const m = curMap();
  return (m.hubs || []).find(s => s.id === id) || m.lines.flatMap(l => l.stations).find(s => s.id === id);
};
// その駅が属する路線(0〜複数。乗り換え駅は0本のこともある)
const linesOf = id => curMap().lines.filter(l => l.stations.some(s => s.id === id));
// すべての駅(複数路線に共有されている同じ駅は1つにまとめる)
const allStations = m => {
  const seen = new Map();
  m.lines.forEach(l => l.stations.forEach(s => seen.set(s.id, s)));
  (m.hubs || []).forEach(s => seen.set(s.id, s));
  return [...seen.values()];
};
// 「接続する駅」は路線ごとに持つ。key = 路線ID、路線に属さないときは OFF_LINK
const OFF_LINK = '-';
const linksIn = (s, lid) => (s.links && Array.isArray(s.links[lid])) ? s.links[lid] : [];
// 表示する接続グループ(属する路線ごと。路線外の接続があるときも1つ並べる)
const linkGroups = (m, s) => {
  const gs = [];
  m.lines.forEach(l => { if (l.stations.some(x => x.id === s.id)) gs.push({ lid: l.id, name: l.name, color: l.color, ids: linksIn(s, l.id) }); });
  const off = linksIn(s, OFF_LINK);
  if (off.length || !gs.length) gs.push({ lid: OFF_LINK, name: '路線外', color: STOP_COLOR, ids: off });
  return gs;
};
// どの路線にも属さなくなるとき、路線ごとの接続を「路線外」にまとめる
const flattenLinks = s => {
  const ids = [];
  if (s.links && typeof s.links === 'object') {
    Object.keys(s.links).forEach(k => (Array.isArray(s.links[k]) ? s.links[k] : []).forEach(id => { if (!ids.includes(id)) ids.push(id); }));
  }
  s.links = {}; s.links[OFF_LINK] = ids;
};
// 存在しなくなった駅を指している接続リストを掃除する(不正なIDを残さない)
const pruneLinks = () => {
  const m = curMap();
  const each = st => {
    if (!st.links || typeof st.links !== 'object') return;
    Object.keys(st.links).forEach(k => { if (Array.isArray(st.links[k])) st.links[k] = st.links[k].filter(id => findStation(id)); });
  };
  m.lines.forEach(l => l.stations.forEach(each));
  (m.hubs || []).forEach(each);
};

/* ---------- 履歴 (元に戻す / やり直す) ---------- */
const snapStr = () => { try { return JSON.stringify(S); } catch (e) { return ''; } };
const viewNow = () => ({ map: ui.map, line: ui.line });
const undoStack = [], redoStack = [];
let lastSnap = snapStr(), lastView = viewNow(), saveTimer = 0;
// 表示中の路線図・路線を記録(元に戻したときにどの路線図を開くかに使う)
const syncView = () => { lastView = viewNow(); };
function updateUndoButtons() {
  const u = document.getElementById('undo'), r = document.getElementById('redo');
  if (u) u.disabled = !undoStack.length;
  if (r) r.disabled = !redoStack.length;
}
// 保存しつつ、変更前の状態を履歴に積む
const save = () => {
  clearTimeout(saveTimer); saveTimer = 0;
  const now = snapStr();
  if (now === lastSnap) return;         // 変化なしなら履歴に残さない
  undoStack.push({ s: lastSnap, v: lastView });
  if (undoStack.length > 50) undoStack.shift();
  redoStack.length = 0;
  lastSnap = now; lastView = viewNow();
  try { localStorage.setItem('railmaps', now); } catch (e) {}
  updateUndoButtons();
};
// 文字入力やスライダーは、連続入力をまとめて1回の履歴にする
const deferSave = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = 0; save(); }, 600);
};
function applySnap(e) {
  try { S = JSON.parse(e.s); } catch (err) { return; }
  lastSnap = e.s; lastView = e.v;
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
  if (!undoStack.length) return;
  redoStack.push({ s: lastSnap, v: lastView });
  applySnap(undoStack.pop());
}
function redo() {
  if (ui.drawing || !redoStack.length) return;
  undoStack.push({ s: lastSnap, v: lastView });
  applySnap(redoStack.pop());
}

/* ---------- geometry ---------- */
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const segPt = (l, seg, t) => {
  const a = l.stations[seg], b = l.stations[seg + 1];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
};
function project(l, p) {
  let best = null; const s = l.stations;
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i], b = s[i + 1], dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
    t = clamp(t, 0, 1);
    const q = { x: a.x + dx * t, y: a.y + dy * t }, d = Math.hypot(p.x - q.x, p.y - q.y);
    if (!best || d < best.d) best = { seg: i, t, d, x: q.x, y: q.y };
  }
  return best;
}
// 駅の追加・削除をしても、踏切が元の位置に残るよう付け直す
function keepCrossings(l, fn) {
  const ps = l.crossings.map(c => segPt(l, c.seg, c.t));
  fn();
  l.crossings = l.crossings.map((c, i) => {
    const r = project(l, ps[i]);
    return r ? Object.assign(c, { seg: r.seg, t: r.t }) : null;
  }).filter(Boolean);
}

/* ---------- マウスの□(矩形)で複数選択 ---------- */
const BAND_COLOR = '#2f7d64';
// 矩形選択でまとめて選んだ要素 {t,id} の一括分。別地図のときは無効扱い
const getBulk = () => (ui.bulk && ui.bulk.length && ui.bulkMap === ui.map) ? ui.bulk : [];
const clearBulk = () => { ui.bulk = []; ui.bulkRect = null; ui.bulkMap = null; };
const rectOf = (a, z) => ({ x0: Math.min(a.x, z.x), y0: Math.min(a.y, z.y), x1: Math.max(a.x, z.x), y1: Math.max(a.y, z.y) });
// 中心が矩形に入っていれば選択(少し余裕を持たせる)
const inBox = (p, b, pad) => p.x >= b.x0 - pad && p.x <= b.x1 + pad && p.y >= b.y0 - pad && p.y <= b.y1 + pad;
// 矩形に重なる要素を集める(駅・乗り換え駅・バス停・踏切・ラベル枠・幹線道路)
function pickInBox(m, b) {
  const hit = [], has = id => hit.some(x => x.id === id);
  m.lines.forEach(l => l.stations.forEach(s => { if (!has(s.id) && inBox(s, b, 12)) hit.push({ t: 'st', id: s.id }); }));
  (m.hubs || []).forEach(s => { if (!has(s.id) && inBox(s, b, 12)) hit.push({ t: 'st', id: s.id }); });
  (m.stops || []).forEach(s => { if (!has(s.id) && inBox(s, b, 14)) hit.push({ t: 'stop', id: s.id }); });
  m.lines.forEach(l => l.crossings.forEach(c => {
    if (l.stations.length < 2 || has(c.id)) return;
    const p = segPt(l, c.seg, c.t);
    if (inBox(p, b, 16)) hit.push({ t: 'cx', id: c.id });
  }));
  (m.boxes || []).forEach(x => {
    if (x.x + x.w >= b.x0 && x.x <= b.x1 && x.y + x.h >= b.y0 && x.y <= b.y1) hit.push({ t: 'bx', id: x.id });
  });
  (m.roads || []).forEach(r => {
    if (!r.pts.length || has(r.id)) return;
    const inAll = r.pts.every(p => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1);
    if (inAll || r.pts.some(p => inBox(p, b, 8))) hit.push({ t: 'road', id: r.id });
  });
  return hit;
}

/* ---------- rendering ---------- */
function renderTabs() {
  document.getElementById('tabs').innerHTML =
    ui.open.map(id => S.maps.find(m => m.id === id)).filter(Boolean).map(m =>
      `<div class="tab ${m.id === ui.map && !ui.home ? 'on' : ''}"><span data-id="${m.id}">${esc(m.name)}</span><button class="x" data-x="${m.id}" title="閉じる (Ctrl+W)" aria-label="閉じる">✕</button></div>`).join('') +
    '<button id="addmap" title="路線図を追加">＋</button><button id="listbtn" title="路線図の一覧">一覧</button>';
}
function renderHome() {
  document.getElementById('home').innerHTML = '<h2>路線図</h2><ul>' +
    S.maps.map(m => `<li><span>${esc(m.name)}</span><span class="st">${ui.open.includes(m.id) ? '開いています' : ''}</span><button data-open="${m.id}">開く</button><button data-del="${m.id}">削除</button></li>`).join('') +
    '</ul><button id="hnew">新しい路線図</button>';
}
function renderTools() {
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === ui.tool));
  document.getElementById('hint').textContent = HINTS[ui.tool] || '';
  document.getElementById('cv').style.cursor = ui.tool === 'select' ? 'default' : 'crosshair';
  updateUndoButtons();
}
function renderCanvas() {
  const m = curMap(), bg = m.bg || BG, dark = isDark(bg);
  const fg = dark ? '#f2f5f4' : '#1f2d36', sub = dark ? '#9fb0b8' : '#6b7c84';
  const halo = `style="paint-order:stroke;stroke:${bg};stroke-width:4px"`;
  document.getElementById('stage').style.background = bg;
  applyZoom();
  const cw = mw(m), ch = mh(m);
  let h = `<defs><pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="${fg}" stroke-opacity=".1" stroke-width="1"/></pattern></defs>` +
          `<rect width="${cw}" height="${ch}" fill="${bg}"/><rect width="${cw}" height="${ch}" fill="url(#g)"/>` +
          `<rect width="${cw}" height="${ch}" fill="none" stroke="${fg}" stroke-opacity=".35" stroke-width="2" stroke-dasharray="8 6"/>`;
  (m.boxes || []).forEach(b => {
    const sel = ui.sel && ui.sel.t === 'bx' && ui.sel.id === b.id, tc = isDark(b.fill) ? '#fff' : '#1f2d36', n = [...(b.text || '')].length;
    const fs = Math.max(8, Math.min(14, b.h - 8, (b.w - 8) / Math.max(1, n)));
    h += `<g data-t="bx" data-id="${b.id}"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="3" fill="${b.fill}" fill-opacity=".92" stroke="${fg}" stroke-opacity=".45" stroke-width="1.5"/>` +
         (b.text ? `<text x="${b.x + b.w / 2}" y="${b.y + b.h / 2 + fs * 0.35}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="${tc}">${esc(b.text)}</text>` : '') +
         (sel ? `<rect x="${b.x - 3}" y="${b.y - 3}" width="${b.w + 6}" height="${b.h + 6}" rx="4" fill="none" stroke="${fg}" stroke-width="2" stroke-dasharray="4 3"/><rect data-t="bxr" data-id="${b.id}" x="${b.x + b.w - 6}" y="${b.y + b.h - 6}" width="12" height="12" fill="${fg}" style="cursor:nwse-resize"/>` : '') + '</g>';
  });
  // 0) 幹線道路(背景・独立要素)
  (m.roads || []).forEach(r => {
    if (r.pts.length < 2) return;
    const sel = ui.sel && ui.sel.t === 'road' && ui.sel.id === r.id;
    const pts = r.pts.map(p => p.x + ',' + p.y).join(' ');
    h += `<g data-t="road" data-id="${r.id}">` +
         `<polyline points="${pts}" fill="none" stroke="${r.color}" stroke-width="${r.width}" stroke-linecap="round" stroke-linejoin="round"/>` +
         `<polyline points="${pts}" fill="none" stroke="#ffffff" stroke-opacity=".85" stroke-width="${Math.max(2, r.width - 7)}" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>`;
    if (sel) {
      h += `<polyline points="${pts}" fill="none" stroke="${fg}" stroke-width="2" stroke-dasharray="4 3" pointer-events="none"/>` +
           r.pts.map((p, i) => `<rect data-t="roadpt" data-id="${r.id}" data-i="${i}" x="${p.x - 5}" y="${p.y - 5}" width="10" height="10" fill="#fff" stroke="${fg}" stroke-width="2" style="cursor:move"/>`).join('');
    }
    h += '</g>';
  });
  // 描画中プレビュー(幹線道路ツール)
  if (ui.drawing) {
    const d = ui.drawing, all = d.hover && d.pts.length ? d.pts.concat([d.hover]) : d.pts;
    if (all.length) {
      h += `<polyline points="${all.map(p => p.x + ',' + p.y).join(' ')}" fill="none" stroke="#5a6b73" stroke-width="14" stroke-opacity=".6" stroke-linecap="round" stroke-linejoin="round" ${d.pts.length > 1 ? 'stroke-dasharray="12 7"' : ''} pointer-events="none"/>`;
      h += d.pts.map(p => `<circle cx="${p.x}" cy="${p.y}" r="5" fill="#fff" stroke="#5a6b73" stroke-width="3" pointer-events="none"/>`).join('');
    }
  }
  const xf = (l, c) => {
    const p = segPt(l, c.seg, c.t), a = l.stations[c.seg], b = l.stations[c.seg + 1];
    return { p, t: `translate(${p.x} ${p.y}) rotate(${Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI})` };
  };
  const dims = l => { const w = lw(l); return { half: Math.max(7, w / 2 + 3), rh: Math.max(26, w / 2 + 20) }; };
  // 1) 踏切の道路
  m.lines.forEach(l => {
    const { half, rh } = dims(l);
    l.crossings.forEach(c => {
      h += `<g transform="${xf(l, c).t}"><rect x="${-half}" y="${-rh}" width="${half * 2}" height="${rh * 2}" rx="2" fill="#9aa5a9"/></g>`;
    });
  });
  // 2) 線路と駅間隔
  m.lines.forEach(l => {
    const s = l.stations, on = l.id === ui.line;
    if (s.length > 1)
      h += `<polyline data-t="line" data-l="${l.id}" points="${s.map(p => p.x + ',' + p.y).join(' ')}" fill="none" stroke="${l.color}" stroke-width="${lw(l)}" stroke-linecap="round" stroke-linejoin="round" opacity="${on ? 1 : .55}"/>`;
    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i], b = s[i + 1], len = dist(a, b) || 1, off = lw(l) / 2 + 12;
      const mx = (a.x + b.x) / 2 - (b.y - a.y) / len * off, my = (a.y + b.y) / 2 + (b.x - a.x) / len * off;
      h += `<text x="${mx}" y="${my + 4}" text-anchor="middle" font-size="11" fill="${sub}" ${halo}>${(len / G).toFixed(1)}</text>`;
    }
  });
  // 3) 踏切の記号
  m.lines.forEach(l => {
    const { half, rh } = dims(l);
    l.crossings.forEach(c => {
      const { p, t } = xf(l, c), sel = ui.sel && ui.sel.t === 'cx' && ui.sel.id === c.id;
      h += `<g data-t="cx" data-l="${l.id}" data-id="${c.id}" transform="${t}">` +
           `<circle r="${rh + 2}" fill="#fff" fill-opacity="0"/>` +
           `<line x1="${-half}" y1="${-rh}" x2="${-half}" y2="${rh}" stroke="#fff" stroke-width="2"/><line x1="${half}" y1="${-rh}" x2="${half}" y2="${rh}" stroke="#fff" stroke-width="2"/>` +
           `<path d="M-6 ${-rh - 8} L6 ${-rh - 20} M6 ${-rh - 8} L-6 ${-rh - 20} M-6 ${rh + 8} L6 ${rh + 20} M6 ${rh + 8} L-6 ${rh + 20}" stroke="#d62d20" stroke-width="3.5" stroke-linecap="round"/>` +
           (sel ? `<circle r="${rh + 6}" fill="none" stroke="${fg}" stroke-width="2" stroke-dasharray="4 3"/>` : '') + '</g>';
      if (c.name) h += `<text x="${p.x + 18}" y="${p.y - rh - 4}" font-size="12" fill="${fg}" ${halo}>${esc(c.name)}</text>`;
    });
  });
  // 4) 駅(路線の駅 + 路線に属さない乗り換え駅)
  const drawStation = (s, l) => {
    const w = l ? lw(l) : 8, R = w / 2 + 7, rw = Math.max(5, w * 0.6);
    const sel = ui.sel && ui.sel.t === 'st' && ui.sel.id === s.id, c = s.color || (l ? l.color : STOP_COLOR), sh = s.shape || 'circle';
    let body, ext;
    if (sh === 'double') { body = `<circle cx="${s.x}" cy="${s.y}" r="${R + 3}" fill="#fff" stroke="${c}" stroke-width="4"/><circle cx="${s.x}" cy="${s.y}" r="${Math.max(3, R - 5)}" fill="#fff" stroke="${c}" stroke-width="3"/>`; ext = R + 5; }
    else if (sh === 'square') { body = `<rect x="${s.x - R}" y="${s.y - R}" width="${R * 2}" height="${R * 2}" rx="2" fill="#fff" stroke="${c}" stroke-width="${rw}"/>`; ext = R + rw / 2; }
    else if (sh === 'diamond') { const d = R * 1.35; body = `<polygon points="${s.x},${s.y - d} ${s.x + d},${s.y} ${s.x},${s.y + d} ${s.x - d},${s.y}" fill="#fff" stroke="${c}" stroke-width="${rw * 0.8}" stroke-linejoin="round"/>`; ext = d + 2; }
    else { body = `<circle cx="${s.x}" cy="${s.y}" r="${R}" fill="#fff" stroke="${c}" stroke-width="${rw}"/>`; ext = R + rw / 2; }
    const nx = s.nameX || 0, ny = s.nameY || 0, rot = s.nameRot || 0;
    const tx = s.x + nx, ty = s.y + ny + ext + 20;
    const dl = l ? ` data-l="${l.id}"` : '';
    h += `<g data-t="st"${dl} data-id="${s.id}">${body}` +
         (s.hub ? `<circle cx="${s.x}" cy="${s.y}" r="${R + 4}" fill="none" stroke="${c}" stroke-width="3" stroke-dasharray="5 3"/>` : '') +
         (sel ? `<circle cx="${s.x}" cy="${s.y}" r="${ext + 5}" fill="none" stroke="${fg}" stroke-width="2" stroke-dasharray="4 3"/>` : '') +
         (rot ? `<text class="stname" data-t="stname"${dl} data-id="${s.id}" x="${tx}" y="${ty}" text-anchor="middle" font-size="14" font-weight="700" fill="${fg}" ${halo} style="cursor:move" transform="rotate(${rot} ${tx} ${ty})">${esc(s.name)}</text>`
              : `<text class="stname" data-t="stname"${dl} data-id="${s.id}" x="${tx}" y="${ty}" text-anchor="middle" font-size="14" font-weight="700" fill="${fg}" ${halo} style="cursor:move">${esc(s.name)}</text>`) + '</g>';
  };
  // 4) 乗り換え駅の「接続する駅」への線(普通の路線と同じ描画。色と太さは接続先の駅の路線、路線外の接続先はグレー)
  const drawnConn = new Set();
  const conn = s => {
    if (!s.links || typeof s.links !== 'object') return;
    Object.keys(s.links).forEach(k => (Array.isArray(s.links[k]) ? s.links[k] : []).forEach(id => {
      const t = findStation(id);
      if (!t || t.id === s.id) return;
      const key = s.id + '>' + t.id;
      if (drawnConn.has(key)) return;   // 複数の路線のリストに同じ接続があっても1本だけ
      drawnConn.add(key);
      const tl = linesOf(t.id)[0];
      const c = tl ? tl.color : STOP_COLOR, w = tl ? lw(tl) : 8;
      h += `<line x1="${s.x}" y1="${s.y}" x2="${t.x}" y2="${t.y}" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>`;
    }));
  };
  m.lines.forEach(l => l.stations.forEach(conn));
  (m.hubs || []).forEach(conn);
  m.lines.forEach(l => l.stations.forEach(s => drawStation(s, l)));
  (m.hubs || []).forEach(s => drawStation(s, null));   // 路線外の乗り換え駅
  // 5) バス停(独立要素・最前面)
  (m.stops || []).forEach(s => {
    const sel = ui.sel && ui.sel.t === 'stop' && ui.sel.id === s.id;
    const c = s.color || STOP_COLOR;
    let body, ext;
    if (s.kind === 'terminal') {
      body = `<rect x="${s.x - 18}" y="${s.y - 10}" width="36" height="20" rx="5" fill="#fff" stroke="${c}" stroke-width="3"/><rect x="${s.x - 11}" y="${s.y - 2.5}" width="22" height="5" rx="2.5" fill="${c}" fill-opacity=".45"/>`;
      ext = 13;
    } else {
      const r = 7;
      body = `<rect x="${s.x - r}" y="${s.y - r}" width="${r * 2}" height="${r * 2}" rx="3" fill="#fff" stroke="${c}" stroke-width="3"/>`;
      ext = r + 4;
    }
    const nx = s.nameX || 0, ny = s.nameY || 0, rot = s.nameRot || 0;
    const tx = s.x + nx, ty = s.y + ny + ext + 18;
    const nm = `<text class="stname" data-t="stopname" data-id="${s.id}" x="${tx}" y="${ty}" text-anchor="middle" font-size="13" font-weight="700" fill="${fg}" ${halo} style="cursor:move"${rot ? ` transform="rotate(${rot} ${tx} ${ty})"` : ''}>${esc(s.name)}</text>`;
    h += `<g data-t="stop" data-id="${s.id}">${body}` +
         (sel ? `<circle cx="${s.x}" cy="${s.y}" r="${ext + 5}" fill="none" stroke="${fg}" stroke-width="2" stroke-dasharray="4 3"/>` : '') + nm + '</g>';
  });
  // 矩形選択(□)のプレビューと、まとめて選択中の要素のハイライト
  const bl = getBulk();
  const bandBox = band ? rectOf(band.a, band.b) : (bl.length ? ui.bulkRect : null);
  if (bandBox) {
    h += `<rect x="${bandBox.x0}" y="${bandBox.y0}" width="${Math.max(0, bandBox.x1 - bandBox.x0)}" height="${Math.max(0, bandBox.y1 - bandBox.y0)}" fill="${BAND_COLOR}" fill-opacity="${band ? .12 : .05}" stroke="${BAND_COLOR}" stroke-width="${band ? 2 : 1}" stroke-dasharray="6 4" pointer-events="none"/>`;
  }
  const mkBox = (x, y, w, hh) => `<rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="4" fill="none" stroke="${BAND_COLOR}" stroke-width="2" stroke-dasharray="5 3" pointer-events="none"/>`;
  bl.forEach(it => {
    if (it.t === 'st') { const s = findStation(it.id); if (s) h += mkBox(s.x - 15, s.y - 15, 30, 30); }
    else if (it.t === 'stop') {
      const s = (m.stops || []).find(x => x.id === it.id);
      if (s) { const e = s.kind === 'terminal' ? 23 : 15; h += mkBox(s.x - e, s.y - e, e * 2, e * 2); }
    }
    else if (it.t === 'bx') { const b = (m.boxes || []).find(x => x.id === it.id); if (b) h += mkBox(b.x - 4, b.y - 4, b.w + 8, b.h + 8); }
    else if (it.t === 'road') {
      const r = (m.roads || []).find(x => x.id === it.id);
      if (r && r.pts.length > 1) h += `<polyline points="${r.pts.map(p => p.x + ',' + p.y).join(' ')}" fill="none" stroke="${BAND_COLOR}" stroke-width="2" stroke-dasharray="5 3" pointer-events="none"/>`;
    }
    else if (it.t === 'cx') {
      const owner = m.lines.find(l => l.crossings.some(c => c.id === it.id));
      const c = owner && owner.crossings.find(x => x.id === it.id);
      if (owner && c && owner.stations.length >= 2) h += `<g transform="${xf(owner, c).t}"><rect x="-20" y="-32" width="40" height="64" rx="4" fill="none" stroke="${BAND_COLOR}" stroke-width="2" stroke-dasharray="5 3" pointer-events="none"/></g>`;
    }
  });
  document.getElementById('cv').innerHTML = h;
}

function renderSide() {
  const m = curMap(), l = curLine();
  let sel = '';
  if (ui.sel) {
    if (ui.sel.t === 'st') {
      const s = findStation(ui.sel.id);
      if (!s) ui.sel = null;
      else {
        const ls = linesOf(s.id);   // 属する路線(乗り換え駅は0本のこともある)
        const gl = ls.some(x => x.id === l.id) ? l : ls[0];   // 間隔を表示する路線
        const i = gl ? gl.stations.findIndex(x => x.id === s.id) : -1;
        const head = ls.length ? '選択中の駅' : '選択中の乗り換え駅(路線外)';
        sel = `<h3>${head}</h3><label>駅名<input id="sname" value="${esc(s.name)}"></label>` +
          `<label>形<select id="sshape">${Object.entries(SHAPES).map(([k, v]) => `<option value="${k}"${(s.shape || 'circle') === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>` +
          `<div class="row" style="align-items:center"><span>色</span><input type="color" id="scolor" value="${s.color || (ls.length ? ls[0].color : STOP_COLOR)}"><button id="sreset">路線の色に戻す</button></div>` +
          `<label>駅名の向き<select id="snameRot"><option value="0"${(s.nameRot || 0) === 0 ? ' selected' : ''}>普通</option><option value="45"${(s.nameRot || 0) === 45 ? ' selected' : ''}>斜め(45°)</option><option value="90"${(s.nameRot || 0) === 90 ? ' selected' : ''}>縦(90°)</option></select></label>` +
          `<label><input type="checkbox" id="shub"${s.hub ? ' checked' : ''}> 乗り換え駅(ターミナルハブ)</label>` +
          (s.hub ? '<div class="note" style="margin-bottom:4px">属する路線:</div>' +
            m.lines.map(x => `<label style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><input type="checkbox" class="shubline" data-lid="${x.id}"${x.stations.some(st => st.id === s.id) ? ' checked' : ''}> <i style="display:inline-block;width:18px;height:5px;border-radius:3px;background:${x.color};flex:none"></i>${esc(x.name)}</label>`).join('') +
            `<p class="note">${ls.length ? 'チェックを全部外すと、どの路線にも属さない乗り換え駅(路線外)になります。' : '現在、どの路線にも属していません(路線外)。チェックした路線に組み込めます。'}</p>` : '');
        if (s.hub) {
          // 接続する駅:路線ごとに別のリスト(データとして保持。描画には影響しない)
          const colorOf = id => { const c = linesOf(id)[0]; return c ? c.color : STOP_COLOR; };
          linkGroups(m, s).forEach(gr => {
            const gl = gr.lid === OFF_LINK ? null : m.lines.find(x => x.id === gr.lid);
            const rest = allStations(m).filter(x => x.id !== s.id && !gr.ids.includes(x.id));
            const same = gl ? rest.filter(x => gl.stations.some(y => y.id === x.id)) : rest;
            const other = gl ? rest.filter(x => !gl.stations.some(y => y.id === x.id)) : [];
            const opt = arr => arr.map(x => { const c = linesOf(x.id)[0]; return `<option value="${x.id}">${esc(x.name)}${c ? ' (' + esc(c.name) + ')' : ' (路線外)'}</option>`; }).join('');
            const options = (same.length && other.length)
              ? `<optgroup label="${esc(gl.name)}の駅">${opt(same)}</optgroup><optgroup label="そのほかの駅">${opt(other)}</optgroup>`
              : opt(same.length ? same : other);
            let g = `<div class="linkgroup"><div class="note lghead"><i style="background:${gr.color}"></i>${esc(gr.name)} の接続駅:</div>`;
            g += gr.ids.length
              ? `<ul class="linklist" data-lid="${gr.lid}">` + gr.ids.map((id, k) => {
                  const x = findStation(id); if (!x) return '';
                  // 路線名が重複する駅もあるので、その路線の駅以外は路線名を併記する
                  const c = linesOf(id)[0];
                  const label = esc(x.name + (!gl || !c || c.id !== gl.id ? ' (' + (c ? c.name : '路線外') + ')' : ''));
                  return `<li data-id="${id}" draggable="true">` +
                    `<span class="lhandle" title="ドラッグで並べ替え">⇅</span>` +
                    `<i style="background:${colorOf(id)}"></i>` +
                    `<span class="lname">${label}</span>` +
                    `<span class="lbtns">` +
                      `<button class="lup" title="上へ移動"${k === 0 ? ' disabled' : ''}>↑</button>` +
                      `<button class="ldown" title="下へ移動"${k === gr.ids.length - 1 ? ' disabled' : ''}>↓</button>` +
                      `<button class="ldel" title="この接続を外す">✕</button>` +
                    `</span></li>`;
                }).join('') + '</ul>'
              : '<p class="note">まだ接続駅がありません。</p>';
            g += rest.length
              ? `<div class="row" data-lid="${gr.lid}"><select class="linksel" style="flex:1;min-width:0">${options}</select><button class="linkadd">追加</button></div>`
              : '<p class="note">追加できる駅がありません。</p>';
            sel += g + '</div>';
          });
          sel += '<p class="note">接続は路線ごとに別のリストで持ちます。順番は ↑↓ かドラッグで変えられます。登録した接続は、乗り換え駅から接続先の駅へ<b>通常の路線と同じ線</b>で描画され、色と太さは接続先の駅の路線です(路線外の接続先はグレー)。</p>';
        }
        if (gl && i > 0) sel += `<label>前の駅との間隔(マス)<input id="gap" data-lid="${gl.id}" type="number" min="0.5" step="0.5" value="${(dist(gl.stations[i - 1], s) / G).toFixed(1)}"></label><p class="note">変更すると、これ以降の駅も一緒に動きます。</p>`;
      }
    } else if (ui.sel.t === 'stop') {
      const s = (m.stops || []).find(x => x.id === ui.sel.id);
      if (!s) ui.sel = null;
      else {
        const kind = s.kind || 'stop';
        sel = `<h3>${kind === 'terminal' ? '選択中のバスターミナル' : '選択中のバス停'}</h3><label>名称<input id="bsname" value="${esc(s.name)}"></label>` +
          `<label>種別<select id="bskind">${Object.entries(STOP_KINDS).map(([k, v]) => `<option value="${k}"${kind === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>` +
          `<div class="row" style="align-items:center"><span>色</span><input type="color" id="bscolor" value="${s.color || STOP_COLOR}"><button id="bsreset">標準色に戻す</button></div>` +
          `<label>名称の向き<select id="bsnameRot"><option value="0"${(s.nameRot || 0) === 0 ? ' selected' : ''}>普通</option><option value="45"${(s.nameRot || 0) === 45 ? ' selected' : ''}>斜め(45°)</option><option value="90"${(s.nameRot || 0) === 90 ? ' selected' : ''}>縦(90°)</option></select></label>` +
          `<p class="note">幹線道路とは独立した要素です。キャンバスのどこにでも置けます。</p>`;
      }
    } else if (ui.sel.t === 'road') {
      const r = (m.roads || []).find(x => x.id === ui.sel.id);
      if (!r) ui.sel = null;
      else sel = `<h3>選択中の幹線道路</h3><label>名前<input id="rname" value="${esc(r.name)}"></label>` +
        `<div class="row" style="align-items:center"><span>色</span><input type="color" id="rcolor" value="${r.color}"></div>` +
        `<label>幅(${r.width})<input type="range" id="rwidth" min="6" max="40" step="1" value="${r.width}"></label>` +
        `<div class="row"><button id="droad">この道路を削除</button></div>` +
        `<p class="note">頂点(□)をドラッグすると形を調整できます。道路全体のドラッグで移動します。</p>`;
    } else if (ui.sel.t === 'bx') {
      const b = (m.boxes || []).find(b => b.id === ui.sel.id);
      if (!b) ui.sel = null;
      else sel = `<h3>選択中のラベル枠</h3><label>ラベル<input id="btext" value="${esc(b.text || '')}"></label>` +
        `<div class="row" style="align-items:center"><span>色</span><input type="color" id="bfill" value="${b.fill}"></div>` +
        `<div class="row"><label style="flex:1">幅(マス)<input id="bw" type="number" min="1" step="1" value="${Math.round(b.w / G)}"></label><label style="flex:1">高さ(マス)<input id="bh" type="number" min="1" step="1" value="${Math.round(b.h / G)}"></label></div>`;
    } else {
      const c = l.crossings.find(c => c.id === ui.sel.id);
      if (!c) ui.sel = null;
      else sel = `<h3>選択中の踏切</h3><label>名前<input id="cname" value="${esc(c.name)}"></label>`;
    }
  }
  const bulk = getBulk();
  if (!ui.sel && bulk.length) {
    sel = `<h3>□で ${bulk.length}個を選択中</h3><p class="note">Delete キー(または「選択を削除」)でまとめて削除します。Esc かクリックで解除します</p>`;
  }
  document.getElementById('side').innerHTML = sel +
    `<h3>路線図の名前</h3><input id="mname" value="${esc(m.name)}">` +
    '<div class="row" style="align-items:center;margin-top:8px"><span>背景色</span><input type="color" id="mbg" value="' + (m.bg || BG) + '"></div>' +
    '<div class="row"><button id="newwin">別ウィンドウで開く</button></div><div class="row"><button id="dmap">この路線図を削除</button></div>' +
    '<h3>路線</h3><ul id="lines">' +
    m.lines.map(x => `<li data-id="${x.id}" class="${x.id === l.id ? 'on' : ''}"><i style="background:${x.color}"></i>${esc(x.name)}</li>`).join('') +
    '</ul><button id="addline">路線を追加</button>' +
    `<h3>選択中の路線</h3><div class="row"><input id="lname" value="${esc(l.name)}"><input type="color" id="lcolor" value="${l.color}"></div>` +
    `<label>線の太さ(${lw(l)})<input type="range" id="lwidth" min="2" max="24" step="1" value="${lw(l)}"></label><button id="dline">この路線を削除</button>` +
    '<h3>幹線道路</h3><ul id="roadlist">' +
    ((m.roads || []).length
      ? m.roads.map(r => `<li data-rid="${r.id}" class="${ui.sel && ui.sel.t === 'road' && ui.sel.id === r.id ? 'on' : ''}"><i style="background:${r.color}"></i>${esc(r.name)}</li>`).join('')
      : '<li style="opacity:.6;cursor:default">まだありません</li>') +
    '</ul><button id="addroadp">幹線道路を引く</button>';
}
/* ---------- 左パネル: 選択中の路線の駅(並べ替え) ---------- */
function stationGlyph(s, l) {
  const c = s.color || l.color, sh = s.shape || 'circle';
  const body = sh === 'square' ? `<rect x="2" y="2" width="10" height="10" fill="${c}"/>`
    : sh === 'diamond' ? `<polygon points="7,1.5 12.5,7 7,12.5 1.5,7" fill="${c}"/>`
    : `<circle cx="7" cy="7" r="5" fill="${c}"/>`;
  return `<svg width="14" height="14" viewBox="0 0 14 14">${body}${sh === 'double' ? '<circle cx="7" cy="7" r="2.4" fill="#fff"/>' : ''}</svg>`;
}
// 選択中の路線の駅を、線を引く順(経路)に並べて表示
function renderLeft() {
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
  el.innerHTML = `<h3><i style="background:${l.color}"></i>${esc(l.name)} の駅</h3>` +
    '<p class="note">上から順に線を引く経路です。↑↓ボタンかドラッグで並べ替えると線の形が変わります(踏切は位置を保ちます)。行をクリックするとその駅を選択して表示を移動します</p>' +
    (l.stations.length ? `<ul class="linklist" id="stlist">${rows}</ul>` : '<p class="note">まだ駅がありません</p>');
}
// 駅の並べ替え。踏切が指す区間を保てるよう keepCrossings で囲む
function moveStation(l, from, to) {
  keepCrossings(l, () => {
    const s = l.stations.splice(from, 1)[0];
    l.stations.splice(to, 0, s);
  });
  save(); renderAll();
}
function centerStation(s) {
  const st = document.getElementById('stage');
  st.scrollLeft = (s.x + 4) * ui.zoom - st.clientWidth / 2;
  st.scrollTop = (s.y + 4) * ui.zoom - st.clientHeight / 2;
}
function renderAll() {
  const hm = ui.home;
  document.getElementById('stage').style.display = hm ? 'none' : '';
  document.getElementById('side').style.display = hm ? 'none' : '';
  document.getElementById('left').style.display = hm ? 'none' : '';
  document.getElementById('tools').style.display = hm ? 'none' : '';
  document.getElementById('hint').style.display = hm ? 'none' : '';
  document.getElementById('home').style.display = hm ? 'block' : 'none';
  renderTabs();
  if (hm) { renderHome(); return; }
  renderTools(); renderCanvas(); renderSide(); renderLeft();
}

/* ---------- editing ---------- */
// 乗り換え(複数路線に共有)のON/OFF。OFFのときは通常の駅に戻るので、必ずどこかの路線に乗せる
function setHub(st, on) {
  if (!st) return;
  const m = curMap();
  if (on) { st.hub = true; return; }
  st.hub = false;
  const home = m.lines.find(x => x.id === ui.line) || m.lines[0];
  if (home && !home.stations.some(y => y.id === st.id)) home.stations.push(st);
  m.lines.forEach(x => { if (x.id !== home.id) x.stations = x.stations.filter(y => y.id !== st.id); });
  m.hubs = (m.hubs || []).filter(y => y.id !== st.id);   // 路線外の置き場所からは外す
}
function addStation(p) {
  const l = curLine(), m = curMap();
  const r = project(l, p);
  ensureRoom(m, p.x, p.y); if (r) ensureRoom(m, r.x, r.y);
  const q = { x: clamp(Math.round(p.x / G) * G, 0, mw(m)), y: clamp(Math.round(p.y / G) * G, 0, mh(m)) };
  const st = mkStation('駅' + (l.stations.length + 1), q.x, q.y);
  keepCrossings(l, () => {
    if (!document.getElementById('snap').checked) { st.x = clamp(Math.round(p.x), 0, mw(m)); st.y = clamp(Math.round(p.y), 0, mh(m)); }
    if (r && r.d < 14) { st.x = Math.round(r.x); st.y = Math.round(r.y); l.stations.splice(r.seg + 1, 0, st); }
    else l.stations.push(st);
  });
  ui.sel = { t: 'st', id: st.id };
  afterAdd(); save(); renderAll();
}
function addHubStation(p) {
  const m = curMap();
  ensureRoom(m, p.x, p.y);
  const q = { x: clamp(Math.round(p.x / G) * G, 0, mw(m)), y: clamp(Math.round(p.y / G) * G, 0, mh(m)) };
  const n = m.lines.reduce((n, x) => n + x.stations.length, 0) + (m.hubs || []).length + 1;
  const st = mkStation('乗換駅' + n, q.x, q.y);
  st.hub = true;
  // どの路線にも属さない独立した乗り換え駅として置く(右パネルのチェックリストで路線に組み込める)
  (m.hubs = m.hubs || []).push(st);
  ui.sel = { t: 'st', id: st.id };
  ui.tool = 'select';
  save(); renderAll();
}
/* --- バス停(独立要素) --- */
function addBusStop(p, kind) {
  const m = curMap();
  ensureRoom(m, p.x, p.y);
  const q = { x: clamp(Math.round(p.x / G) * G, 0, mw(m)), y: clamp(Math.round(p.y / G) * G, 0, mh(m)) };
  m.stops = m.stops || [];
  const n = m.stops.filter(s => (s.kind || 'stop') === kind).length + 1;
  const st = mkBusStop((kind === 'terminal' ? 'バスターミナル' : 'バス停') + n, q.x, q.y, kind);
  m.stops.push(st);
  ui.sel = { t: 'stop', id: st.id };
  afterAdd(); save(); renderAll();
}
/* --- 幹線道路(独立要素・頂点をクリックして引く) --- */
function startRoadDrawing() { ui.drawing = { pts: [], hover: null }; renderAll(); }
function finishRoad() {
  const d = ui.drawing; ui.drawing = null;
  if (d && d.pts.length >= 2) {
    const m = curMap();
    m.roads = m.roads || [];
    const used = new Set([...m.roads.map(r => r.color), ...m.lines.map(x => x.color)]);
    const color = COLORS.find(c => !used.has(c)) || COLORS[m.roads.length % COLORS.length];
    const r = mkRoad('幹線道路 ' + (m.roads.length + 1), color, d.pts);
    m.roads.push(r);
    ui.sel = { t: 'road', id: r.id };
    ui.tool = 'select';
    save();
  } else {
    ui.tool = 'select';   // 頂点不足なら中止
  }
  renderAll();
}
function cancelRoad() { ui.drawing = null; ui.tool = 'select'; renderAll(); }
function addRoadPoint(p) {
  const m = curMap();
  ensureRoom(m, p.x, p.y);
  const snap = document.getElementById('snap').checked;
  const q = { x: clamp(snap ? Math.round(p.x / G) * G : Math.round(p.x), 0, mw(m)), y: clamp(snap ? Math.round(p.y / G) * G : Math.round(p.y), 0, mh(m)) };
  const d = ui.drawing;
  // 最初の頂点付近をクリックしたら閉じて確定
  if (d.pts.length >= 2 && dist(d.pts[0], q) < 14) { finishRoad(); return; }
  d.pts.push(q);
  updateRoadHint();
  renderCanvas();
}
// 描画中にいることを下のヒントに表示する
function updateRoadHint() {
  const n = ui.drawing ? ui.drawing.pts.length : 0;
  document.getElementById('hint').textContent =
    n ? `頂点を${n}個配置 — Enterで確定 / Ctrl+Zで1つ戻す / Escで中止` : HINTS.road;
}
function addCrossing(p) {
  let best = null;
  curMap().lines.forEach(l => { const r = project(l, p); if (r && r.d < 18 && (!best || r.d < best.r.d)) best = { l, r }; });
  if (!best) return;
  const q = snapCx(best.l, best.r), c = { id: uid(), seg: q.seg, t: q.t, name: '' };
  best.l.crossings.push(c);
  ui.line = best.l.id; ui.sel = { t: 'cx', id: c.id };
  afterAdd(); save(); renderAll();
}
// 1つの要素を削除(□で選んだ複数をまとめて削除するときも使う)
function delOne(sel) {
  const m = curMap(), id = sel.id;
  if (sel.t === 'st') {
    const s = findStation(id);
    if (s && s.hub) {   // 乗り換え駅は、すべての路線と路線外の置き場所から削除
      m.lines.forEach(x => { x.stations = x.stations.filter(st => st.id !== id); });
      m.hubs = (m.hubs || []).filter(st => st.id !== id);
    } else {
      const home = m.lines.find(x => x.stations.some(st => st.id === id)) || curLine();
      keepCrossings(home, () => { home.stations = home.stations.filter(st => st.id !== id); });
    }
    pruneLinks();   // この駅を指している接続リストも掃除する
  }
  else if (sel.t === 'stop') m.stops = (m.stops || []).filter(s => s.id !== id);
  else if (sel.t === 'road') m.roads = (m.roads || []).filter(r => r.id !== id);
  else if (sel.t === 'bx') m.boxes = (m.boxes || []).filter(b => b.id !== id);
  else if (sel.t === 'cx') {
    const owner = m.lines.find(l => l.crossings.some(c => c.id === id));   // 所属する路線から削除
    if (owner) owner.crossings = owner.crossings.filter(c => c.id !== id);
  }
}
function del() {
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

/* ---------- canvas events ---------- */
const cv = document.getElementById('cv'), stage = document.getElementById('stage');
const pt = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / ui.zoom, y: (e.clientY - r.top) / ui.zoom }; };
const snapPt = p => document.getElementById('snap').checked ? { x: Math.round(p.x / G) * G, y: Math.round(p.y / G) * G } : p;
function afterAdd() { if (document.getElementById('autosel').checked) ui.tool = 'select'; }
// 踏切の位置をグリッド上の点に合わせる
function snapCx(l, r) {
  if (!document.getElementById('snap').checked) return r;
  const a = l.stations[r.seg], b = l.stations[r.seg + 1], g = { x: Math.round(r.x / G) * G, y: Math.round(r.y / G) * G };
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  return { seg: r.seg, t: l2 ? clamp(((g.x - a.x) * dx + (g.y - a.y) * dy) / l2, 0, 1) : 0 };
}
function applyZoom() {
  const m = curMap(), w = mw(m), h = mh(m);
  cv.setAttribute('width', w * ui.zoom); cv.setAttribute('height', h * ui.zoom);
  cv.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const z = document.getElementById('zlabel'); if (z) z.textContent = Math.round(ui.zoom * 100) + '%';
}
function setZoom(z, cx, cy) {
  z = clamp(z, 0.25, 3);
  const r = stage.getBoundingClientRect();
  if (cx === undefined) { cx = r.width / 2; cy = r.height / 2; }
  const wx = (stage.scrollLeft + cx) / ui.zoom, wy = (stage.scrollTop + cy) / ui.zoom;
  ui.zoom = z; applyZoom();
  stage.scrollLeft = wx * z - cx; stage.scrollTop = wy * z - cy;
}
stage.addEventListener('wheel', e => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  const r = stage.getBoundingClientRect();
  setZoom(ui.zoom * Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
let drag = null;
let band = null;   // 空白のドラッグで引く□(矩形選択)
let spaceDown = false, pan = null;   // Space+ドラッグ / 中ボタンで画面をスクロール

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
    const q = snapPt(p), b = { id: uid(), x: q.x, y: q.y, w: G * 6, h: G * 3, text: 'ラベル', fill: '#ffffff' };
    (m.boxes = m.boxes || []).push(b);
    ui.sel = { t: 'bx', id: b.id }; drag = { t: 'bxnew', id: b.id, a: q, p0: p };
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
    ensureRoom(m, q.x, q.y);
    s.x = clamp(q.x, 0, mw(m)); s.y = clamp(q.y, 0, mh(m));
    // 乗り換え駅の場合はすべての路線の同じ駅を更新
    if (s.hub) m.lines.forEach(x => {
      const st = x.stations.find(st => st.id === s.id);
      if (st) { st.x = s.x; st.y = s.y; }
    });
  } else if (drag.t === 'stname') {
    const s = findStation(drag.id); if (!s) return;
    const q = snapPt(p);
    s.nameX = q.x - drag.ox - s.x;
    s.nameY = q.y - drag.oy - s.y;
  } else if (drag.t === 'cx') {
    const c = l.crossings.find(c => c.id === drag.id); if (!c) return;
    const r = project(l, p);
    if (r) { const q = snapCx(l, r); c.seg = q.seg; c.t = q.t; }
  } else if (drag.t === 'stop') {
    const s = (m.stops || []).find(s => s.id === drag.id); if (!s) return;
    const q = snapPt({ x: p.x - drag.ox, y: p.y - drag.oy });
    ensureRoom(m, q.x, q.y);
    s.x = clamp(q.x, 0, mw(m)); s.y = clamp(q.y, 0, mh(m));
  } else if (drag.t === 'stopname') {
    const s = (m.stops || []).find(s => s.id === drag.id); if (!s) return;
    const q = snapPt(p);
    s.nameX = q.x - drag.ox - s.x;
    s.nameY = q.y - drag.oy - s.y;
  } else if (drag.t === 'road') {
    const r = (m.roads || []).find(r => r.id === drag.id); if (!r) return;
    const q = snapPt({ x: p.x - drag.ox, y: p.y - drag.oy });
    const dx = q.x - drag.start[0].x, dy = q.y - drag.start[0].y;
    const maxR = Math.max(...r.pts.map(pt => pt.x)) + dx, maxD = Math.max(...r.pts.map(pt => pt.y)) + dy;
    ensureRoom(m, maxR, maxD);
    r.pts.forEach((pt, i) => { pt.x = clamp(drag.start[i].x + dx, 0, mw(m)); pt.y = clamp(drag.start[i].y + dy, 0, mh(m)); });
  } else if (drag.t === 'roadpt') {
    const r = (m.roads || []).find(r => r.id === drag.id); if (!r) return;
    const q = snapPt(p);
    ensureRoom(m, q.x, q.y);
    r.pts[drag.i] = { x: clamp(q.x, 0, mw(m)), y: clamp(q.y, 0, mh(m)) };
  } else {
    const b = (m.boxes || []).find(b => b.id === drag.id); if (!b) return;
    if (drag.t === 'bx') { const q = snapPt({ x: p.x - drag.ox, y: p.y - drag.oy }); ensureRoom(m, q.x + b.w, q.y + b.h); b.x = clamp(q.x, 0, mw(m) - b.w); b.y = clamp(q.y, 0, mh(m) - b.h); }
    else if (drag.t === 'bxr') { const q = snapPt(p); ensureRoom(m, q.x, q.y); b.w = Math.max(G, q.x - b.x); b.h = Math.max(G, q.y - b.y); }
    else if (drag.t === 'bxnew') {
      if (!drag.moved && Math.hypot(p.x - drag.p0.x, p.y - drag.p0.y) < 4) return;
      drag.moved = true;
      const q = snapPt(p);
      ensureRoom(m, q.x, q.y);
      b.x = Math.min(drag.a.x, q.x); b.y = Math.min(drag.a.y, q.y);
      b.w = Math.max(G, Math.abs(q.x - drag.a.x)); b.h = Math.max(G, Math.abs(q.y - drag.a.y));
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
  if (b.id === 'exp') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }));
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
      if (!Array.isArray(d.maps) || !d.maps.length || !d.maps.every(m => Array.isArray(m.lines) && m.lines.length)) throw 0;
      S = migrate(d);
      ui = { map: S.maps[0].id, line: S.maps[0].lines[0].id, sel: null, tool: 'select', open: S.maps.map(m => m.id), home: false, zoom: ui.zoom, drawing: null }; persistOpen();
      save(); renderAll();
    } catch (err) { alert('読み込めませんでした。書き出したJSONファイルを選んでください。'); }
  };
  r.readAsText(f); e.target.value = '';
});
function persistOpen() { if (!location.hash) try { localStorage.setItem('railopen', JSON.stringify(ui.open)); } catch (e) {} }
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
function openMap(id) {
  if (!ui.open.includes(id)) ui.open.push(id);
  ui.map = id; ui.line = curMap().lines[0].id; ui.sel = null; ui.home = false;
  syncView(); persistOpen(); renderAll();
}
function closeTab(id) {
  const i = ui.open.indexOf(id); if (i < 0) return;
  ui.open.splice(i, 1);
  if (ui.map === id) {
    const n = ui.open[Math.min(i, ui.open.length - 1)];
    if (n) { ui.map = n; ui.line = curMap().lines[0].id; ui.sel = null; } else ui.home = true;
  }
  syncView(); persistOpen(); renderAll();
}
function newMap() { const m = mkMap('路線図 ' + (S.maps.length + 1)); S.maps.push(m); save(); openMap(m.id); }
function deleteMap(id) {
  S.maps = S.maps.filter(x => x.id !== id);
  if (!S.maps.length) S.maps.push(mkMap('路線図 1'));
  save();                       // 表示を切り替える前に履歴へ(削除前の路線図に戻せるように)
  ui.open = ui.open.filter(x => x !== id);
  if (ui.map === id) {
    if (ui.open.length) { ui.map = ui.open[0]; ui.line = curMap().lines[0].id; ui.sel = null; } else ui.home = true;
  }
  syncView(); persistOpen(); renderAll();
}
// Ctrl+W から呼ばれる。true=路線図を閉じた(アプリは閉じない) / false=開いている路線図がないのでウィンドウを閉じてよい
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

/* ---------- side panel ---------- */
const side = document.getElementById('side');
side.addEventListener('input', e => {
  const id = e.target.id, v = e.target.value, m = curMap(), l = curLine();
  if (id === 'mname') { m.name = v; renderTabs(); }
  else if (id === 'lname') l.name = v;
  else if (id === 'mbg') { m.bg = v; renderCanvas(); }
  else if (id === 'btext') { m.boxes.find(b => b.id === ui.sel.id).text = v; renderCanvas(); }
  else if (id === 'bfill') { m.boxes.find(b => b.id === ui.sel.id).fill = v; renderCanvas(); }
  else if (id === 'sshape') {
    const s = findStation(ui.sel.id);
    if (s) { s.shape = v; renderCanvas(); }
  }
  else if (id === 'bsname') { const s = (m.stops || []).find(s => s.id === ui.sel.id); if (s) { s.name = v; renderCanvas(); } }
  else if (id === 'bskind') { const s = (m.stops || []).find(s => s.id === ui.sel.id); if (s) { s.kind = v; save(); renderAll(); } }
  else if (id === 'bscolor') { const s = (m.stops || []).find(s => s.id === ui.sel.id); if (s) { s.color = v; renderCanvas(); } }
  else if (id === 'bsnameRot') { const s = (m.stops || []).find(s => s.id === ui.sel.id); if (s) { s.nameRot = +v; renderCanvas(); } }
  else if (id === 'rname') { const r = (m.roads || []).find(r => r.id === ui.sel.id); if (r) { r.name = v; renderSide(); } }
  else if (id === 'rcolor') { const r = (m.roads || []).find(r => r.id === ui.sel.id); if (r) { r.color = v; renderCanvas(); } }
  else if (id === 'rwidth') {
    const r = (m.roads || []).find(r => r.id === ui.sel.id);
    if (r) { r.width = +v; e.target.parentNode.firstChild.textContent = '幅(' + v + ')'; renderCanvas(); }
  }
  else if (id === 'scolor') { const s = findStation(ui.sel.id); if (s) { s.color = v; renderCanvas(); } }
  else if (id === 'snameRot') { const s = findStation(ui.sel.id); if (s) { s.nameRot = +v; renderCanvas(); } }
  else if (id === 'shub') {
    setHub(findStation(ui.sel.id), e.target.checked);
    save(); renderAll();
  }
  else if (e.target.classList && e.target.classList.contains('shubline')) {
    const s = findStation(ui.sel.id), cm = curMap();
    const target = cm.lines.find(x => x.id === e.target.dataset.lid);
    if (!s || !target) return;
    const has = target.stations.some(st => st.id === s.id);
    if (e.target.checked && !has) {
      target.stations.push(s);                                   // 路線に組み込む
      cm.hubs = (cm.hubs || []).filter(x => x.id !== s.id);      // 路線外の置き場所からは外す
      // 「路線外」にまとめていた接続は、初めて乗る路線のリストへ移す
      const alone = !cm.lines.some(x => x.id !== target.id && x.stations.some(st => st.id === s.id));
      if (alone && s.links && Array.isArray(s.links[OFF_LINK])) {
        s.links[target.id] = s.links[OFF_LINK].slice();
        delete s.links[OFF_LINK];
      }
    } else if (!e.target.checked && has) {
      target.stations = target.stations.filter(st => st.id !== s.id);
      // どの路線にも属さなくなったら、路線外の乗り換え駅として残す(消さない)
      if (!cm.lines.some(x => x.stations.some(st => st.id === s.id))) {
        flattenLinks(s);   // 路線ごとの接続は「路線外」にまとめる
        (cm.hubs = cm.hubs || []).push(s);
      }
    }
    save(); renderAll();
  }
  else if (id === 'lwidth') { l.width = +v; e.target.parentNode.firstChild.textContent = '線の太さ(' + v + ')'; renderCanvas(); }
  else if (id === 'lcolor') { l.color = v; renderCanvas(); }
  else if (id === 'sname') {
    const s = findStation(ui.sel.id);
    if (s) {
      s.name = v;
      if (s.hub) curMap().lines.forEach(x => { const st = x.stations.find(st => st.id === s.id); if (st) st.name = v; });
      renderCanvas();
    }
  }
  else if (id === 'cname') { l.crossings.find(c => c.id === ui.sel.id).name = v; renderCanvas(); }
  // 文字入力とスライダーの連続操作は、まとめて1回の履歴にする
  if (['mname', 'lname', 'sname', 'bsname', 'rname', 'cname', 'btext'].includes(id) || e.target.type === 'range') deferSave();
  else save();
});
side.addEventListener('change', e => {
  if (e.target.id === 'gap') {
    const l = curMap().lines.find(x => x.id === e.target.dataset.lid) || curLine();
    const i = l.stations.findIndex(s => s.id === ui.sel.id);
    if (i > 0) {
      const a = l.stations[i - 1], b = l.stations[i], d = Math.max(0.5, parseFloat(e.target.value) || 1) * G;
      const len = dist(a, b), ux = len ? (b.x - a.x) / len : 1, uy = len ? (b.y - a.y) / len : 0;
      const nx = a.x + ux * d - b.x, ny = a.y + uy * d - b.y;
      for (let j = i; j < l.stations.length; j++) { l.stations[j].x += nx; l.stations[j].y += ny; }
    }
    save(); renderAll(); return;
  }
  if (e.target.id === 'bw' || e.target.id === 'bh') {
    const b = (curMap().boxes || []).find(b => b.id === ui.sel.id), v = Math.max(1, Math.round(+e.target.value) || 1) * G;
    if (e.target.id === 'bw') b.w = v; else b.h = v;
    save(); renderAll(); return;
  }
  renderSide();
});
side.addEventListener('click', e => {
  const btn = e.target.closest('button'); if (btn) btn.blur();
  const m = curMap(), li = e.target.closest('#lines li'), rli = e.target.closest('#roadlist li[data-rid]'), id = e.target.id;
  if (li) { ui.line = li.dataset.id; ui.sel = null; renderAll(); }
  else if (rli) { ui.sel = { t: 'road', id: rli.dataset.rid }; ui.tool = 'select'; renderAll(); }
  else if (id === 'sreset') { const s = findStation(ui.sel.id); if (s) delete s.color; save(); renderAll(); }
  else if (id === 'bsreset') { const s = (m.stops || []).find(s => s.id === ui.sel.id); delete s.color; save(); renderAll(); }
  else if (id === 'droad') { m.roads = (m.roads || []).filter(r => r.id !== ui.sel.id); ui.sel = null; save(); renderAll(); }
  // --- 乗り換え駅の「接続する駅」リスト(路線ごと) ---
  else if (e.target.classList && e.target.classList.contains('linkadd')) {
    const s = findStation(ui.sel && ui.sel.id), box = e.target.closest('[data-lid]');
    const selEl = box && box.querySelector('.linksel');
    if (s && selEl && selEl.value) {
      const lid = box.dataset.lid;
      if (!s.links || typeof s.links !== 'object') s.links = {};
      s.links[lid] = linksIn(s, lid).concat(selEl.value);
      save(); renderAll();
    }
  }
  else if (e.target.classList && (e.target.classList.contains('lup') || e.target.classList.contains('ldown') || e.target.classList.contains('ldel'))) {
    const list = e.target.closest('.linklist'), row = list && e.target.closest('li');
    const s = findStation(ui.sel && ui.sel.id);
    if (!list || !row || !s) return;
    const lid = list.dataset.lid, links = linksIn(s, lid), k = links.indexOf(row.dataset.id);
    if (k < 0) return;
    if (e.target.classList.contains('ldel')) links.splice(k, 1);
    else if (e.target.classList.contains('lup') && k > 0) links.splice(k - 1, 0, links.splice(k, 1)[0]);
    else if (e.target.classList.contains('ldown') && k < links.length - 1) links.splice(k + 1, 0, links.splice(k, 1)[0]);
    else return;
    if (!s.links || typeof s.links !== 'object') s.links = {};
    s.links[lid] = links; save(); renderAll();
  }
  else if (id === 'newwin') window.open('index.html#' + encodeURIComponent(m.id));
  else if (id === 'addline') {
    const n = m.lines.length, l = mkLine((n + 1) + '号線', COLORS[n % COLORS.length]);
    m.lines.push(l); ui.line = l.id; ui.sel = null; save(); renderAll();
  } else if (id === 'addroadp') {
    if (ui.drawing) finishRoad();
    ui.tool = 'road'; startRoadDrawing(); renderTools();
  } else if (id === 'dline') {
    const deadId = m.lines.length > 1 ? ui.line : null;   // 削除する路線のID
    if (m.lines.length > 1) {
      const gone = m.lines.find(x => x.id === ui.line);
      m.lines = m.lines.filter(x => x.id !== ui.line);
      ui.line = m.lines[0].id;
      // 消えた路線にしか無かった乗り換え駅は、路線外の乗り換え駅として残す(路線に依存させない)
      (gone ? gone.stations : []).forEach(st => {
        if (st.hub && !m.lines.some(x => x.stations.some(y => y.id === st.id)) &&
            !(m.hubs || []).some(y => y.id === st.id)) (m.hubs = m.hubs || []).push(st);
      });
    } else {
      const only = m.lines[0];
      const hubs = only.stations.filter(st => st.hub);   // 最後の路線を空にするときも乗り換え駅は残す
      only.stations = []; only.crossings = [];
      hubs.forEach(st => { if (!(m.hubs || []).some(y => y.id === st.id)) (m.hubs = m.hubs || []).push(st); });
    }
    // 路線に属さなくなった乗り換え駅の接続は「路線外」へ、消えた路線ごとの接続は捨てる
    (m.hubs || []).forEach(st => { if (!m.lines.some(l => l.stations.some(x => x.id === st.id))) flattenLinks(st); });
    if (deadId) allStations(m).forEach(st => { if (st.links && st.links[deadId]) delete st.links[deadId]; });
    pruneLinks();   // 路線ごと消した駅への接続を外す
    ui.sel = null; save(); renderAll();
  } else if (id === 'dmap') {
    if (!confirm('「' + m.name + '」を削除しますか?')) return;
    deleteMap(m.id);
  }
});

/* ---------- 接続駅リストのドラッグ並べ替え(路線ごと) ---------- */
let linkDrag = null;   // { id, lid } 同じリストの中でのみ入れ替え可
const linkRow = e => (e.target && e.target.closest) ? e.target.closest('.linklist li') : null;
const linkList = row => row.closest('.linklist');
side.addEventListener('dragstart', e => {
  const row = linkRow(e); if (!row) return;
  const list = linkList(row); if (!list) return;
  linkDrag = { id: row.dataset.id, lid: list.dataset.lid };
  row.classList.add('dragging');
  try { e.dataTransfer.setData('text/plain', linkDrag.id); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
});
side.addEventListener('dragover', e => {
  const row = linkRow(e); if (!row || !linkDrag) return;
  const list = linkList(row);
  if (!list || list.dataset.lid !== linkDrag.lid) return;   // 別路線のリストには置けない
  e.preventDefault();
  try { e.dataTransfer.dropEffect = 'move'; } catch (err) {}
  row.classList.add('dropto');
});
side.addEventListener('dragleave', e => {
  const row = linkRow(e); if (row) row.classList.remove('dropto');
});
side.addEventListener('drop', e => {
  const row = linkRow(e); if (!row || !linkDrag) return;
  const list = linkList(row);
  if (!list || list.dataset.lid !== linkDrag.lid) { linkDrag = null; return; }   // 別路線へは移動しない
  e.preventDefault();
  const s = findStation(ui.sel && ui.sel.id), lid = linkDrag.lid;
  const links = s ? linksIn(s, lid) : [];
  const from = links.indexOf(linkDrag.id), to = links.indexOf(row.dataset.id);
  linkDrag = null;
  if (from >= 0 && to >= 0 && from !== to) {
    links.splice(to, 0, links.splice(from, 1)[0]);
    if (!s.links || typeof s.links !== 'object') s.links = {};
    s.links[lid] = links; save(); renderAll();
  }
});
side.addEventListener('dragend', () => {
  linkDrag = null;
  document.querySelectorAll('.linklist .dragging, .linklist .dropto').forEach(x => x.classList.remove('dragging', 'dropto'));
});

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

// 別ウィンドウでの変更を取り込む
window.addEventListener('storage', e => {
  if (e.key !== 'railmaps' || !e.newValue || drag) return;
  try {
    const d = JSON.parse(e.newValue);
    if (!Array.isArray(d.maps) || !d.maps.length) return;
    S = d;
    // 別ウィンドウの変更を取り込んだ時点で履歴をリセット
    lastSnap = snapStr(); lastView = viewNow();
    undoStack.length = 0; redoStack.length = 0; updateUndoButtons();
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

renderAll();
