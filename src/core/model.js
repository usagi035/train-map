/* 路線図のデータモデル: 定数・ID・工場関数・検索・関係(接続)の操作。
   画面(DOM)・Electron・ネットワークには一切依存しない(指示書 §1)。 */

export const COLORS = ['#E5352B','#1E7BC4','#2E9E5B','#F29B1F','#8A4FC9','#00A3A3'];
export const G = 20, W = 2400, H = 1600;   // 1マス = 20px / W,Hは初期サイズ
export const BG = '#f4f6f5';
export const SHAPES = { circle: '○ 丸', double: '◎ 二重丸(特急停車駅など)', square: '□ 四角', diamond: '◇ ひし形' };
export const STOP_KINDS = { stop: 'バス停', terminal: '■ バスターミナル' };
export const STOP_COLOR = '#1f2d36';   // バス停の既定色(道路とは無関係)
// 「接続する駅」は路線ごとに持つ。key = 路線ID、路線に属さないときは OFF_LINK
export const OFF_LINK = '-';

export const mw = m => m.w || W, mh = m => m.h || H;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lw = l => l.width || 8;
export const isDark = hex => { const n = parseInt(hex.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 120; };

/* 駅・路線・踏切などの ID。複数の端末が同時に作っても重複しない値にする(指示書 §2)。
   既存ファイルに入っている ID は書き換えない。 */
export const newId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
  ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });

/* ---------- 作成ヘルパ(工場関数) ---------- */
export const mkLine = (name, color) => ({ id: newId(), name, color, width: 8, loop: false, stations: [], crossings: [] });
// 幹線道路(背景)。頂点(pts)の並びで形を表す独立要素
export const mkRoad = (name, color, pts) => ({ id: newId(), name, color, width: 16, pts: pts || [] });
// バス停(独立要素)。路線・道路に属さない
export const mkBusStop = (name, x, y, kind) => ({ id: newId(), name, x, y, kind: kind || 'stop' });
export const mkMap = name => ({ id: newId(), name, bg: BG, lines: [mkLine('1号線', COLORS[0])], roads: [], stops: [], hubs: [] });
export const mkStation = (name, x, y) => ({ id: newId(), name, x, y, hub: false });
// 画像要素(srcはdata URL)。zは 'back'(下敷き) / 'front'(前面)
export const mkImage = (src, x, y, w, h) => ({ id: newId(), src, x, y, w, h, opacity: 1, z: 'back' });

// 必要なところまでキャンバスを広げる(draw.ioのように右・下へ自動拡張)
export function ensureRoom(m, x, y) {
  const pad = 400, step = 400;
  const nx = Math.max(mw(m), Math.ceil((x + pad) / step) * step);
  const ny = Math.max(mh(m), Math.ceil((y + pad) / step) * step);
  if (nx !== mw(m)) m.w = nx;
  if (ny !== mh(m)) m.h = ny;
}

/* ---------- 状態そのもの ---------- */
// すべての路線図。代入はこのモジュールの中だけで行い、外からは replaceState() を使う
export let S = null;
export const getSnapshot = () => S;
export function replaceState(next) { S = next; }
// 状態全体の文字列表現(Undo/Redo と保存に使う)
export const snapStr = () => { try { return JSON.stringify(S); } catch (e) { return ''; } };

/* ---------- 検索(対象の路線図を引数で明示する。画面の「いま開いている路線図」は知らない) ---------- */
// 駅を探す(路線の stations にも、路線に属さない乗り換え駅の m.hubs にも入っている)
export const findStationIn = (map, id) =>
  (map.hubs || []).find(s => s.id === id) || map.lines.flatMap(l => l.stations).find(s => s.id === id);
// その駅が属する路線(0〜複数。乗り換え駅は0本のこともある)
export const linesOfIn = (map, id) => map.lines.filter(l => l.stations.some(s => s.id === id));
// すべての駅(複数路線に共有されている同じ駅は1つにまとめる)
export const allStations = map => {
  const seen = new Map();
  map.lines.forEach(l => l.stations.forEach(s => seen.set(s.id, s)));
  (map.hubs || []).forEach(s => seen.set(s.id, s));
  return [...seen.values()];
};
// 「何も置かれていない路線図」か(U5: 空状態の案内を出すかの判定)。
// 名前では判定しない(ユーザーが名前を変えると案内が出なくなってしまうため)。
// mkMap() は boxes / images を作らないので、無い配列も空として扱う。
export const blankMap = m => !!m &&
  !m.lines.some(l => l.stations.length || l.crossings.length) &&
  !(m.roads || []).length && !(m.stops || []).length &&
  !(m.hubs || []).length && !(m.boxes || []).length && !(m.images || []).length;

/* ---------- 「接続する駅」(路線ごとのリスト) ---------- */
export const linksIn = (s, lid) => (s.links && Array.isArray(s.links[lid])) ? s.links[lid] : [];
// 表示する接続グループ(属する路線ごと。路線外の接続があるときも1つ並べる)
export const linkGroups = (m, s) => {
  const gs = [];
  m.lines.forEach(l => { if (l.stations.some(x => x.id === s.id)) gs.push({ lid: l.id, name: l.name, color: l.color, ids: linksIn(s, l.id) }); });
  const off = linksIn(s, OFF_LINK);
  if (off.length || !gs.length) gs.push({ lid: OFF_LINK, name: '路線外', color: STOP_COLOR, ids: off });
  return gs;
};
// どの路線にも属さなくなるとき、路線ごとの接続を「路線外」にまとめる
export const flattenLinks = s => {
  const ids = [];
  if (s.links && typeof s.links === 'object') {
    Object.keys(s.links).forEach(k => (Array.isArray(s.links[k]) ? s.links[k] : []).forEach(id => { if (!ids.includes(id)) ids.push(id); }));
  }
  s.links = {}; s.links[OFF_LINK] = ids;
};
// 存在しなくなった駅を指している接続リストを掃除する(不正なIDを残さない)
export function pruneLinks(map) {
  const each = st => {
    if (!st.links || typeof st.links !== 'object') return;
    Object.keys(st.links).forEach(k => { if (Array.isArray(st.links[k])) st.links[k] = st.links[k].filter(id => findStationIn(map, id)); });
  };
  map.lines.forEach(l => l.stations.forEach(each));
  (map.hubs || []).forEach(each);
}
