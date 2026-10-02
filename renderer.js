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
const HINTS = {
  select:  '駅や踏切をドラッグして移動 / Deleteキーで削除 / Space+ドラッグで画面移動',
  station: 'クリックで駅を追加(線の上なら間に挿入)',
  hub:     'クリックで乗り換え駅を追加(複数路線に属します)',
  crossing:'線の近くをクリックして踏切を置く',
  box:'ドラッグで四角形(ラベル枠)を追加。クリックだけなら標準サイズ'
};
const SHAPES = { circle: '○ 丸', double: '◎ 二重丸(特急停車駅など)', square: '□ 四角', diamond: '◇ ひし形' };
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const BG = '#f4f6f5';
const mkLine = (name, color) => ({ id: uid(), name, color, width: 8, stations: [], crossings: [] });
const mkMap = name => ({ id: uid(), name, bg: BG, lines: [mkLine('1号線', COLORS[0])] });
const mkStation = (name, x, y) => ({ id: uid(), name, x, y, hub: false });
const lw = l => l.width || 8;
const isDark = hex => { const n = parseInt(hex.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 120; };

let S = null;
try { S = JSON.parse(localStorage.getItem('railmaps')); } catch (e) {}
if (!S || !Array.isArray(S.maps) || !S.maps.length) S = { maps: [mkMap('路線図 1')] };
let ui = { map: S.maps[0].id, line: S.maps[0].lines[0].id, sel: null, tool: 'select', open: S.maps.map(m => m.id), home: false, zoom: 1 };
const hm = S.maps.find(m => m.id === decodeURIComponent(location.hash.slice(1)));   // 別ウィンドウで開いたときの路線図
if (hm) { ui.map = hm.id; ui.line = hm.lines[0].id; ui.open = [hm.id]; }
else {
  try { const o = JSON.parse(localStorage.getItem('railopen')); if (Array.isArray(o)) ui.open = o.filter(id => S.maps.some(m => m.id === id)); } catch (e) {}
  const om = S.maps.find(m => m.id === ui.open[0]);
  if (om) { ui.map = om.id; ui.line = om.lines[0].id; } else ui.home = true;
}

const curMap  = () => S.maps.find(m => m.id === ui.map) || S.maps[0];
const curLine = () => { const m = curMap(); return m.lines.find(l => l.id === ui.line) || m.lines[0]; };
const save = () => { try { localStorage.setItem('railmaps', JSON.stringify(S)); } catch (e) {} };

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
  document.getElementById('hint').textContent = HINTS[ui.tool];
  document.getElementById('cv').style.cursor = ui.tool === 'select' ? 'default' : 'crosshair';
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
  // 4) 駅
  m.lines.forEach(l => {
    const w = lw(l), R = w / 2 + 7, rw = Math.max(5, w * 0.6);
    l.stations.forEach(s => {
      const sel = ui.sel && ui.sel.t === 'st' && ui.sel.id === s.id, c = s.color || l.color, sh = s.shape || 'circle';
      let body, ext;
      if (sh === 'double') { body = `<circle cx="${s.x}" cy="${s.y}" r="${R + 3}" fill="#fff" stroke="${c}" stroke-width="4"/><circle cx="${s.x}" cy="${s.y}" r="${Math.max(3, R - 5)}" fill="#fff" stroke="${c}" stroke-width="3"/>`; ext = R + 5; }
      else if (sh === 'square') { body = `<rect x="${s.x - R}" y="${s.y - R}" width="${R * 2}" height="${R * 2}" rx="2" fill="#fff" stroke="${c}" stroke-width="${rw}"/>`; ext = R + rw / 2; }
      else if (sh === 'diamond') { const d = R * 1.35; body = `<polygon points="${s.x},${s.y - d} ${s.x + d},${s.y} ${s.x},${s.y + d} ${s.x - d},${s.y}" fill="#fff" stroke="${c}" stroke-width="${rw * 0.8}" stroke-linejoin="round"/>`; ext = d + 2; }
      else { body = `<circle cx="${s.x}" cy="${s.y}" r="${R}" fill="#fff" stroke="${c}" stroke-width="${rw}"/>`; ext = R + rw / 2; }
      const nx = s.nameX || 0, ny = s.nameY || 0, rot = s.nameRot || 0;
      const tx = s.x + nx, ty = s.y + ny + ext + 20;
      const hubR = s.hub ? R + 4 : 0;
      h += `<g data-t="st" data-l="${l.id}" data-id="${s.id}">${body}` +
           (s.hub ? `<circle cx="${s.x}" cy="${s.y}" r="${hubR}" fill="none" stroke="${c}" stroke-width="3" stroke-dasharray="5 3"/>` : '') +
           (sel ? `<circle cx="${s.x}" cy="${s.y}" r="${ext + 5}" fill="none" stroke="${fg}" stroke-width="2" stroke-dasharray="4 3"/>` : '') +
           (rot ? `<text class="stname" data-t="stname" data-l="${l.id}" data-id="${s.id}" x="${tx}" y="${ty}" text-anchor="middle" font-size="14" font-weight="700" fill="${fg}" ${halo} style="cursor:move" transform="rotate(${rot} ${tx} ${ty})">${esc(s.name)}</text>`
                : `<text class="stname" data-t="stname" data-l="${l.id}" data-id="${s.id}" x="${tx}" y="${ty}" text-anchor="middle" font-size="14" font-weight="700" fill="${fg}" ${halo} style="cursor:move">${esc(s.name)}</text>`) + '</g>';
    });
  });
  document.getElementById('cv').innerHTML = h;
}

