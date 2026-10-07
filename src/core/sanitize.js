/* ===========================================================================
   取り込んだ文書(保存データ・書き出したJSON・タブ間同期)の検証と修復(S1)。

   - 画面(DOM)・localStorage・アラートには一切触れない(core の規約)。
   - 入力オブジェクトは書き換えない。新しく作ったオブジェクトだけを返す。
   - 「直せるものは直して通す」。invalid document は構造上使いものに
     ならないとき(地図が1件も無いなど)だけ投げる。
   - 白名单は src/core/model.js・migration.js・画面が読むプロパティから作った。
   =========================================================================== */
import { newId, COLORS, BG, mkLine, OFF_LINK } from './model.js';

// 読み込み文書の上限(件数は取りすぎると描画や保存が重くなるため)
export const LIMITS = {
  maps: 50, linesPerMap: 100, stationsPerLine: 500, crossingsPerLine: 500,
  hubs: 500, roads: 200, roadPts: 1000, stops: 1000, boxes: 500, images: 30,
  nameLen: 100, textLen: 200, canvasMax: 20000, imageDataUrlBytes: 3_000_000,
  // 読み込む**ファイル**の上限(S6)。読む前(または canvas に描く前)に弾き、
  // メモリを食う処理そのものを始めないための値。
  jsonFileBytes: 10_000_000,     // JSON 10MB: readAsText の前
  imageFileBytes: 15_000_000,    // 画像15MB: デコード(readAsDataURL)の前
  imagePixels: 50_000_000,       // 50メガピクセル: canvas へ drawImage の前
};

/**
 * ファイル名として使える文字だけ残す(S6 の書き出しファイル名用)。
 * 地図名はユーザーが自由に付けられるため、そのまま使うと
 * 区切り記号(/ \\ : * ? " < > |)や制御文字でファイル名が壊れる。
 * - 制御文字と区切り記号を除去 → 空白を1つにまとめる → 前後の空白を落とす
 * - 80文字まで(末尾の「.」「空白」も落とす: Windows が勝手に落としてしまうため)
 * - 何も残らなければ `路線図`
 */
export function safeFilename(s) {
  const t = String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '');
  return t || '路線図';
}

/* ---------- 型ごとの検証ヘルパ(すべて「直す」方向に倒す) ---------- */
const HEX = /^#[0-9a-fA-F]{6}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// 画像は data URL のうち指定の形式のみ。svg / javascript: / http(s) / 相対URL は禁止
const IMG_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const SHAPES = ['circle', 'double', 'square', 'diamond'];
const KINDS = ['stop', 'terminal'];
const ZONES = ['back', 'front'];

const isObj = v => (v !== null && typeof v === 'object' && !Array.isArray(v));
// 色: #rrggbb 以外はすべて既定へ(COLORS / BG / STOP_COLOR / box.fill は6桁のみ)
const col = (v, def) => (typeof v === 'string' && HEX.test(v) ? v : def);
// 数値: 数値でないものは既定へ(文字列は数値化しない)。その後、範囲へ丸める
const num = (v, def, min, max) =>
  (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def);
const coord = v => num(v, 0, -LIMITS.canvasMax, LIMITS.canvasMax);   // 座標
const sizeOf = (v, def) => num(v, def, 1, LIMITS.canvasMax);         // サイズ(1以上)
const ratioOf = (v, def) => num(v, def, 0, 1);                       // 不透明度 0..1
const rotOf = v => num(v, 0, -100000, 100000);                       // 名前の回転角
const boolOf = (v, def) => (typeof v === 'boolean' ? v : def);
const strOf = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const oneOf = (v, list) => (typeof v === 'string' && list.indexOf(v) >= 0 ? v : undefined);

/* ---------- ID: 規則に合う文字列で未使用ならそのまま、それ以外は作り直す ----------
   作り直したIDは対応表に残し、リンク(路線ID・駅ID)の参照をあとで追えるようにする。
   地図ごとに1組。地図のIDは文書ごとに1組(重複しないようにする)。 */
