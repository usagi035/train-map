/* ===========================================================================
   右パネル(選択中・路線・道路・画像・路線図の設定)の描画と操作。
   (元は src/ui/renderer.js の1ファイル。指示書 §8〜§12 に沿って画面側を分割した)
   =========================================================================== */
import { G, SHAPES, STOP_KINDS, STOP_COLOR, OFF_LINK, BG, lw, allStations, linksIn, linkGroups } from '../core/model.js';
import { dist, isLoop } from '../core/geometry.js';
import { core, ui, esc, curMap, curLine, findStation, linesOf, save, deferSave, renderAll, renderTools,
         getBulk, clearBulk, showEl, selVisible, del, finishRoad, startRoadDrawing, imgPick } from './ui-state.js';
import { renderCanvas } from './canvas.js';
import { renderTabs, deleteMap } from './tabs.js';

/* ---------- 右パネルのグループ化(開閉できるセクション) ---------- */
// 見出しをクリックすると開閉。開閉状態は localStorage に覚えておく
let acc = {};
try { acc = JSON.parse(localStorage.getItem('railacc')) || {}; } catch (e) { acc = {}; }
if (acc.map == null) acc.map = false;   // 路線図の設定(名前・背景・削除)は既定で閉じる
const accOpen = id => acc[id] !== false;
const saveAcc = () => { try { localStorage.setItem('railacc', JSON.stringify(acc)); } catch (e) {} };
let selKey = '';   // 選択が変わったときは「選択中」を開いたままにする
function sec(id, title, body, badge) {
  const open = accOpen(id);
  return `<section class="sec${open ? ' open' : ''}" data-sec="${id}">` +
    `<button type="button" class="sech" data-sech="${id}" aria-expanded="${open}" title="${title}を開閉">` +
    `<span class="sect">${title}</span>` +
    (badge == null ? '' : `<span class="secn">${badge}</span>`) +
    '<span class="seci">▾</span></button>' +
    (open ? `<div class="secb">${body}</div>` : '') +
    '</section>';
}

// 乗り換え(複数路線に共有)のON/OFF。OFFのときは通常の駅に戻るので、必ずどこかの路線に乗せる
function setHub(st, on) { core.setHub(curMap(), st, on, ui.line); }

