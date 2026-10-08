/* S1 の受入テスト: 取り込んだ文書のサニタイズ(src/core/sanitize.js)。
   実行は `npm test`(= node --test)。依存パッケージは使わない(指示書 PART1 の硬性規則1)。
   - 1〜9 は自動テスト、10 はブラウザでの手動確認(下のコメント参照)。
   10. 手動: 悪性なJSONを実際にブラウザで取り込む → ダイアログもコンソールエラーも出ず、画面が使える。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeDocument, LIMITS } from '../src/core/sanitize.js';
import { migrate } from '../src/core/migration.js';
import { COLORS, BG, mkMap } from '../src/core/model.js';
import { SAMPLE_DOC, SAMPLE_MAP } from '../src/core/sample.js';

const HEX = /^#[0-9a-fA-F]{6}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const EVIL = 'red" onmouseover="alert(1)';
const clone = v => structuredClone(v);
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/sample.json', import.meta.url), 'utf8'));

// 動作確認用の「まともな文書」(全フィールドの既定を持ち、書き換えたい所だけ差し替える)
function baseDoc() {
  const m = mkMap('地図');
  m.id = 'm1';
  // 実際に保存されている文書は migrate() を通っているので、その形に合わせておく
  m.w = 2400; m.h = 1600;
  m.show = { road: true, stop: true, box: true, img: true };
  m.boxes = []; m.images = [];
  const l = m.lines[0];
  l.id = 'l1';
  l.stations = [
    { id: 'st-a', name: '駅A', x: 200, y: 300, hub: false, links: { l1: ['st-b'] } },
    { id: 'st-b', name: '駅B', x: 400, y: 300, hub: false, links: {} }
  ];
  l.crossings = [{ id: 'cx-1', seg: 0, t: 0.5, name: '' }];
  return { maps: [m] };
}

test('S1-1 悪性な色はすべて既定色に置き換わる', () => {
  const d = baseDoc();
  const m = d.maps[0];
  m.bg = EVIL;
  m.lines[0].color = EVIL;
  m.lines[0].stations[0].color = EVIL;
  m.roads.push({ id: 'r1', name: '道', color: EVIL, width: 16, pts: [{ x: 10, y: 10 }] });
  m.boxes.push({ id: 'b1', x: 0, y: 0, w: 100, h: 50, text: 'x', fill: EVIL });
  m.stops.push({ id: 'p1', name: 'バス', x: 10, y: 10, kind: 'stop', color: EVIL });

  const { doc } = sanitizeDocument(d);
  const o = doc.maps[0];
  assert.equal(o.bg, BG, '背景色は既定へ');
  assert.equal(o.lines[0].color, COLORS[0], '路線色は既定へ');
  assert.equal(o.lines[0].stations[0].color, undefined, '駅の色は落として路線色に従う');
  assert.equal(o.roads[0].color, COLORS[0], '道路の色は既定へ');
  assert.equal(o.boxes[0].fill, '#ffffff', 'ラベル枠の塗りは既定へ');
  assert.equal(o.stops[0].color, undefined, 'バス停の色は落として標準色に従う');
  for (const c of [o.bg, o.lines[0].color, o.roads[0].color, o.boxes[0].fill]) assert.match(c, HEX);
});

test('S1-2 数値でない値はクランプされ、文字列は数値化しない', () => {
  const d = baseDoc();
  const st = d.maps[0].lines[0].stations[0];
  st.x = '1" onload="alert(1)';
  st.y = '120';          // 数値化しない(壊れたファイルの扱い)
  st.nameRot = NaN;
  st.nameX = 1e308;      // 範囲外はクランプ
  st.nameY = Infinity;
  const img = { id: 'i1', src: 'data:image/webp;base64,AAAA', x: 0, y: 0, w: 100, h: 100, opacity: 5, z: 'back' };
  d.maps[0].images.push(img);

  const { doc } = sanitizeDocument(d);
  const s = doc.maps[0].lines[0].stations[0];
  assert.equal(s.x, 0, '不正な文字列は0');
  assert.equal(s.y, 0, '"120" も数値化しない');
  assert.equal(s.nameRot, 0, 'NaN は0');
  assert.equal(s.nameY, 0, 'Infinity は0');
  assert.equal(s.nameX, LIMITS.canvasMax, '1e308 は上限へ');
  assert.equal(doc.maps[0].images[0].opacity, 1, '不透明度は0..1');
  assert.ok(Number.isFinite(s.x) && Number.isFinite(s.nameX));
});

test('S1-3 不正なIDは作り直され、参照(リンク)もすべて追いかける', () => {
  const bad = 'a" onclick="alert(1)';
  const d = baseDoc();
  const m = d.maps[0];
  m.lines[0].stations[0].id = bad;
  m.lines[0].stations[0].links = { l1: ['st-b'] };
  m.lines[0].stations[1].links = { l1: [bad] };      // 壊れたIDへの参照
  m.hubs.push({ id: bad, name: '路線外', x: 1, y: 1, hub: true, links: { '-': [bad] } });  // 重複も作り直す

  const { doc } = sanitizeDocument(d);
  const l = doc.maps[0].lines[0];
  const ids = [...l.stations, ...doc.maps[0].hubs].map(s => s.id);
  assert.ok(ids.every(id => ID_RE.test(id)), 'ID は ASCII 64文字以内');
  assert.ok(!ids.includes(bad), '壊れたIDは残らない');
  assert.equal(new Set(ids).size, ids.length, 'ID は重複しない');

  const newA = l.stations[0].id;
  assert.ok(newA !== bad);
  assert.deepEqual(l.stations[1].links.l1, [newA], 'リンク先のIDも付け替わる');
  // ダングリング参照なし(全リンク先が実在する)
  const all = new Set(ids);
  for (const s of [...l.stations, ...doc.maps[0].hubs])
    for (const arr of Object.values(s.links)) for (const id of arr) assert.ok(all.has(id), '実在しない駅へのリンク');
});

test('S1-4 画像の data URL は許可リストのみ。それ以外は画像ごと捨てる', () => {
  const badSrcs = [
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'javascript:alert(1)',
    'https://evil.example/x.png',
    '/relative.png',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='
  ];
  const d = baseDoc();
  badSrcs.forEach((src, i) => d.maps[0].images.push({ id: 'bad' + i, src, x: 0, y: 0, w: 10, h: 10, opacity: 1, z: 'back' }));
  d.maps[0].images.push({ id: 'good', src: 'data:image/webp;base64,AAAA', x: 0, y: 0, w: 10, h: 10, opacity: 1, z: 'back' });

  const { doc } = sanitizeDocument(d);
  assert.equal(doc.maps[0].images.length, 1, '許可リスト外は捨てる');
  assert.equal(doc.maps[0].images[0].id, 'good');
  assert.equal(doc.maps[0].images[0].src, 'data:image/webp;base64,AAAA');
});

test('S1-5 __proto__ を混ぜても Object.prototype を汚染しない', () => {
  const hostile = JSON.parse('{"maps":[{"__proto__":{"polluted":true},"lines":[{"stations":[]}]}]}');
  const { doc } = sanitizeDocument(hostile);
  assert.equal({}.polluted, undefined, 'prototype が汚染されていない');
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(Object.hasOwn(doc.maps[0], '__proto__'), false, 'ホワイトリストで消える');
  assert.equal(doc.maps[0].polluted, undefined);
});

test('S1-5b 予約名(__proto__ など)を ID にしても作り直し、links のキーも追わせて JSON に残る', () => {
  const RESERVED = ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf',
    'toLocaleString', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable'];
  const d = baseDoc();
  d.maps[0].id = '__proto__';
  const l = d.maps[0].lines[0];
  l.id = '__proto__';
  l.stations = [
    // JSON.parse なら __proto__ も「普通の own key」として入る(リテラルは prototype 差し替えになる)
    { id: 'toString', name: '駅A', x: 100, y: 100, hub: false,
      links: JSON.parse('{"__proto__":["hasOwnProperty"]}') },
    { id: 'hasOwnProperty', name: '駅B', x: 300, y: 100, hub: false, links: {} },
    { id: 'constructor', name: '駅C', x: 500, y: 100, hub: false, links: {} }
  ];
  assert.ok(Object.hasOwn(l.stations[0].links, '__proto__'), '前提: __proto__ は own key として存在する');
  const { doc } = sanitizeDocument(d);
  const m = doc.maps[0], line = m.lines[0];
  // 予約名はすべて作り直される(= `__proto__` がオブジェクトのキーに到達しない)
  assert.ok(!RESERVED.includes(m.id) && ID_RE.test(m.id), '地図IDが作り直される');
  assert.ok(!RESERVED.includes(line.id) && ID_RE.test(line.id), '路線IDが作り直される');
  for (const s of line.stations) assert.ok(!RESERVED.includes(s.id) && ID_RE.test(s.id), '駅IDが作り直される');
  assert.equal(new Set(line.stations.map(s => s.id)).size, line.stations.length, 'ID は重複しない');
  // links のキーは新しい路線IDへ追従し、保存(JSON往復)しても消えない
  const a = line.stations[0];
  assert.deepEqual(Object.keys(a.links), [line.id], 'links のキーが新しい路線IDに追う');
  const back = JSON.parse(JSON.stringify(a.links));
  assert.deepEqual(back[line.id], [line.stations[1].id], '往復後もリンクが残る(保存で消えない)');
  // 組み込み本体は傷ついていない
  assert.equal({}.polluted, undefined, 'prototype 汚染なし');
  assert.equal(Object.prototype.constructor, Object, 'constructor が潰れていない');
});

test('S1-6 10万駅の敵対ファイルも上限まで詰めて高速に終わる', () => {
  const d = baseDoc();
  const l = d.maps[0].lines[0];
  l.stations = Array.from({ length: 100000 }, (_, i) => ({ id: 'st' + i, name: '駅' + i, x: i, y: 0, hub: false, links: {} }));
  const t0 = Date.now();
  const { doc, warnings } = sanitizeDocument(d);
  const ms = Date.now() - t0;
  assert.equal(doc.maps[0].lines[0].stations.length, LIMITS.stationsPerLine, '上限で切り詰める');
  assert.ok(warnings.length > 0, '切り詰めは警告に出る');
  assert.ok(ms < 1000, '1秒未満で終わる(実測 ' + ms + 'ms)');
});

test('S1-7 ラウンドトリップ: 正当な文書は中身を変えない(データを落とさない)', () => {
  const raw = fixture();
  const { doc, warnings } = sanitizeDocument(clone(raw));
  assert.deepEqual(warnings, [], '正当な文書に警告は出ない');
  const a = migrate(clone(doc));
  const b = migrate(clone(raw));
  assert.deepEqual(a, b, '正規化前後で migrate の結果が一致する = 正当なフィールドを落としていない');
});

test('S1-8 旧形式(type:road の路線)もそのまま移行できる', () => {
  const legacy = {
    maps: [{
      id: 'old1', name: '旧', bg: '#ffffff',
      lines: [{
        id: 'oldline', name: '道路', color: '#2E9E5B', width: 8, type: 'road',
        stations: [
          { id: 'x1', name: 'バス停A', x: 100, y: 100, shape: 'terminal', color: '#123456' },
          { id: 'x2', name: 'バス停B', x: 300, y: 100, shape: 'stop', color: '#123456' }
        ],
        crossings: []
      }],
      roads: [], stops: [], hubs: []
    }]
  };
  const { doc } = sanitizeDocument(legacy);
  const m = migrate(doc);
  assert.equal(m.maps[0].roads.length, 1, '道路へ変換される');
  assert.equal(m.maps[0].stops.length, 2, 'バス停へ変換される');
  assert.equal(m.maps[0].lines.length, 1, 'type:road の路線は残らない');
  assert.equal(m.maps[0].stops[0].color, '#123456');
  assert.equal(m.maps[0].stops[0].kind, 'terminal');
});

test('S1-9 足りない配列・表示設定は拒否せず修復する', () => {
  const sparse = { maps: [{ id: 'm9', name: '不足', lines: [{ id: 'l9', name: 'L', color: '#E5352B' }] }] };
  const { doc } = sanitizeDocument(sparse);
  const m = doc.maps[0];
  assert.deepEqual(m.lines[0].stations, []);
  assert.deepEqual(m.lines[0].crossings, []);
  assert.deepEqual(m.roads, []);
  assert.deepEqual(m.stops, []);
  assert.deepEqual(m.hubs, []);
  assert.deepEqual(m.images, []);
  assert.deepEqual(m.boxes, []);
  assert.deepEqual(m.show, { road: true, stop: true, box: true, img: true });
  assert.doesNotThrow(() => migrate(doc), 'migrate が例外を出さない');
});

test('S1-10 使用不能な文書だけを invalid document で拒否する', () => {
  assert.throws(() => sanitizeDocument(null), /invalid document/);
  assert.throws(() => sanitizeDocument('nope'), /invalid document/);
  assert.throws(() => sanitizeDocument({}), /invalid document/);
  assert.throws(() => sanitizeDocument({ maps: [] }), /invalid document/);
  assert.throws(() => sanitizeDocument({ maps: 'x' }), /invalid document/);
  assert.throws(() => sanitizeDocument({ maps: [null, 'x'] }), /invalid document/, '使える地図が1つも無ければ使えない');
});

test('S1-11 入力オブジェクトを書き換えない(純粋な関数)', () => {
  const raw = fixture();
  const before = clone(raw);
  sanitizeDocument(raw);
  assert.deepEqual(raw, before, '入力は不変');
});

test('S1-12 上限と文字数: 件数キャップで切り詰め、日本語の名前は保持する', () => {
  const d = baseDoc();
  d.maps[0].lines[0].stations[0].name = 'あ'.repeat(500);   // nameLen 超
  for (let i = 0; i < LIMITS.maps + 10; i++) {
    const m = mkMap('地図' + i);
    m.id = 'm' + i;
    d.maps.push(m);
  }
  const { doc, warnings } = sanitizeDocument(d);
  assert.equal(doc.maps.length, LIMITS.maps, '地図の上限');
  assert.equal(doc.maps[0].lines[0].stations[0].name.length, LIMITS.nameLen, '名前は上限で切る');
  assert.equal(doc.maps[0].lines[0].stations[0].name[0], 'あ', '日本語はそのまま');
  assert.ok(warnings.some(w => /路線図/.test(w)), '切り詰めの警告');
});

test('S1-13 空の文書ではなく「路線図1件」に直せるものは直して通す', () => {
  // 地図が1つも無ければ invalid、線路が空の地図は修復して通す
  const noLines = { maps: [{ id: 'mx', name: '空', roads: [], stops: [], hubs: [] }] };
  const { doc } = sanitizeDocument(noLines);
  assert.equal(doc.maps[0].lines.length, 1, '線路が無ければ1本作る');
  assert.ok(doc.maps[0].lines[0].stations.length === 0);
  assert.doesNotThrow(() => migrate(doc));
});

test('S1-14 同梱のサンプル(U5)は警告なしで通る(fixtures と同一)', () => {
  // 空の路線図の案内から1クリックで入れるサンプル。**補正なしで通る**こと(S1 の要求)。
  const r = sanitizeDocument(SAMPLE_DOC);
  assert.deepEqual(r.warnings, [], 'サンプルが補正(警告)なしで通る');
  assert.equal(r.doc.maps[0].name, 'サンプル路線図');
  assert.ok(r.doc.maps[0].lines[0].stations.length >= 3, '触れる駅が入っている');
  assert.ok(r.doc.maps[0].boxes.length >= 1, 'ラベル枠の見本も入っている');
  // ブラウザでの検証時に localStorage へ入れ直している fixtures とずれると手順が壊れるので同一も確認
  assert.deepEqual(r.doc, fixture(), 'test/fixtures/sample.json と同一であること');
  // 同じサンプルを2回入れても前の参照を共有しない(複製や連続読み込みで中身が混ざらない)
  assert.notEqual(r.doc.maps[0], SAMPLE_MAP, '入力のオブジェクトをそのまま返さない');
});
