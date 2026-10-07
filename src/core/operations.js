/* 状態の変更(編集操作)を一元化するモジュール(指示書 §6)。
   - 画面(DOM)・アラート・選択状態などは持たない。「何をどう変えるか」だけを受け取り結果を返す。
   - UI はここを経由して状態を書き換える(§7 の Core 状態境界)。
   - 履歴は core.commit / core.undo / core.redo の形で history.js を隠す(§5)。 */
import { S, getSnapshot, replaceState, snapStr, newId, mkLine, mkMap, mkStation, mkRoad, mkBusStop, mkImage,
         ensureRoom as expandMap, findStationIn, linesOfIn, allStations, flattenLinks, pruneLinks,
         OFF_LINK, COLORS, G, mw, mh, clamp } from './model.js';
import { project, keepCrossings, segPt, segA, segB, dist } from './geometry.js';
import { migrate } from './migration.js';
import { sanitizeDocument } from './sanitize.js';
import * as history from './history.js';

// 踏切の位置をグリッド上の点に合わせる(snap=false のときは位置をそのまま使う)
function snapCx(l, r, snap) {
  if (!snap) return r;
  const a = segA(l, r.seg), b = segB(l, r.seg);
  if (!a || !b) return r;
  const g = { x: Math.round(r.x / G) * G, y: Math.round(r.y / G) * G };
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  return { seg: r.seg, t: l2 ? clamp(((g.x - a.x) * dx + (g.y - a.y) * dy) / l2, 0, 1) : 0 };
}
// ロック中・非表示の路線には編集できない
const blockedReason = l => (l.lock ? 'locked' : l.hidden ? 'hidden' : null);

// 履歴のスナップを状態へ適用する(読めないデータなら null を返す)
function adopt(e) {
  if (!e) return null;
  try { replaceState(JSON.parse(e.s)); } catch (err) { return null; }
  return e;
}