function renderSide() {
  const m = curMap(), l = curLine();
  let sel = '';
  if (ui.sel) {
    if (ui.sel.t === 'st') {
      const i = l.stations.findIndex(s => s.id === ui.sel.id);
      if (i < 0) ui.sel = null;
      else {
        const s = l.stations[i];
        sel = `<h3>選択中の駅</h3><label>駅名<input id="sname" value="${esc(s.name)}"></label>` +
          `<label>形<select id="sshape">${Object.entries(SHAPES).map(([k, v]) => `<option value="${k}"${(s.shape || 'circle') === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>` +
          `<div class="row" style="align-items:center"><span>色</span><input type="color" id="scolor" value="${s.color || l.color}"><button id="sreset">路線の色に戻す</button></div>` +
          `<label>駅名の向き<select id="snameRot"><option value="0"${(s.nameRot || 0) === 0 ? ' selected' : ''}>普通</option><option value="45"${(s.nameRot || 0) === 45 ? ' selected' : ''}>斜め(45°)</option><option value="90"${(s.nameRot || 0) === 90 ? ' selected' : ''}>縦(90°)</option></select></label>` +
          `<label><input type="checkbox" id="shub"${s.hub ? ' checked' : ''}> 乗り換え駅(ターミナルハブ)</label>` +
          (s.hub ? '<div class="note" style="margin-bottom:4px">乗り換え路線:</div>' +
            curMap().lines.map(x => `<label style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><input type="checkbox" class="shubline" data-lid="${x.id}"${x.stations.some(st => st.id === s.id) ? ' checked' : ''} ${x.id === l.id ? 'disabled' : ''}> <i style="display:inline-block;width:18px;height:5px;border-radius:3px;background:${x.color};flex:none"></i>${esc(x.name)}${x.id === l.id ? '(この路線)' : ''}</label>`).join('') : '');
        if (i > 0) sel += `<label>前の駅との間隔(マス)<input id="gap" type="number" min="0.5" step="0.5" value="${(dist(l.stations[i - 1], s) / G).toFixed(1)}"></label><p class="note">変更すると、これ以降の駅も一緒に動きます。</p>`;
      }
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
  document.getElementById('side').innerHTML = sel +
    `<h3>路線図の名前</h3><input id="mname" value="${esc(m.name)}">` +
    '<div class="row" style="align-items:center;margin-top:8px"><span>背景色</span><input type="color" id="mbg" value="' + (m.bg || BG) + '"></div>' +
    '<div class="row"><button id="newwin">別ウィンドウで開く</button></div><div class="row"><button id="dmap">この路線図を削除</button></div>' +
    '<h3>路線</h3><ul id="lines">' +
    m.lines.map(x => `<li data-id="${x.id}" class="${x.id === l.id ? 'on' : ''}"><i style="background:${x.color}"></i>${esc(x.name)}</li>`).join('') +
    '</ul><button id="addline">路線を追加</button>' +
    `<h3>選択中の路線</h3><div class="row"><input id="lname" value="${esc(l.name)}"><input type="color" id="lcolor" value="${l.color}"></div>` +
    `<label>線の太さ(${lw(l)})<input type="range" id="lwidth" min="2" max="24" step="1" value="${lw(l)}"></label><button id="dline">この路線を削除</button>`;
}
function renderAll() {
  const hm = ui.home;
  document.getElementById('stage').style.display = hm ? 'none' : '';
  document.getElementById('side').style.display = hm ? 'none' : '';
  document.getElementById('tools').style.display = hm ? 'none' : '';
  document.getElementById('hint').style.display = hm ? 'none' : '';
  document.getElementById('home').style.display = hm ? 'block' : 'none';
  renderTabs();
  if (hm) { renderHome(); return; }
  renderTools(); renderCanvas(); renderSide();
}

/* ---------- editing ---------- */
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
  const m = curMap(), l = curLine();
  ensureRoom(m, p.x, p.y);
  const q = { x: clamp(Math.round(p.x / G) * G, 0, mw(m)), y: clamp(Math.round(p.y / G) * G, 0, mh(m)) };
  const st = mkStation('乗換駅' + (m.lines.reduce((n, x) => n + x.stations.length, 0) + 1), q.x, q.y);
  st.hub = true;
  // 選択中の路線に追加
  l.stations.push(st);
  ui.sel = { t: 'st', id: st.id };
  ui.tool = 'select';
  save(); renderAll();
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
function del() {
  if (!ui.sel) return;
  const l = curLine(), id = ui.sel.id;
  if (ui.sel.t === 'st') {
    // 乗り換e駅の場合はすべての路線から削除
    const s = l.stations.find(st => st.id === id);
    if (s && s.hub) curMap().lines.forEach(x => { x.stations = x.stations.filter(st => st.id !== id); });
    else keepCrossings(l, () => { l.stations = l.stations.filter(st => st.id !== id); });
  }
  else if (ui.sel.t === 'bx') curMap().boxes = (curMap().boxes || []).filter(b => b.id !== id);
  else l.crossings = l.crossings.filter(c => c.id !== id);
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
  if (ui.tool === 'station') return addStation(p);
  if (ui.tool === 'hub') return addHubStation(p);
  if (ui.tool === 'crossing') return addCrossing(p);
  if (ui.tool === 'box') {
    const q = snapPt(p), b = { id: uid(), x: q.x, y: q.y, w: G * 6, h: G * 3, text: 'ラベル', fill: '#ffffff' };
    (m.boxes = m.boxes || []).push(b);
    ui.sel = { t: 'bx', id: b.id }; drag = { t: 'bxnew', id: b.id, a: q, p0: p };
    renderAll(); return;
  }
  if (el && el.dataset.t === 'bxr') { ui.sel = { t: 'bx', id: el.dataset.id }; drag = { t: 'bxr', id: el.dataset.id }; }
  else if (el.dataset.t === 'stname') {
    const s = curLine().stations.find(s => s.id === el.dataset.id);
    ui.sel = { t: 'st', id: s.id };
    drag = { t: 'stname', id: s.id, ox: p.x - (s.x + (s.nameX || 0)), oy: p.y - (s.y + (s.nameY || 0)) };
  }
  else if (el && el.dataset.t === 'bx') {
    const b = m.boxes.find(b => b.id === el.dataset.id);
    ui.sel = { t: 'bx', id: b.id }; drag = { t: 'bx', id: b.id, ox: p.x - b.x, oy: p.y - b.y };
  }
  else if (el && el.dataset.t !== 'line') { ui.line = el.dataset.l; ui.sel = { t: el.dataset.t, id: el.dataset.id }; drag = { ...ui.sel }; }
  else if (el) { ui.line = el.dataset.l; ui.sel = null; }
  else ui.sel = null;
  renderAll();
});
window.addEventListener('mousemove', e => {
  if (!drag) return;
  const m = curMap(), l = curLine(), p = pt(e);
  if (drag.t === 'st') {
    const s = l.stations.find(s => s.id === drag.id), q = snapPt(p);
    ensureRoom(m, q.x, q.y);
    s.x = clamp(q.x, 0, mw(m)); s.y = clamp(q.y, 0, mh(m));
    // 乗り換e駅の場合はすべての路線の同じ駅を更新
    if (s.hub) curMap().lines.forEach(x => {
      const st = x.stations.find(st => st.id === s.id);
      if (st) { st.x = s.x; st.y = s.y; }
    });
  } else if (drag.t === 'stname') {
    const s = l.stations.find(s => s.id === drag.id);
    const q = snapPt(p);
    s.nameX = q.x - drag.ox - s.x;
    s.nameY = q.y - drag.oy - s.y;
  } else if (drag.t === 'cx') {
    const c = l.crossings.find(c => c.id === drag.id), r = project(l, p);
    if (r) { const q = snapCx(l, r); c.seg = q.seg; c.t = q.t; }
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
window.addEventListener('mouseup', () => {
  if (!drag) return;
  const was = drag; drag = null; save();
  if (was.t === 'bxnew') { afterAdd(); renderAll(); }
});
window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') { e.preventDefault(); if (!window.__closeTab()) window.close(); return; }
  if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (e.key === 'Delete' || e.key === 'Backspace') del();
  if (e.key === 'Escape') { ui.tool = 'select'; renderTools(); }
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
  if (b.dataset.tool) { ui.tool = b.dataset.tool; renderTools(); }
  if (b.id === 'del') del();
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
      S = d; ui = { map: S.maps[0].id, line: S.maps[0].lines[0].id, sel: null, tool: 'select', open: S.maps.map(m => m.id), home: false, zoom: ui.zoom }; persistOpen();
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
  persistOpen(); renderAll();
}
function closeTab(id) {
  const i = ui.open.indexOf(id); if (i < 0) return;
  ui.open.splice(i, 1);
  if (ui.map === id) {
    const n = ui.open[Math.min(i, ui.open.length - 1)];
    if (n) { ui.map = n; ui.line = curMap().lines[0].id; ui.sel = null; } else ui.home = true;
  }
  persistOpen(); renderAll();
}
function newMap() { const m = mkMap('路線図 ' + (S.maps.length + 1)); S.maps.push(m); save(); openMap(m.id); }
function deleteMap(id) {
  S.maps = S.maps.filter(x => x.id !== id);
  if (!S.maps.length) S.maps.push(mkMap('路線図 1'));
  ui.open = ui.open.filter(x => x !== id);
  if (ui.map === id) {
    if (ui.open.length) { ui.map = ui.open[0]; ui.line = curMap().lines[0].id; ui.sel = null; } else ui.home = true;
  }
  save(); persistOpen(); renderAll();
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
  else if (id === 'sshape') { l.stations.find(s => s.id === ui.sel.id).shape = v; renderCanvas(); }
  else if (id === 'scolor') { l.stations.find(s => s.id === ui.sel.id).color = v; renderCanvas(); }
  else if (id === 'snameRot') { l.stations.find(s => s.id === ui.sel.id).nameRot = +v; renderCanvas(); }
  else if (id === 'shub') {
    const s = l.stations.find(s => s.id === ui.sel.id);
    s.hub = e.target.checked;
    if (!s.hub) {
      // 乗り換e駅を解除：他の路線からこの駅を削除
      curMap().lines.forEach(x => { x.stations = x.stations.filter(st => st.id !== s.id); });
      l.stations.push(s);
    }
    save(); renderAll();
  }
  else if (e.target.classList && e.target.classList.contains('shubline')) {
    const s = l.stations.find(s => s.id === ui.sel.id), lid = e.target.dataset.lid;
    const target = curMap().lines.find(x => x.id === lid);
    if (!s || !target) return;
    const has = target.stations.some(st => st.id === s.id);
    if (e.target.checked && !has) target.stations.push(s);
    else if (!e.target.checked && has) target.stations = target.stations.filter(st => st.id !== s.id);
    save(); renderAll();
  }
  else if (id === 'lwidth') { l.width = +v; e.target.parentNode.firstChild.textContent = '線の太さ(' + v + ')'; renderCanvas(); }
  else if (id === 'lcolor') { l.color = v; renderCanvas(); }
  else if (id === 'sname') {
    const s = l.stations.find(s => s.id === ui.sel.id);
    s.name = v;
    if (s.hub) curMap().lines.forEach(x => { const st = x.stations.find(st => st.id === s.id); if (st) st.name = v; });
    renderCanvas();
  }
  else if (id === 'cname') { l.crossings.find(c => c.id === ui.sel.id).name = v; renderCanvas(); }
  save();
});
side.addEventListener('change', e => {
  if (e.target.id === 'gap') {
    const l = curLine(), i = l.stations.findIndex(s => s.id === ui.sel.id);
    const a = l.stations[i - 1], b = l.stations[i], d = Math.max(0.5, parseFloat(e.target.value) || 1) * G;
    const len = dist(a, b), ux = len ? (b.x - a.x) / len : 1, uy = len ? (b.y - a.y) / len : 0;
    const nx = a.x + ux * d - b.x, ny = a.y + uy * d - b.y;
    for (let j = i; j < l.stations.length; j++) { l.stations[j].x += nx; l.stations[j].y += ny; }
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
  const m = curMap(), li = e.target.closest('#lines li'), id = e.target.id;
  if (li) { ui.line = li.dataset.id; ui.sel = null; renderAll(); }
  else if (id === 'sreset') { delete curLine().stations.find(s => s.id === ui.sel.id).color; save(); renderAll(); }
  else if (id === 'newwin') window.open('index.html#' + encodeURIComponent(m.id));
  else if (id === 'addline') {
    const n = m.lines.length, l = mkLine((n + 1) + '号線', COLORS[n % COLORS.length]);
    m.lines.push(l); ui.line = l.id; ui.sel = null; save(); renderAll();
  } else if (id === 'dline') {
    if (m.lines.length > 1) { m.lines = m.lines.filter(x => x.id !== ui.line); ui.line = m.lines[0].id; }
    else { m.lines[0].stations = []; m.lines[0].crossings = []; }
    ui.sel = null; save(); renderAll();
  } else if (id === 'dmap') {
    if (!confirm('「' + m.name + '」を削除しますか?')) return;
    deleteMap(m.id);
  }
});

// 別ウィンドウでの変更を取り込む
window.addEventListener('storage', e => {
  if (e.key !== 'railmaps' || !e.newValue || drag) return;
  try {
    const d = JSON.parse(e.newValue);
    if (!Array.isArray(d.maps) || !d.maps.length) return;
    S = d;
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