function makeBag() {
  const used = new Set();          // 使い終わった(=実際に存在する)ID
  const lineIds = new Map();       // 元のID → 新しいID(路線)
  const stIds = new Map();         // 元のID → 新しいID(駅)
  const lineIdSet = new Set();     // 新しいIDのうち路線のもの
  const stIdSet = new Set();       // 新しいIDのうち駅のもの
  const take = (raw, map, set) => {
    // 元の文字列は「壊れていても」対応表に残す(参照を後から追えるようにするため)
    const rawStr = (typeof raw === 'string') ? raw : '';
    const usable = rawStr !== '' && ID_RE.test(rawStr) && !used.has(rawStr);
    let id = usable ? rawStr : newId();
    while (used.has(id)) id = newId();
    used.add(id);
    if (set) set.add(id);
    if (rawStr !== '' && map && !map.has(rawStr)) map.set(rawStr, id);   // 最初に登録した方を正とする
    return id;
  };
  return {
    st:   raw => take(raw, stIds, stIdSet),
    line: raw => take(raw, lineIds, lineIdSet),
    other: raw => take(raw, null, null),
    stIds, stIdSet, lineIds, lineIdSet,
  };
}

// 地図のID(文書じゅうで重複しないこと)
function takeMapId(raw, used) {
  const rawStr = (typeof raw === 'string') ? raw : '';
  const usable = rawStr !== '' && ID_RE.test(rawStr) && !used.has(rawStr);
  let id = usable ? rawStr : newId();
  while (used.has(id)) id = newId();
  used.add(id);
  return id;
}

/* ---------- 接続(links): 路線ID → 駅ID[] ----------
   作り直したIDを参照へ追い付かせて、実在しない駅へのリンクを残さない。 */
function sanitizeLinks(raw, bag, ownId) {
  // 旧形式(配列)。migrate() が路線ごとの対象へ振り分けるので形はそのまま残す
  if (Array.isArray(raw)) {
    const out = [];
    for (const x of raw) {
      if (typeof x !== 'string') continue;
      const id = bag.stIds.get(x) || (bag.stIdSet.has(x) ? x : '');
      if (id && id !== ownId && bag.stIdSet.has(id) && out.indexOf(id) < 0) out.push(id);
    }
    return out;
  }
  if (!isObj(raw)) return undefined;   // 持っていない → キーごと作らない
  const out = {};
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (!Array.isArray(v)) continue;
    // キーは「その地図の路線ID」か「路線外(-)」でなければならない
    let key = '';
    if (k === OFF_LINK) key = OFF_LINK;
    else {
      const mapped = bag.lineIds.get(k);
      if (mapped) key = mapped;
      else if (bag.lineIdSet.has(k)) key = k;
    }
    if (!key) continue;                 // 壊れた路線ID・実在しない路線へのキーは捨てる
    if (!Array.isArray(out[key])) out[key] = [];
    for (const x of v) {
      if (typeof x !== 'string') continue;
      const id = bag.stIds.get(x) || (bag.stIdSet.has(x) ? x : '');
      if (!id || id === ownId || !bag.stIdSet.has(id)) continue;
      if (out[key].indexOf(id) < 0) out[key].push(id);
    }
  }
  return out;
}

/* ---------- 要素ごとの修復 ---------- */
function sanitizeStation(raw, bag, legacy) {
  const s = { id: bag.st(raw.id) };
  s.name = strOf(raw.name, LIMITS.nameLen);
  s.x = coord(raw.x);
  s.y = coord(raw.y);
  s.hub = boolOf(raw.hub, false);
  if (raw.nameX !== undefined) s.nameX = coord(raw.nameX);
  if (raw.nameY !== undefined) s.nameY = coord(raw.nameY);
  if (raw.nameRot !== undefined) s.nameRot = rotOf(raw.nameRot);
  const c = col(raw.color, undefined);
  if (c !== undefined) s.color = c;                       // 無ければ路線の色に従う
  // 旧形式(type:road の路線)は 'terminal' がバス停の種別を表すフラグとして使われている
  const sh = oneOf(raw.shape, legacy ? SHAPES.concat(['terminal']) : SHAPES);
  if (sh !== undefined) s.shape = sh;
  return s;
}

function sanitizeCrossing(raw, bag) {
  const c = { id: bag.other(raw.id) };
  c.seg = Math.round(num(raw.seg, 0, 0, LIMITS.stationsPerLine));
  c.t = ratioOf(raw.t, 0);
  if (raw.name !== undefined) c.name = strOf(raw.name, LIMITS.nameLen);
  return c;
}

function sanitizeLine(raw, bag) {
  if (!isObj(raw)) return null;
  const l = { id: bag.line(raw.id) };
  l.name = strOf(raw.name, LIMITS.nameLen);
  l.color = col(raw.color, COLORS[0]);
  if (raw.width !== undefined) l.width = sizeOf(raw.width, 8);
  if (raw.loop !== undefined) l.loop = boolOf(raw.loop, false);
  if (raw.lock !== undefined) l.lock = boolOf(raw.lock, false);
  if (raw.hidden !== undefined) l.hidden = boolOf(raw.hidden, false);
  if (raw.type === 'road') l.type = 'road';   // 旧形式(migrate が道路・バス停へ変換)
  l.stations = [];    // migrate() が flatMap するので必ず作っておく
  l.crossings = [];
  return l;
}