export function renderSide() {
  const m = curMap(), l = curLine();
  let sel = '', selT = '';
  if (ui.sel) {
    if (ui.sel.t === 'st') {
      const s = findStation(ui.sel.id);
      if (!s) ui.sel = null;
      else {
        const ls = linesOf(s.id);   // 属する路線(乗り換え駅は0本のこともある)
        const gl = ls.some(x => x.id === l.id) ? l : ls[0];   // 間隔を表示する路線
        const i = gl ? gl.stations.findIndex(x => x.id === s.id) : -1;
        selT = (ls.length ? '駅' : '乗り換え駅') + '「' + esc(s.name) + '」';
        sel = `<label>駅名<input id="sname" value="${esc(s.name)}"></label>` +
          `<label>形<select id="sshape">${Object.entries(SHAPES).map(([k, v]) => `<option value="${k}"${(s.shape || 'circle') === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>` +
          `<div class="row" style="align-items:center"><span>色</span><input type="color" id="scolor" value="${s.color || (ls.length ? ls[0].color : STOP_COLOR)}"><button id="sreset">路線の色に戻す</button></div>` +
          `<label>駅名の向き<select id="snameRot"><option value="0"${(s.nameRot || 0) === 0 ? ' selected' : ''}>普通</option><option value="45"${(s.nameRot || 0) === 45 ? ' selected' : ''}>斜め(45°)</option><option value="90"${(s.nameRot || 0) === 90 ? ' selected' : ''}>縦(90°)</option></select></label>` +
          `<button type="button" class="tgl" id="shub" aria-pressed="${s.hub ? 'true' : 'false'}">乗り換え駅(ターミナルハブ)</button>` +
          (s.hub ? '<div class="note" style="margin-bottom:4px">属する路線:</div>' +
            m.lines.map(x => `<label style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><input type="checkbox" class="shubline" data-lid="${x.id}"${x.stations.some(st => st.id === s.id) ? ' checked' : ''}> <i style="display:inline-block;width:18px;height:5px;border-radius:3px;background:${x.color};flex:none"></i>${esc(x.name)}</label>`).join('') +
            `<p class="note">${ls.length ? 'チェックを全部外すと、どの路線にも属さない乗り換え駅(路線外)になります。' : '現在、どの路線にも属していません(路線外)。チェックした路線に組み込めます。'}</p>`
            : '<p class="note">ONにすると、後からこの駅を乗り換え駅に変更できます(OFFで通常の駅に戻ります)。</p>');
        // 接続する駅:路線ごとに別のリスト(普通の駅でも登録・編集できる)
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
            ? `<div class="row" data-lid="${gr.lid}"><select class="linksel" style="flex:1;min-width:0"><option value="">追加する駅を選択…</option>${options}</select></div>`
            : '<p class="note">追加できる駅がありません。</p>';
          sel += g + '</div>';
        });
        sel += '<p class="note">接続は路線ごとに別のリストで持ちます。セレクトで駅を選ぶと<b>その場で追加</b>され、順番は ↑↓ かドラッグで変えられます。行をクリックすると、その駅を選択してパネルを切り替えます。登録した接続は、この駅から接続先の駅へ<b>通常の路線と同じ線</b>で描画され、色と太さは接続先の駅の路線です(路線外の接続先はグレー)。</p>';
        if (gl && i > 0) sel += `<label>前の駅との間隔(マス)<input id="gap" data-lid="${gl.id}" type="number" min="0.5" step="0.5" value="${(dist(gl.stations[i - 1], s) / G).toFixed(1)}"></label><p class="note">変更すると、これ以降の駅も一緒に動きます。</p>`;
      }
    } else if (ui.sel.t === 'stop') {
      const s = (m.stops || []).find(x => x.id === ui.sel.id);
      if (!s) ui.sel = null;
      else {
        const kind = s.kind || 'stop';
        selT = (kind === 'terminal' ? 'バスターミナル' : 'バス停') + '「' + esc(s.name) + '」';
        sel = `<label>名称<input id="bsname" value="${esc(s.name)}"></label>` +
          `<label>種別<select id="bskind">${Object.entries(STOP_KINDS).map(([k, v]) => `<option value="${k}"${kind === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>` +
          `<div class="row" style="align-items:center"><span>色</span><input type="color" id="bscolor" value="${s.color || STOP_COLOR}"><button id="bsreset">標準色に戻す</button></div>` +
          `<label>名称の向き<select id="bsnameRot"><option value="0"${(s.nameRot || 0) === 0 ? ' selected' : ''}>普通</option><option value="45"${(s.nameRot || 0) === 45 ? ' selected' : ''}>斜め(45°)</option><option value="90"${(s.nameRot || 0) === 90 ? ' selected' : ''}>縦(90°)</option></select></label>` +
          `<p class="note">幹線道路とは独立した要素です。キャンバスのどこにでも置けます。</p>`;
      }
    } else if (ui.sel.t === 'road') {
      const r = (m.roads || []).find(x => x.id === ui.sel.id);
      if (!r) ui.sel = null;
      else {
        selT = '幹線道路「' + esc(r.name) + '」';
        sel = `<label>名前<input id="rname" value="${esc(r.name)}"></label>` +
        `<div class="row" style="align-items:center"><span>色</span><input type="color" id="rcolor" value="${r.color}"></div>` +
        `<label>幅(${r.width})<input type="range" id="rwidth" min="6" max="40" step="1" value="${r.width}"></label>` +
        `<div class="row"><button id="droad">この道路を削除</button></div>` +
        `<p class="note">頂点(□)をドラッグすると形を調整できます。道路全体のドラッグで移動します。</p>`;
      }
    } else if (ui.sel.t === 'bx') {
      const b = (m.boxes || []).find(b => b.id === ui.sel.id);
      if (!b) ui.sel = null;
      else {
        selT = 'ラベル枠「' + esc(b.text || '') + '」';
        sel = `<label>ラベル<input id="btext" value="${esc(b.text || '')}"></label>` +
        `<div class="row" style="align-items:center"><span>色</span><input type="color" id="bfill" value="${b.fill}"></div>` +
        `<div class="row"><label style="flex:1">幅(マス)<input id="bw" type="number" min="1" step="1" value="${Math.round(b.w / G)}"></label><label style="flex:1">高さ(マス)<input id="bh" type="number" min="1" step="1" value="${Math.round(b.h / G)}"></label></div>`;
      }
    } else if (ui.sel.t === 'img') {
      const im = (m.images || []).find(x => x.id === ui.sel.id);
      if (!im) ui.sel = null;
      else {
        const op = Math.round((im.opacity == null ? 1 : im.opacity) * 100);
        selT = '画像';
        sel = `<label>不透明度(${op}%)<input id="iop" type="range" min="10" max="100" step="5" value="${op}"></label>` +
          `<label>重ねる順<select id="izone"><option value="back"${(im.z || 'back') === 'back' ? ' selected' : ''}>背面(下敷き)</option><option value="front"${im.z === 'front' ? ' selected' : ''}>前面(線路の上)</option></select></label>` +
          `<div class="row"><button id="ichg">画像を変更</button><button id="idel">削除</button></div>` +
          `<p class="note">ドラッグで移動、右下の■をドラッグで大きさを変更します。□(矩形選択)や Delete キーでもまとめて操作できます。下敷きにすると道路や線路より下に描画されます。</p>`;
      }
    } else {
      const c = l.crossings.find(c => c.id === ui.sel.id);
      if (!c) ui.sel = null;
      else {
        selT = c.name ? '踏切「' + esc(c.name) + '」' : '踏切';
        sel = `<label>名前<input id="cname" value="${esc(c.name)}"></label>`;
      }
    }
  }
  const bulk = getBulk();
  if (!ui.sel && bulk.length) {
    selT = '□で ' + bulk.length + '個を選択';
    sel = '<p class="note">Delete キー(または「選択を削除」)でまとめて削除します。Esc かクリックで解除します</p>';
  }
  // 選択が新しくなったら「選択中」のグループは開いたままにする(閉じたままだと何も出ないため)
  const k = ui.sel ? ui.sel.t + ':' + ui.sel.id : (sel ? 'bulk' : '');
  const selChanged = k !== selKey;
  if (k && selChanged && !accOpen('sel')) { acc.sel = true; saveAcc(); }
  selKey = k;
  // ---- グループごとにまとめる(見出しクリックで開閉) ----
  const linesBody = '<ul id="lines">' +
    m.lines.slice().reverse().map(x => {
      const i = m.lines.indexOf(x);
      return `<li data-id="${x.id}" class="${x.id === l.id ? 'on' : ''}${x.hidden ? ' off' : ''}">` +
        `<button class="lyr" data-act="eye" title="${x.hidden ? '表示する' : '非表示にする'}">${x.hidden ? '🚫' : '👁'}</button>` +
        `<button class="lyr" data-act="lock" title="${x.lock ? 'ロック解除' : '編集ロック(選択・ドラッグ・削除を禁止)'}">${x.lock ? '🔒' : '🔓'}</button>` +
        `<i style="background:${x.color}"></i>` +
        `<span class="lname">${esc(x.name)}${isLoop(x) ? ' <span style="font-size:11px;opacity:.65">環</span>' : ''}</span>` +
        `<span class="lbtns">` +
        `<button class="lyr" data-act="up" title="手前にする"${i === m.lines.length - 1 ? ' disabled' : ''}>↑</button>` +
        `<button class="lyr" data-act="down" title="奥にする"${i === 0 ? ' disabled' : ''}>↓</button>` +
        `</span></li>`;
    }).join('') +
    '</ul><button id="addline">路線を追加</button>' +
    '<p class="note">リストの<b>上にある路線ほど手前に描画</b>されます。👁で表示/非表示、🔒で編集ロック、↑↓で重ね順の変更(並べ替えても線の形は変わりません)。</p>' +
    '<div class="subh">その他の表示</div><div class="layeropts">' +
    `<button type="button" class="tgl showel" data-k="road" aria-pressed="${showEl(m, 'road')}">幹線道路</button>` +
    `<button type="button" class="tgl showel" data-k="stop" aria-pressed="${showEl(m, 'stop')}">バス停</button>` +
    `<button type="button" class="tgl showel" data-k="box" aria-pressed="${showEl(m, 'box')}">ラベル枠</button>` +
    `<button type="button" class="tgl showel" data-k="img" aria-pressed="${showEl(m, 'img')}">画像</button>` +
    '</div>' +
    '<p class="note">駅と踏切は所属する路線に従います(路線を隠すと、その路線の駅・踏切も隠れます)。</p>';
  const lineBody =
    `<div class="row"><input id="lname" value="${esc(l.name)}"><input type="color" id="lcolor" value="${l.color}"></div>` +
    `<label>線の太さ(${lw(l)})<input type="range" id="lwidth" min="2" max="24" step="1" value="${lw(l)}"></label>` +
    `<button type="button" class="tgl" id="lloop" aria-pressed="${l.loop ? 'true' : 'false'}">環状線(最後と最初をつなぐ)</button>` +
    `<p class="note">${l.loop ? '輪になって描画されます。閉じた区間にも駅・踏切を置けます。' : 'ONにすると最後の駅と最初の駅がつながり、輪になります(駅は3つ以上が目安)。'}</p><button id="dline">この路線を削除</button>`;
  const roadBody = '<ul id="roadlist">' +
    ((m.roads || []).length
      ? m.roads.map(r => `<li data-rid="${r.id}" class="${ui.sel && ui.sel.t === 'road' && ui.sel.id === r.id ? 'on' : ''}"><i style="background:${r.color}"></i>${esc(r.name)}</li>`).join('')
      : '<li style="opacity:.6;cursor:default">まだありません</li>') +
    '</ul><button id="addroadp">幹線道路を引く</button>';
  const imgBody = '<ul id="imglist">' +
    ((m.images || []).length
      ? m.images.map(x => `<li data-iid="${x.id}" class="${ui.sel && ui.sel.t === 'img' && ui.sel.id === x.id ? 'on' : ''}"><img src="${esc(x.src)}" alt=""><span>${x.z === 'front' ? '前面' : '下敷き'}</span></li>`).join('')
      : '<li style="opacity:.6;cursor:default">まだありません</li>') +
    '</ul><button id="addimgp">画像を追加</button>';
  const mapBody = `<label>路線図の名前<input id="mname" value="${esc(m.name)}"></label>` +
    '<div class="row" style="align-items:center"><span>背景色</span><input type="color" id="mbg" value="' + (m.bg || BG) + '"></div>' +
    '<div class="row"><button id="newwin">別ウィンドウで開く</button></div>' +
    '<div class="row"><button id="dmap">この路線図を削除</button></div>';
  const side = document.getElementById('side');
  const keepScroll = side.scrollTop;
  side.innerHTML =
    (sel ? sec('sel', '選択中：' + selT, sel) : '') +
    sec('lines', '路線(レイヤー)', linesBody, m.lines.length) +
    sec('line', '選択中の路線', lineBody, esc(l.name)) +
    sec('roads', '幹線道路', roadBody, (m.roads || []).length) +
    sec('images', '画像', imgBody, (m.images || []).length) +
    sec('map', '路線図の設定', mapBody, null);
  // 選択が変わったら「選択中」を見せるため先頭へ。開閉・トグルなどの操作は開いた位置を保つ
  side.scrollTop = selChanged ? 0 : keepScroll;
}

/* ---------- side panel ---------- */
const side = document.getElementById('side');
side.addEventListener('input', e => {
  const id = e.target.id, v = e.target.value, m = curMap(), l = curLine();
  if (id === 'mname') { core.update(m, { name: v }); renderTabs(); }
  else if (id === 'lname') core.update(l, { name: v });
  else if (id === 'mbg') { core.update(m, { bg: v }); renderCanvas(); }
  else if (id === 'btext') { core.update(m.boxes.find(b => b.id === ui.sel.id), { text: v }); renderCanvas(); }
  else if (id === 'bfill') { core.update(m.boxes.find(b => b.id === ui.sel.id), { fill: v }); renderCanvas(); }
  else if (id === 'iop') {
    const im = (m.images || []).find(x => x.id === ui.sel.id);
    if (im) { core.update(im, { opacity: +v / 100 }); e.target.parentNode.firstChild.textContent = '不透明度(' + v + '%)'; renderCanvas(); }
  }
  else if (id === 'izone') {
    const im = (m.images || []).find(x => x.id === ui.sel.id);
    if (im) { core.update(im, { z: v }); save(); renderAll(); }
  }
  else if (id === 'sshape') {
    const s = findStation(ui.sel.id);
    if (s) { core.update(s, { shape: v }); renderCanvas(); }
  }
  else if (id === 'bsname') { const s = (m.stops || []).find(s => s.id === ui.sel.id); if (s) { core.update(s, { name: v }); renderCanvas(); } }
  else if (id === 'bskind') { const s = (m.stops || []).find(s => s.id === ui.sel.id); if (s) { core.update(s, { kind: v }); save(); renderAll(); } }
  else if (id === 'bscolor') { const s = (m.stops || []).find(s => s.id === ui.sel.id); if (s) { core.update(s, { color: v }); renderCanvas(); } }
  else if (id === 'bsnameRot') { const s = (m.stops || []).find(s => s.id === ui.sel.id); if (s) { core.update(s, { nameRot: +v }); renderCanvas(); } }
  else if (id === 'rname') { const r = (m.roads || []).find(r => r.id === ui.sel.id); if (r) { core.update(r, { name: v }); renderSide(); } }
  else if (id === 'rcolor') { const r = (m.roads || []).find(r => r.id === ui.sel.id); if (r) { core.update(r, { color: v }); renderCanvas(); } }
  else if (id === 'rwidth') {
    const r = (m.roads || []).find(r => r.id === ui.sel.id);
    if (r) { core.update(r, { width: +v }); e.target.parentNode.firstChild.textContent = '幅(' + v + ')'; renderCanvas(); }
  }
  else if (id === 'scolor') { const s = findStation(ui.sel.id); if (s) { core.update(s, { color: v }); renderCanvas(); } }
  else if (id === 'snameRot') { const s = findStation(ui.sel.id); if (s) { core.update(s, { nameRot: +v }); renderCanvas(); } }
  else if (e.target.classList && e.target.classList.contains('shubline')) {
    const s = findStation(ui.sel.id), cm = curMap();
    if (!s || !cm.lines.some(x => x.id === e.target.dataset.lid)) return;
    // 路線に組み込む/外す。全部外すと路線外の乗り換え駅として残る
    core.setStationLine(cm, s, e.target.dataset.lid, e.target.checked);
    save(); renderAll();
  }
  else if (id === 'lwidth') { core.update(l, { width: +v }); e.target.parentNode.firstChild.textContent = '線の太さ(' + v + ')'; renderCanvas(); }
  else if (id === 'lcolor') { core.update(l, { color: v }); renderCanvas(); }
  else if (id === 'sname') {
    const s = findStation(ui.sel.id);
    if (s) {
      core.update(s, { name: v });
      if (s.hub) curMap().lines.forEach(x => { const st = x.stations.find(st => st.id === s.id); if (st) core.update(st, { name: v }); });
      renderCanvas();
    }
  }
  else if (id === 'cname') { core.update(l.crossings.find(c => c.id === ui.sel.id), { name: v }); renderCanvas(); }
  // 文字入力とスライダーの連続操作は、まとめて1回の履歴にする
  if (['mname', 'lname', 'sname', 'bsname', 'rname', 'cname', 'btext'].includes(id) || e.target.type === 'range') deferSave();
  else save();
});
side.addEventListener('change', e => {
  if (e.target.id === 'gap') {
    const l = curMap().lines.find(x => x.id === e.target.dataset.lid) || curLine();
    const i = l.stations.findIndex(s => s.id === ui.sel.id);
    if (i > 0) core.adjustGap(curMap(), l, i, e.target.value);
    save(); renderAll(); return;
  }
  if (e.target.id === 'bw' || e.target.id === 'bh') {
    const b = (curMap().boxes || []).find(b => b.id === ui.sel.id), v = Math.max(1, Math.round(+e.target.value) || 1) * G;
    if (e.target.id === 'bw') core.update(b, { w: v }); else core.update(b, { h: v });
    save(); renderAll(); return;
  }
  renderSide();
});
side.addEventListener('click', e => {
  const btn = e.target.closest('button'); if (btn) btn.blur();
  // --- グループの見出しクリックで開閉(開閉状態は覚えておく) ---
  const sh = e.target.closest('[data-sech]');
  if (sh) {
    const sid = sh.dataset.sech;
    acc[sid] = !accOpen(sid);
    saveAcc(); renderSide();
    return;
  }
  const m = curMap(), li = e.target.closest('#lines li'), rli = e.target.closest('#roadlist li[data-rid]'), id = e.target.id;
  // --- レイヤー操作(表示/非表示・編集ロック・重ね順)。行クリックより先に処理する ---
  const ly = e.target.closest('button.lyr');
  if (ly) {
    const row = ly.closest('#lines li[data-id]'), t = row && m.lines.find(x => x.id === row.dataset.id);
    if (t) {
      const act = ly.dataset.act;
      if (act === 'eye') core.update(t, { hidden: !t.hidden });
      else if (act === 'lock') core.update(t, { lock: !t.lock });
      // 表示は上=手前なので、「上へ」は配列の後ろ(奥ではなく手前側)へ移動する
      else core.reorderLine(m, t, act === 'up');
      clearBulk();   // 表示設定が変わるので□選択は解除
      if (ui.sel && !selVisible(ui.sel)) ui.sel = null;
      save(); renderAll();
    }
    return;
  }
  if (li) { ui.line = li.dataset.id; ui.sel = null; clearBulk(); renderAll(); }
  else if (rli) { ui.sel = { t: 'road', id: rli.dataset.rid }; ui.tool = 'select'; renderAll(); }
  // --- トグルボタン(単一のON/OFF)。表示は aria-pressed の付け替えで切り替える ---
  else if (e.target.classList && e.target.classList.contains('showel')) {
    // 種類ごとの表示/非表示(レイヤー)。値はデータから反転する
    core.toggleShow(m, e.target.dataset.k);
    clearBulk();   // 表示設定が変わるので□選択は解除
    if (ui.sel && !selVisible(ui.sel)) ui.sel = null;
    save(); renderAll();
  }
  else if (id === 'shub') {
    const s = findStation(ui.sel && ui.sel.id);
    if (s) { setHub(s, !s.hub); save(); renderAll(); }
  }
  else if (id === 'lloop') {
    // 閉じる/開くで区間の数が変わるため、切り替え前の踏切の位置を基準に付け直す
    core.toggleLoop(curLine());
    save(); renderAll();
  }
  else if (id === 'addimgp') { imgPick.replaceId = null; document.getElementById('imgfile').click(); }
  else if (e.target.closest && e.target.closest('#imglist li[data-iid]')) {
    // 画像は下敷きだとクリックで選択できないことがあるので、一覧からも選べるようにする
    ui.sel = { t: 'img', id: e.target.closest('li').dataset.iid }; ui.tool = 'select'; renderAll();
  }
  else if (id === 'sreset') { const s = findStation(ui.sel.id); if (s) core.remove(s, 'color'); save(); renderAll(); }
  else if (id === 'bsreset') { core.remove((m.stops || []).find(s => s.id === ui.sel.id), 'color'); save(); renderAll(); }
  else if (id === 'droad') { core.deleteElement({ map: m, sel: { t: 'road', id: ui.sel.id }, fallbackLine: curLine() }); ui.sel = null; save(); renderAll(); }
  else if (id === 'idel') { del(); }
  else if (id === 'ichg') { imgPick.replaceId = ui.sel && ui.sel.id; document.getElementById('imgfile').click(); }
  // --- 「接続する駅」リスト(路線ごと) ---
  else if (e.target.classList && (e.target.classList.contains('lup') || e.target.classList.contains('ldown') || e.target.classList.contains('ldel'))) {
    const list = e.target.closest('.linklist'), row = list && e.target.closest('li');
    const s = findStation(ui.sel && ui.sel.id);
    if (!list || !row || !s) return;
    const lid = list.dataset.lid, links = linksIn(s, lid), k = links.indexOf(row.dataset.id);
    if (k < 0) return;
    const next = links.slice();   // 状態は差し替える(配列を直接書き換えない)
    if (e.target.classList.contains('ldel')) next.splice(k, 1);
    else if (e.target.classList.contains('lup') && k > 0) next.splice(k - 1, 0, next.splice(k, 1)[0]);
    else if (e.target.classList.contains('ldown') && k < next.length - 1) next.splice(k + 1, 0, next.splice(k, 1)[0]);
    else return;
    core.setLinks(s, lid, next); save(); renderAll();
  }
  // 行のボタン以外をクリック → その駅を選択してパネルを切り替え(左パネルの駅リストと同じ)
  else if (e.target.closest && e.target.closest('.linklist li')) {
    const row = e.target.closest('.linklist li'), s = row && findStation(row.dataset.id);
    if (s) {
      const ls = linesOf(s.id);
      if (ls.length && !ls.some(x => x.id === ui.line)) ui.line = ls[0].id;
      ui.sel = { t: 'st', id: s.id };
      clearBulk();
      renderAll();
    }
  }
  else if (id === 'newwin') window.open('index.html#' + encodeURIComponent(m.id));
  else if (id === 'addline') {
    const l = core.addLine(m);
    ui.line = l.id; ui.sel = null; save(); renderAll();
  } else if (id === 'addroadp') {
    if (ui.drawing) finishRoad();
    ui.tool = 'road'; startRoadDrawing(); renderTools();
  } else if (id === 'dline') {
    // 路線を削除する(最後の1本のときは路線を空にする。乗り換え駅は残す)
    const deadId = core.deleteLine(m, ui.line);
    if (deadId) ui.line = m.lines[0].id;
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
    const next = links.slice();   // 状態は差し替える(配列を直接書き換えない)
    next.splice(to, 0, next.splice(from, 1)[0]);
    core.setLinks(s, lid, next); save(); renderAll();
  }
});
side.addEventListener('dragend', () => {
  linkDrag = null;
  document.querySelectorAll('.linklist .dragging, .linklist .dropto').forEach(x => x.classList.remove('dragging', 'dropto'));
});

// 接続先セレクトで駅を選ぶ → その場でリストへ追加(「追加」ボタンは不要)
side.addEventListener('change', e => {
  if (!e.target.classList || !e.target.classList.contains('linksel')) return;
  const s = findStation(ui.sel && ui.sel.id), box = e.target.closest('[data-lid]'), v = e.target.value;
  if (!s || !box || !v) return;   // 「追加する駅を選択…」のときは何もしない
  const lid = box.dataset.lid;
  if (!s.links || typeof s.links !== 'object') core.update(s, { links: {} });
  if (linksIn(s, lid).includes(v)) return;   // 同じ接続を重ねない
  core.setLinks(s, lid, linksIn(s, lid).concat(v));
  save(); renderAll();
});
