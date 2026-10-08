/* ===========================================================================
   地図の描画とビューポート(ズーム・スクロール)。描画だけを担当する。
   (元は src/ui/renderer.js の1ファイル。指示書 §8〜§12 に沿って画面側を分割した)
   =========================================================================== */
import { S, G, mw, mh, clamp, lw, isDark, BG, findStationIn, linesOfIn, allStations, STOP_COLOR, OFF_LINK } from '../core/model.js';
import { dist, isLoop, segCount, segA, segB, segPt } from '../core/geometry.js';
import { esc, ui, curMap, curLine, findStation, linesOf, showEl, getBulk, rectOf, BAND_COLOR } from './ui-state.js';

// いま引いている□(矩形選択)は画面側(renderer)が持つ。描画時にそちらから受け取る
let bandOf = () => null;
export function setBandSource(fn) { bandOf = fn; }

export function renderCanvas() {
  const band = bandOf();   // 空白ドラッグ中は画面側の□を描く
  const m = curMap(), bg = m.bg || BG, dark = isDark(bg);
  const fg = dark ? '#f2f5f4' : '#1f2d36', sub = dark ? '#9fb0b8' : '#6b7c84';
  const halo = `style="paint-order:stroke;stroke:${bg};stroke-width:4px"`;
  document.getElementById('stage').style.background = bg;
  applyZoom();
  const cw = mw(m), ch = mh(m);
  let h = `<defs><pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="${fg}" stroke-opacity=".1" stroke-width="1"/></pattern></defs>` +
          `<rect width="${cw}" height="${ch}" fill="${bg}"/><rect width="${cw}" height="${ch}" fill="url(#g)"/>` +
          `<rect width="${cw}" height="${ch}" fill="none" stroke="${fg}" stroke-opacity=".35" stroke-width="2" stroke-dasharray="8 6"/>`;
  // 画像要素(背面=下敷き / 前面)。選択中は枠とリサイズ用の■を表示する
  const drawImages = zone => (m.images || []).filter(im => (im.z || 'back') === zone).forEach(im => {
    if (!showEl(m, 'img')) return;
    const sel = ui.sel && ui.sel.t === 'img' && ui.sel.id === im.id;
    // 背面(下敷き)は選択中以外すり抜けにして、下の要素の選択や□選択を邪魔しない
    const pe = (zone === 'back' && !sel) ? ' pointer-events="none"' : '';
    h += `<g data-t="img" data-id="${im.id}"${pe}>` +
         `<image href="${esc(im.src)}" x="${im.x}" y="${im.y}" width="${Math.max(1, im.w)}" height="${Math.max(1, im.h)}" opacity="${im.opacity == null ? 1 : im.opacity}" preserveAspectRatio="none"/>` +
         (sel ? `<rect x="${im.x - 3}" y="${im.y - 3}" width="${im.w + 6}" height="${im.h + 6}" fill="none" stroke="${fg}" stroke-width="2" stroke-dasharray="4 3"/>` +
                `<rect data-t="imgr" data-id="${im.id}" x="${im.x + im.w - 6}" y="${im.y + im.h - 6}" width="12" height="12" fill="${fg}" style="cursor:nwse-resize"/>` : '') + '</g>';
  });
  drawImages('back');   // 背面は道路・ラベル枠・線路より下に敷く
  (m.boxes || []).forEach(b => {
    if (!showEl(m, 'box')) return;
    const sel = ui.sel && ui.sel.t === 'bx' && ui.sel.id === b.id, tc = isDark(b.fill) ? '#fff' : '#1f2d36', n = [...(b.text || '')].length;
    const fs = Math.max(8, Math.min(14, b.h - 8, (b.w - 8) / Math.max(1, n)));
    h += `<g data-t="bx" data-id="${b.id}"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="3" fill="${b.fill}" fill-opacity=".92" stroke="${fg}" stroke-opacity=".45" stroke-width="1.5"/>` +
         (b.text ? `<text x="${b.x + b.w / 2}" y="${b.y + b.h / 2 + fs * 0.35}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="${tc}">${esc(b.text)}</text>` : '') +
         (sel ? `<rect x="${b.x - 3}" y="${b.y - 3}" width="${b.w + 6}" height="${b.h + 6}" rx="4" fill="none" stroke="${fg}" stroke-width="2" stroke-dasharray="4 3"/><rect data-t="bxr" data-id="${b.id}" x="${b.x + b.w - 6}" y="${b.y + b.h - 6}" width="12" height="12" fill="${fg}" style="cursor:nwse-resize"/>` : '') + '</g>';
  });
  // 0) 幹線道路(背景・独立要素)
  (m.roads || []).forEach(r => {
    if (r.pts.length < 2 || !showEl(m, 'road')) return;
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
    const p = segPt(l, c.seg, c.t), a = segA(l, c.seg), b = segB(l, c.seg);
    if (!a || !b) return { p, t: `translate(${p.x} ${p.y})` };
    return { p, t: `translate(${p.x} ${p.y}) rotate(${Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI})` };
  };
  const dims = l => { const w = lw(l); return { half: Math.max(7, w / 2 + 3), rh: Math.max(26, w / 2 + 20) }; };
  // 1) 踏切の道路
  m.lines.forEach(l => {
    if (l.hidden) return;   // 非表示の路線は描かない
    const { half, rh } = dims(l);
    l.crossings.forEach(c => {
      h += `<g transform="${xf(l, c).t}"><rect x="${-half}" y="${-rh}" width="${half * 2}" height="${rh * 2}" rx="2" fill="#9aa5a9"/></g>`;
    });
  });
  // 2) 線路と駅間隔
  m.lines.forEach(l => {
    if (l.hidden) return;   // 非表示の路線は描かない
    const s = l.stations, on = l.id === ui.line;
    if (s.length > 1) {
      // 環状線は最初の駅に戻る点を足して輪にする
      const pts = (isLoop(l) ? s.concat([s[0]]) : s).map(p => p.x + ',' + p.y).join(' ');
      h += `<polyline data-t="line" data-l="${l.id}" points="${pts}" fill="none" stroke="${l.color}" stroke-width="${lw(l)}" stroke-linecap="round" stroke-linejoin="round" opacity="${on ? 1 : .55}"/>`;
    }
    for (let i = 0; i < segCount(l); i++) {
      const a = segA(l, i), b = segB(l, i), len = dist(a, b) || 1, off = lw(l) / 2 + 12;
      const mx = (a.x + b.x) / 2 - (b.y - a.y) / len * off, my = (a.y + b.y) / 2 + (b.x - a.x) / len * off;
      h += `<text x="${mx}" y="${my + 4}" text-anchor="middle" font-size="11" fill="${sub}" ${halo}>${(len / G).toFixed(1)}</text>`;
    }
  });
  // 3) 踏切の記号
  m.lines.forEach(l => {
    if (l.hidden) return;   // 非表示の路線は描かない
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
  m.lines.forEach(l => { if (!l.hidden) l.stations.forEach(conn); });
  (m.hubs || []).forEach(conn);
  m.lines.forEach(l => { if (!l.hidden) l.stations.forEach(s => drawStation(s, l)); });
  (m.hubs || []).forEach(s => drawStation(s, null));   // 路線外の乗り換え駅
  // 5) バス停(独立要素・最前面)
  (m.stops || []).forEach(s => {
    if (!showEl(m, 'stop')) return;
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
  drawImages('front');   // 前面はすべての上に重ねる
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
    else if (it.t === 'img') { const im = (m.images || []).find(x => x.id === it.id); if (im) h += mkBox(im.x - 4, im.y - 4, im.w + 8, im.h + 8); }
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

export function centerStation(s) {
  const st = document.getElementById('stage');
  st.scrollLeft = (s.x + 4) * ui.zoom - st.clientWidth / 2;
  st.scrollTop = (s.y + 4) * ui.zoom - st.clientHeight / 2;
}

export const cv = document.getElementById('cv'), stage = document.getElementById('stage');
export const pt = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / ui.zoom, y: (e.clientY - r.top) / ui.zoom }; };

export function applyZoom() {
  const m = curMap(), w = mw(m), h = mh(m);
  cv.setAttribute('width', w * ui.zoom); cv.setAttribute('height', h * ui.zoom);
  cv.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const z = document.getElementById('zlabel'); if (z) z.textContent = Math.round(ui.zoom * 100) + '%';
}
export function setZoom(z, cx, cy) {
  z = clamp(z, 0.25, 3);
  const r = stage.getBoundingClientRect();
  if (cx === undefined) { cx = r.width / 2; cy = r.height / 2; }
  const wx = (stage.scrollLeft + cx) / ui.zoom, wy = (stage.scrollTop + cy) / ui.zoom;
  ui.zoom = z; applyZoom();
  stage.scrollLeft = wx * z - cx; stage.scrollTop = wy * z - cy;
}