function sanitizeRoad(raw, bag, warnings) {
  const r = { id: bag.other(raw.id) };
  r.name = strOf(raw.name, LIMITS.nameLen);
  r.color = col(raw.color, COLORS[0]);
  r.width = sizeOf(raw.width, 16);
  r.pts = [];
  const pts = Array.isArray(raw.pts) ? raw.pts : [];
  const n = Math.min(pts.length, LIMITS.roadPts);
  if (pts.length > n) warnings.push(`幹線道路「${r.name}」の頂点が上限(${n})を超えたため${pts.length - n}個を切り落としました`);
  for (let i = 0; i < n; i++) if (isObj(pts[i])) r.pts.push({ x: coord(pts[i].x), y: coord(pts[i].y) });
  return r;
}

function sanitizeStop(raw, bag) {
  const s = { id: bag.other(raw.id) };
  s.name = strOf(raw.name, LIMITS.nameLen);
  s.x = coord(raw.x);
  s.y = coord(raw.y);
  s.kind = oneOf(raw.kind, KINDS) || 'stop';
  const c = col(raw.color, undefined);
  if (c !== undefined) s.color = c;                       // 無ければ標準色に従う
  if (raw.nameX !== undefined) s.nameX = coord(raw.nameX);
  if (raw.nameY !== undefined) s.nameY = coord(raw.nameY);
  if (raw.nameRot !== undefined) s.nameRot = rotOf(raw.nameRot);
  return s;
}

function sanitizeBox(raw, bag) {
  return {
    id: bag.other(raw.id),
    x: coord(raw.x), y: coord(raw.y),
    w: sizeOf(raw.w, 120), h: sizeOf(raw.h, 60),
    text: strOf(raw.text, LIMITS.textLen),
    fill: col(raw.fill, '#ffffff'),
  };
}

// 形式が対応外・大きすぎる画像は「その要素ごと」捨てる(要素の削除以外の失敗方は無い)
function sanitizeImage(raw, bag) {
  if (typeof raw.src !== 'string' || !IMG_RE.test(raw.src)) return null;
  if (raw.src.length > LIMITS.imageDataUrlBytes) return null;
  return {
    id: bag.other(raw.id),
    src: raw.src,
    x: coord(raw.x), y: coord(raw.y),
    w: sizeOf(raw.w, 1), h: sizeOf(raw.h, 1),
    opacity: ratioOf(raw.opacity, 1),
    z: oneOf(raw.z, ZONES) || 'back',
  };
}

/* 件数制限つきの列挙。上限超は切り詰めて警告、壊れた要素は読み飛ばす */
function collect(rawArr, cap, label, bag, warnings, fn) {
  const arr = Array.isArray(rawArr) ? rawArr : [];
  const n = Math.min(arr.length, cap);
  if (arr.length > n) warnings.push(`${label}が上限(${cap})を超えたため${arr.length - n}件を読み込みませんでした`);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (!isObj(arr[i])) continue;
    const v = fn(arr[i], bag, warnings);
    if (v) out.push(v);
  }
  return out;
}