export function createCore() {
  const core = {
    /* ---------- 状態そのもの ---------- */
    getState: getSnapshot,
    snapshot: snapStr,
    replace: replaceState,
    // 保存済み / 読み込んだデータを取り込む(不正なら例外を投げる)
    // 中身は必ずサニタイズを通す。見た目の変な値は既定へ直し、
    // 使いものにならない文書だけ invalid document(画面側で案内する)。
    // 返り値は警告(件数超過などで直した内容)の配列。
    importDocument(d) {
      const { doc, warnings } = sanitizeDocument(d);
      replaceState(migrate(doc));
      return warnings;
    },

    /* ---------- 履歴(§5: push / undo / redo / canUndo / canRedo) ---------- */
    // 確定した状態を積む。変更が無ければ null(そのときは保存もしない)
    commit(view) { const now = snapStr(); return history.push(now, view) ? now : null; },
    undo() { return adopt(history.undo()); },
    redo() { return adopt(history.redo()); },
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    resetHistory(view) { history.reset(snapStr(), view); },
    syncView: history.syncView,

    /* ---------- 単純なフィールド編集(画面から直接代入しないための統一入口) ---------- */
    update(obj, patch) { return Object.assign(obj, patch); },
    remove(obj, key) { delete obj[key]; return obj; },
    // 必要なところまでキャンバスを広げる
    ensureRoom(map, x, y) { expandMap(map, x, y); },

    /* ---------- 要素ごとの位置更新 ---------- */
    // 駅を動かす(乗り換え駅は、属する全路線の同じ駅も一緒に動かす)
    moveStationTo(map, st, x, y) {
      st.x = x; st.y = y;
      if (st.hub) map.lines.forEach(ln => {
        const t = ln.stations.find(o => o.id === st.id);
        if (t) { t.x = x; t.y = y; }
      });
    },
    // 踏切を線の新しい位置へ移す(成功したら true)
    moveCrossingTo(line, crossing, p, snap) {
      const r = project(line, p);
      if (!r) return false;
      const q = snapCx(line, r, snap);
      crossing.seg = q.seg; crossing.t = q.t;
      return true;
    },
    // 駅の間隔(マス)を変える。以降の駅も一緒に動かす
    adjustGap(map, line, index, cells) {
      if (index <= 0) return;
      const a = line.stations[index - 1], b = line.stations[index];
      if (!a || !b) return;
      const d = Math.max(0.5, parseFloat(cells) || 1) * G;
      const len = dist(a, b), ux = len ? (b.x - a.x) / len : 1, uy = len ? (b.y - a.y) / len : 0;
      const nx = a.x + ux * d - b.x, ny = a.y + uy * d - b.y;
      for (let j = index; j < line.stations.length; j++) { line.stations[j].x += nx; line.stations[j].y += ny; }
    },

    /* ---------- 追加 ---------- */
    // 駅を追加(線に近ければ間に挿入)
    addStation({ map, line, p, snap }) {
      const r = project(line, p);
      expandMap(map, p.x, p.y); if (r) expandMap(map, r.x, r.y);
      const q = { x: clamp(Math.round(p.x / G) * G, 0, mw(map)), y: clamp(Math.round(p.y / G) * G, 0, mh(map)) };
      const st = mkStation('駅' + (line.stations.length + 1), q.x, q.y);
      keepCrossings(line, () => {
        if (!snap) { st.x = clamp(Math.round(p.x), 0, mw(map)); st.y = clamp(Math.round(p.y), 0, mh(map)); }
        if (r && r.d < 14) { st.x = Math.round(r.x); st.y = Math.round(r.y); line.stations.splice(r.seg + 1, 0, st); }
        else line.stations.push(st);
      });
      return st;
    },
    // 路線に属さない乗り換え駅を追加
    addHubStation({ map, p, snap }) {
      expandMap(map, p.x, p.y);
      const q = { x: clamp(Math.round(p.x / G) * G, 0, mw(map)), y: clamp(Math.round(p.y / G) * G, 0, mh(map)) };
      const n = map.lines.reduce((n, x) => n + x.stations.length, 0) + (map.hubs || []).length + 1;
      const st = mkStation('乗換駅' + n, q.x, q.y);
      st.hub = true;
      (map.hubs = map.hubs || []).push(st);
      return st;
    },
    // バス停 / バスターミナルを追加
    addBusStop({ map, p, kind, snap }) {
      core.setShow(map, 'stop', true);   // 非表示でも置いたら表示に戻す
      expandMap(map, p.x, p.y);
      const q = { x: clamp(Math.round(p.x / G) * G, 0, mw(map)), y: clamp(Math.round(p.y / G) * G, 0, mh(map)) };
      map.stops = map.stops || [];
      const n = map.stops.filter(s => (s.kind || 'stop') === kind).length + 1;
      const st = mkBusStop((kind === 'terminal' ? 'バスターミナル' : 'バス停') + n, q.x, q.y, kind);
      map.stops.push(st);
      return st;
    },
    // 幹線道路を追加
    addRoad(map, pts) {
      map.roads = map.roads || [];
      const used = new Set([...map.roads.map(r => r.color), ...map.lines.map(x => x.color)]);
      const color = COLORS.find(c => !used.has(c)) || COLORS[map.roads.length % COLORS.length];
      const r = mkRoad('幹線道路 ' + (map.roads.length + 1), color, pts);
      map.roads.push(r);
      return r;
    },
    // ラベル枠を追加(既定サイズ)
    addBox(map, q) {
      map.boxes = map.boxes || [];
      const b = { id: newId(), x: q.x, y: q.y, w: G * 6, h: G * 3, text: 'ラベル', fill: '#ffffff' };
      map.boxes.push(b);
      map.show = map.show || {}; map.show.box = true;   // 非表示でも置いたら表示に戻す
      return b;
    },
    // 画像要素を追加(位置・大きさは画面側で計算して渡す)
    addImage(map, opt) {
      const a = mkImage(opt.src, opt.x, opt.y, opt.w, opt.h);
      map.images = map.images || [];
      map.show = map.show || {}; map.show.img = true;   // 非表示でも取り込んだら表示に戻す
      map.images.push(a);
      return a;
    },
    // 踏切を追加(線に近い場所しか置けない)。結果は {line, crossing} または {error, line}
    addCrossing({ map, p, snap }) {
      let best = null;
      map.lines.forEach(l => { const r = project(l, p); if (r && r.d < 18 && (!best || r.d < best.r.d)) best = { l, r }; });
      if (!best) return { error: 'none' };
      const why = blockedReason(best.l);
      if (why) return { error: why, line: best.l };
      const q = snapCx(best.l, best.r, snap);
      const c = { id: newId(), seg: q.seg, t: q.t, name: '' };
      best.l.crossings.push(c);
      return { line: best.l, crossing: c };
    },
    // 路線を追加
    addLine(map) {
      const n = map.lines.length;
      const l = mkLine((n + 1) + '号線', COLORS[n % COLORS.length]);
      map.lines.push(l);
      return l;
    },
    // 路線図を追加
    addMap(name) { const m = mkMap(name); S.maps.push(m); return m; },

    /* ---------- 削除 ---------- */
    // 1つの要素を削除(□で選んだ複数の削除でも使う)。削除できたら true
    deleteElement({ map, sel, fallbackLine }) {
      const id = sel.id;
      if (sel.t === 'st') {
        const s = findStationIn(map, id);
        if (s && linesOfIn(map, id).some(l => l.lock)) return false;   // ロック中の路線の駅は削除しない
        if (s && s.hub) {   // 乗り換え駅は、すべての路線と路線外の置き場所から削除
          map.lines.forEach(x => { x.stations = x.stations.filter(st => st.id !== id); });
          map.hubs = (map.hubs || []).filter(st => st.id !== id);
        } else {
          const home = map.lines.find(x => x.stations.some(st => st.id === id)) || fallbackLine;
          if (home) keepCrossings(home, () => { home.stations = home.stations.filter(st => st.id !== id); });
        }
        pruneLinks(map);   // この駅を指している接続リストも掃除する
        return true;
      }
      if (sel.t === 'stop') { const n = (map.stops || []).length; map.stops = (map.stops || []).filter(s => s.id !== id); return map.stops.length !== n; }
      if (sel.t === 'road') { const n = (map.roads || []).length; map.roads = (map.roads || []).filter(r => r.id !== id); return map.roads.length !== n; }
      if (sel.t === 'bx') { const n = (map.boxes || []).length; map.boxes = (map.boxes || []).filter(b => b.id !== id); return map.boxes.length !== n; }
      if (sel.t === 'img') { const n = (map.images || []).length; map.images = (map.images || []).filter(x => x.id !== id); return map.images.length !== n; }
      if (sel.t === 'cx') {
        const owner = map.lines.find(l => l.crossings.some(c => c.id === id));   // 所属する路線から削除
        if (owner && owner.lock) return false;   // ロック中の路線の踏切は削除しない
        if (owner) owner.crossings = owner.crossings.filter(c => c.id !== id);
        return !!owner;
      }
      return false;
    },
    // 路線を削除する(最後の1本のときは路線を空にする。乗り換え駅は消さない)
    deleteLine(map, lineId) {
      const deadId = map.lines.length > 1 ? lineId : null;
      if (map.lines.length > 1) {
        const gone = map.lines.find(x => x.id === lineId);
        map.lines = map.lines.filter(x => x.id !== lineId);
        // 消えた路線にしか無かった乗り換え駅は、路線外の乗り換え駅として残す
        (gone ? gone.stations : []).forEach(st => {
          if (st.hub && !map.lines.some(x => x.stations.some(y => y.id === st.id)) &&
              !(map.hubs || []).some(y => y.id === st.id)) (map.hubs = map.hubs || []).push(st);
        });
      } else {
        const only = map.lines[0];
        const hubs = only.stations.filter(st => st.hub);   // 最後の路線を空にするときも乗り換え駅は残す
        only.stations = []; only.crossings = [];
        hubs.forEach(st => { if (!(map.hubs || []).some(y => y.id === st.id)) (map.hubs = map.hubs || []).push(st); });
      }
      // 路線に属さなくなった乗り換え駅の接続は「路線外」へ、消えた路線ごとの接続は捨てる
      (map.hubs || []).forEach(st => { if (!map.lines.some(l => l.stations.some(x => x.id === st.id))) flattenLinks(st); });
      if (deadId) allStations(map).forEach(st => { if (st.links && st.links[deadId]) delete st.links[deadId]; });
      pruneLinks(map);   // 路線ごと消した駅への接続を外す
      return deadId;
    },
    // 路線図を削除(1つしか無ければ作り直す)
    deleteMap(id) {
      S.maps = S.maps.filter(x => x.id !== id);
      if (!S.maps.length) S.maps.push(mkMap('路線図 1'));
    },

    /* ---------- 並べ替え・所属・表示 ---------- */
    // 駅の並べ替え。踏切が指す区間を保てるよう keepCrossings で囲む
    moveStationInLine(line, from, to) {
      keepCrossings(line, () => {
        const s = line.stations.splice(from, 1)[0];
        line.stations.splice(to, 0, s);
      });
    },
    // 路線の重ね順(up=true なら手前へ)
    reorderLine(map, line, up) {
      const i = map.lines.indexOf(line);
      if ((up && i < map.lines.length - 1) || (!up && i > 0)) {
        map.lines.splice(i, 1);
        map.lines.splice(up ? i + 1 : i - 1, 0, line);
        return true;
      }
      return false;
    },
    // 乗り換え駅のON/OFF。OFFのときは通常の駅に戻るので、必ずどこかの路線に乗せる
    setHub(map, st, on, homeLineId) {
      if (!st) return;
      if (on) { st.hub = true; return; }
      st.hub = false;
      const home = map.lines.find(x => x.id === homeLineId) || map.lines[0];
      if (home && !home.stations.some(y => y.id === st.id)) home.stations.push(st);
      map.lines.forEach(x => { if (x.id !== home.id) x.stations = x.stations.filter(y => y.id !== st.id); });
      map.hubs = (map.hubs || []).filter(y => y.id !== st.id);   // 路線外の置き場所からは外す
    },
    // 乗り換え駅を路線に組み込む/外す(on=false で全部外すと路線外の乗り換え駅になる)
    setStationLine(map, s, lineId, on) {
      const target = map.lines.find(x => x.id === lineId);
      if (!s || !target) return false;
      const has = target.stations.some(st => st.id === s.id);
      if (on && !has) {
        target.stations.push(s);                                   // 路線に組み込む
        map.hubs = (map.hubs || []).filter(x => x.id !== s.id);      // 路線外の置き場所からは外す
        // 「路線外」にまとめていた接続は、初めて乗る路線のリストへ移す
        const alone = !map.lines.some(x => x.id !== target.id && x.stations.some(st => st.id === s.id));
        if (alone && s.links && Array.isArray(s.links[OFF_LINK])) {
          s.links[target.id] = s.links[OFF_LINK].slice();
          delete s.links[OFF_LINK];
        }
      } else if (!on && has) {
        target.stations = target.stations.filter(st => st.id !== s.id);
        // どの路線にも属さなくなったら、路線外の乗り換え駅として残す(消さない)
        if (!map.lines.some(x => x.stations.some(st => st.id === s.id))) {
          flattenLinks(s);   // 路線ごとの接続は「路線外」にまとめる
          (map.hubs = map.hubs || []).push(s);
        }
      } else return false;
      return true;
    },
    // 接続する駅のリストを丸ごと入れ替える
    setLinks(station, lid, ids) {
      if (!station || typeof station !== 'object') return;
      station.links = (station.links && typeof station.links === 'object') ? station.links : {};
      station.links[lid] = ids;
    },
    // 環状線のON/OFF(区間の数が変わるため、踏切の位置を付け直す)
    toggleLoop(line) {
      const ps = line.crossings.map(c => segPt(line, c.seg, c.t));
      line.loop = !line.loop;
      keepCrossings(line, () => { }, ps);
      return line.loop;
    },
    // 種類ごとの表示/非表示(レイヤー)を反転
    toggleShow(map, key) {
      map.show = map.show || {};
      map.show[key] = !(map.show[key] !== false);
      return map.show[key];
    },
    setShow(map, key, val) {
      map.show = map.show || {};
      map.show[key] = val;
      return val;
    },
  };
  return core;
}
