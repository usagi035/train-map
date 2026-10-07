/* =============================================================================
   U5(初回・空状態、一覧の情報と複製・名前変更)のテスト。
   - 状態を変える操作は core の純関数なので、実際に呼んで確かめる。
   - 画面の配線(空状態の案内・一覧の行)は DOM 無しでは動かせないのでソースで確かめる。
   =========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCore } from '../src/core/operations.js';
import { mkMap, blankMap, allStations } from '../src/core/model.js';
import { SAMPLE_MAP } from '../src/core/sample.js';
import { LIMITS, sanitizeDocument } from '../src/core/sanitize.js';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const html = read('index.html');
const tabsSrc = read('src/renderer/tabs.js');
const canvasSrc = read('src/renderer/canvas.js');
const rsrc = read('src/renderer/renderer.js');
const uisrc = read('src/renderer/ui-state.js');
const storeSrc = read('src/renderer/storage.js');

/** ルールの中身(`{ }` の中)を返す。無ければテストを落とす */
const cssOf = sel => {
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const i = css.indexOf(sel);
  assert.ok(i >= 0, `CSS が無い: ${sel}`);
  const a = css.indexOf('{', i), b = css.indexOf('}', a);
  return css.slice(a + 1, b);
};

test('U5-1 空の路線図に「まず何をすればいいか」とサンプルのボタンが出る', () => {
  assert.match(html, /id="empty"[^>]*hidden/, '案内が初期状態で出ている(hidden 無し)');
  assert.match(html, /id="loadsample"/, 'サンプルを読み込むボタンが無い');
  assert.match(html, /「駅を追加」<\/b>を押してから、キャンバスをクリック/, '手順の案内が無い');
  // 本文は下のキャンバスへクリックを届け、ボタンだけが押せる
  assert.match(cssOf('#empty {'), /pointer-events:none/, '案内がキャンバスを覆っている');
  assert.match(cssOf('#empty button {'), /pointer-events:auto/, 'ボタンが押せない');
  // display:flex は [hidden] より強いので、hidden のときは消す規則が要る
  assert.match(cssOf('#empty[hidden]'), /display:none/, 'hidden でも案内が消えない');
  assert.match(cssOf('#stage'), /position:relative/, '案内の基準になる位置指定が無い');
  // 描画のたびに空かどうかで出し入れする
  assert.match(canvasSrc, /blankMap\(m\)/, '空判定を使っていない');
  assert.match(canvasSrc, /em\.hidden = false;/, '空のときに案内を出していない');
  assert.match(canvasSrc, /em\.hidden = true;/, '埋まったあとも案内が残る');
  // ボタンの配線
  assert.match(rsrc, /getElementById\('loadsample'\)\.addEventListener\('click'/, 'ボタンが繋がっていない');
  assert.match(rsrc, /core\.loadSample\(m\.id\)/, 'core を経由していない');
});

test('U5-2 blankMap は「何も置かれていない」だけを空と判定する(実際に動かす)', () => {
  const m = mkMap('路線図 1');     // mkMap は boxes / images を作らない → それも空として扱えること
  assert.equal(blankMap(m), true, '新しい路線図が空でない');
  assert.equal(blankMap(null), false, 'null は空ではない扱いにする');

  m.lines[0].stations.push({ id: 'st-a', name: '駅A', x: 10, y: 10, hub: false, links: {} });
  assert.equal(blankMap(m), false, '駅が1つでも置かれたら空ではない');
  assert.equal(allStations(m).length, 1, '件数は allStations で数える');

  const m2 = mkMap('路線図 2');
  m2.lines[0].crossings = [{ id: 'cx-1', seg: 0, t: 0.5, name: '' }];
  assert.equal(blankMap(m2), false, '踏切だけでも空ではない');
  const m3 = mkMap('路線図 3');
  m3.boxes = [{ id: 'box-1', x: 0, y: 0, w: 10, h: 10, text: '' }];
  assert.equal(blankMap(m3), false, 'ラベル枠だけでも空ではない');
  const m4 = mkMap('路線図 4');
  m4.hubs = [{ id: 'hub-1', name: '駅', x: 0, y: 0, hub: true, links: {} }];
  assert.equal(blankMap(m4), false, '路線外の乗り換え駅だけでも空ではない');
});

test('U5-3 loadSample は空の路線図の中身だけを差し替える(core を実際に動かす)', () => {
  const core = createCore();
  core.replace({ maps: [mkMap('路線図 1')] });
  const id = core.getState().maps[0].id;
  assert.equal(blankMap(core.getState().maps[0]), true, '始まりは空の路線図');

  const m = core.loadSample(id);
  assert.ok(m, 'サンプルが入らない');
  assert.equal(m.id, id, '路線図のIDを変えてしまう(開いているタブとずれる)');
  assert.equal(m.name, 'サンプル路線図', '名前が入らない');
  assert.equal(blankMap(m), false, '入ったのに空状態のままになる');
  assert.ok(m.lines[0].stations.length >= 3, '触れる駅が入っていない');
  assert.ok(m.boxes.length >= 1 && m.images.length >= 1, '見本の種類が足りない');

  // 毎回別のコピーを渡す(2回入れると中身が混ざらない / 元データを書き換えられない)
  m.lines[0].stations[0].name = '書き換えた';
  assert.equal(SAMPLE_MAP.lines[0].stations[0].name, 'あー駅', 'サンプル本体を書き換えてしまった');
  const again = core.loadSample(id);
  assert.equal(again.lines[0].stations[0].name, 'あー駅', '前の読み込みの影響を受けている');

  assert.equal(core.loadSample('ないID'), null, '無いIDでも書き換えてしまう');
});

test('U5-4 複製と名前変更(core を実際に動かす)', () => {
  const core = createCore();
  core.replace({ maps: [mkMap('本線'), mkMap('支線')] });
  const [a, b] = core.getState().maps;

  // ---- 複製: 中身を丸ごとコピーし、ID と名前だけ作る。直後の位置に入る
  const c = core.duplicateMap(a.id);
  assert.ok(c, '複製できない');
  assert.notEqual(c.id, a.id, 'ID が同じ = 上書きされる');
  assert.equal(c.name, '本線 のコピー', '複製の名前が違う');
  assert.deepEqual(core.getState().maps.map(m => m.id), [a.id, c.id, b.id], '入る位置が違う');
  assert.equal(core.getState().maps.filter(m => m.name === '本線').length, 1, '元の名前が増える');
  // 深いコピーであること(片方の編集がもう片方に効く)
  const ca = c.lines[0].stations[0];
  if (ca) { ca.x = 9999; }
  if (a.lines[0].stations[0]) assert.notEqual(a.lines[0].stations[0].x, 9999, '元と共有してしまっている');
  assert.equal(core.duplicateMap('ないID'), null, '無いIDでも複製してしまう');

  // ---- 名前変更: 空の名前は受け付けない
  assert.equal(core.renameMap(a.id, 'あとで見る'), a, '名前が変わらない');
  assert.equal(a.name, 'あとで見る', '名前の変更が入っていない');
  assert.equal(core.renameMap(a.id, ''), null, '空の名前で消せてしまう');
  assert.equal(a.name, 'あとで見る', '空の名前で上書きされてしまった');
  assert.equal(core.renameMap(a.id, 'あ'.repeat(LIMITS.nameLen + 5)).name.length, LIMITS.nameLen + 5,
    'core は文字数を切らない(切るのは画面側)');
  assert.equal(core.renameMap('ないID', 'X'), null, '無いIDでも書き換えてしまう');
});

test('U5-5 最終更新は文書本体を増やさず、別キーに記録する', () => {
  // 書き出しの JSON 形式を変えないため、文書に足さず別のキーへ
  assert.match(storeSrc, /updated: NS \+ 'updated'/, '最終更新のキーが名前空間つきでない');
  const m = mkMap('地図');
  assert.ok(!('updated' in m), '路線図オブジェクトに足してしまっている');
  const { doc } = sanitizeDocument({ maps: [m] });
  assert.ok(!('updated' in doc.maps[0]), '書き出し(JSON)に最終更新が混ざる');
  assert.ok(!/updated/.test(SAMPLE_MAP.id + SAMPLE_MAP.name), 'サンプル側にも混ざっている(誤検知用チェック)');
  // 保存できた変更だけ記録する(失敗した変更は日時にしない)
  assert.match(uisrc, /if \(ok\) touchMap\(/, '保存に失敗しても最終更新になっている');
  assert.match(uisrc, /export function touchMap\(id\)/, 'touchMap が無い');
  assert.match(uisrc, /export const mapUpdated = /, '一覧から読む関数が無い');
  assert.match(uisrc, /export function stampMissing\(\)/, '起動時に日時を作る関数が無い');
  assert.match(rsrc, /stampMissing\(\);/, '起動時に記録していない(一覧の日時が空欄)');
  // 一覧は件数と最終更新を出す
  assert.match(tabsSrc, /allStations\(m\)\.length/, '件数を数えていない');
  assert.match(tabsSrc, /最終更新 \$\{fmtTime\(t\)\}/, '一覧に最終更新が出ない');
  assert.match(tabsSrc, /路線 \$\{m\.lines\.length\}/, '一覧に路線数が出ない');
  // 変わった路線図だけを渡すよう、構造の変化は ID を指定して保存する
  assert.match(tabsSrc, /function newMap\(\).*save\(m\.id\)/, '追加した路線図のIDを渡していない');
  assert.match(tabsSrc, /save\(id\);[^\n]*\r?\n[^\n]*forgetMap\(id\);/, '削除した路線図の記録を消していない');
  assert.match(tabsSrc, /複製した路線図の最終更新として記録する/, '複製の最終更新が元の路線図になる');
  assert.match(rsrc, /S\.maps\.forEach\(m => touchMap\(m\.id\)\);/, '取り込みした路線図の日時が残ったまま');
  assert.match(rsrc, /save\(m\.id\);[^\n]*\r?\n[^\n]*renderAll\(\);/, 'サンプルを読めた路線図の日時が付かない');
});

test('U5-6 一覧の行に「複製」と「名前を変更」があり、名前変更はダイアログを使わない', () => {
  assert.match(tabsSrc, /data-dup="/, '複製ボタンが無い');
  assert.match(tabsSrc, /data-ren="/, '名前変更ボタンが無い');
  assert.match(tabsSrc, /data-row="\$\{idf\(m\.id\)\}"/, '行にIDが無く、行を特定できない');
  // alert / prompt は出さない(U2 の方針)。その場の入力欄に置き換える
  assert.ok(!/\b(prompt|alert|confirm)\s*\(/.test(tabsSrc), 'ダイアログを使っている');
  assert.match(tabsSrc, /document\.createElement\('input'\)/, '入力欄を作っていない');
  assert.match(tabsSrc, /inp\.maxLength = LIMITS\.nameLen/, '名前の長さを制限していない');
  assert.match(tabsSrc, /e\.key === 'Enter'/, 'Enter で確定できない');
  assert.match(tabsSrc, /e\.key === 'Escape'/, 'Esc で中止できない');
  assert.match(tabsSrc, /addEventListener\('blur'/, 'フォーカスが外れたら確定しない');
  // 一覧を描き直さない(描き直すと、いま押しているボタンの次のクリックが届かない)
  assert.match(tabsSrc, /inp\.replaceWith\(name\)/, '一覧ごと描き直している');
  assert.match(tabsSrc, /if \(changed\) renderTabs\(\);/, 'タブの名前が追随しない');
});