/* ---------- 地図1件 ---------- */
function sanitizeMap(raw, mapId, warnings) {
  const bag = makeBag();
  const m = { id: mapId };
  m.name = strOf(raw.name, LIMITS.nameLen);
  if (raw.bg !== undefined) m.bg = col(raw.bg, BG);          // 無ければ描画側が既定色を使う
  if (raw.w !== undefined) m.w = num(raw.w, 0, 0, LIMITS.canvasMax);
  if (raw.h !== undefined) m.h = num(raw.h, 0, 0, LIMITS.canvasMax);

  /* --- 路線の骨組み。駅は地図じゅうでIDを採番してから接続を結ぶ --- */
  const rawLines = Array.isArray(raw.lines) ? raw.lines : [];
  const lineN = Math.min(rawLines.length, LIMITS.linesPerMap);
  if (rawLines.length > lineN) warnings.push(`路線が上限(${LIMITS.linesPerMap})を超えたため${rawLines.length - lineN}本を読み込みませんでした`);
  const lines = [], srcLines = [];
  for (let i = 0; i < lineN; i++) {
    const l = sanitizeLine(rawLines[i], bag);
    if (l) { lines.push(l); srcLines.push(rawLines[i]); }
  }
  if (!lines.length) { const l = mkLine('1号線', COLORS[0]); lines.push(l); srcLines.push(null); }   // 線路が1本も無ければ作る
  m.lines = lines;

  /* --- 駅(全路線の駅 + 路線に属さない乗り換え駅) --- */
  const stations = [];   // { raw, obj, legacy } 接続の解決まで一時保持
  for (let i = 0; i < lines.length; i++) {
    const r = srcLines[i], l = lines[i];
    const legacy = !!(r && r.type === 'road');
    const arr = (r && Array.isArray(r.stations)) ? r.stations : [];
    const n = Math.min(arr.length, LIMITS.stationsPerLine);
    if (arr.length > n) warnings.push(`路線「${l.name}」の駅が上限(${n})を超えたため${arr.length - n}件を読み込みませんでした`);
    for (let k = 0; k < n; k++) {
      if (!isObj(arr[k])) continue;
      const s = sanitizeStation(arr[k], bag, legacy);
      l.stations.push(s);
      stations.push({ raw: arr[k], obj: s });
    }
  }
  m.hubs = [];
  const hubArr = Array.isArray(raw.hubs) ? raw.hubs : [];
  const hubN = Math.min(hubArr.length, LIMITS.hubs);
  if (hubArr.length > hubN) warnings.push(`乗り換え駅が上限(${LIMITS.hubs})を超えたため${hubArr.length - hubN}件を読み込みませんでした`);
  for (let i = 0; i < hubN; i++) {
    if (!isObj(hubArr[i])) continue;
    const s = sanitizeStation(hubArr[i], bag, false);
    m.hubs.push(s);
    stations.push({ raw: hubArr[i], obj: s });
  }

  /* --- 踏切 --- */
  for (let i = 0; i < lines.length; i++) {
    const r = srcLines[i], l = lines[i];
    const arr = (r && Array.isArray(r.crossings)) ? r.crossings : [];
    const n = Math.min(arr.length, LIMITS.crossingsPerLine);
    if (arr.length > n) warnings.push(`踏切が上限(${LIMITS.crossingsPerLine})を超えたため${arr.length - n}件を読み込みませんでした`);
    for (let k = 0; k < n; k++) if (isObj(arr[k])) l.crossings.push(sanitizeCrossing(arr[k], bag));
  }

  /* --- 接続(IDがすべて決まったあとにまとめて結ぶ) --- */
  for (const e of stations) {
    const links = sanitizeLinks(e.raw.links, bag, e.obj.id);
    if (links !== undefined) e.obj.links = links;
  }

  /* --- その他の要素 --- */
  m.roads = collect(raw.roads, LIMITS.roads, '幹線道路', bag, warnings, sanitizeRoad);
  m.stops = collect(raw.stops, LIMITS.stops, 'バス停', bag, warnings, sanitizeStop);
  m.boxes = collect(raw.boxes, LIMITS.boxes, 'ラベル枠', bag, warnings, sanitizeBox);
  m.images = collect(raw.images, LIMITS.images, '画像', bag, warnings, sanitizeImage);

  /* --- 種類ごとの表示/非表示(無ければ全部表示。migrate も同じ既定) --- */
  const sh = isObj(raw.show) ? raw.show : {};
  m.show = {
    road: boolOf(sh.road, true), stop: boolOf(sh.stop, true),
    box: boolOf(sh.box, true), img: boolOf(sh.img, true),
  };
  return m;
}

/* ===========================================================================
   取り込んだ文書そのものを検証する。
   返り値 { doc, warnings }。doc は新しく作ったオブジェクト(入力は不変)。
   =========================================================================== */
export function sanitizeDocument(raw) {
  const warnings = [];
  if (!isObj(raw) || !Array.isArray(raw.maps)) throw new Error('invalid document');

  const maps = [];
  const usedMapIds = new Set();
  const n = Math.min(raw.maps.length, LIMITS.maps);
  if (raw.maps.length > n) warnings.push(`路線図が上限(${LIMITS.maps})を超えたため${raw.maps.length - n}件を読み込みませんでした`);
  for (let i = 0; i < n; i++) {
    const r = raw.maps[i];
    if (!isObj(r)) { warnings.push('使えない路線図を1件読み飛ばしました'); continue; }
    maps.push(sanitizeMap(r, takeMapId(r.id, usedMapIds), warnings));
  }
  if (!maps.length) throw new Error('invalid document');   // 使いものになる地図が1件も無い
  return { doc: { maps }, warnings };
}
