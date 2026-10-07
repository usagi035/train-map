/* =============================================================================
   U7(仕上げ: 路線図ごとのズーム・スクロール、ヘッダーの保存表示、動きを減らす設定、
   サイドバー幅のキー)のテスト。
   - 位置の記憶は localStorage を動かすので、スタブを当てて実際に呼んで確かめる。
   - 保存表示・動きの設定は DOM/OS 設定が要るので、決めた作りになっているかソースで確かめる。
   - 実際の画面での確認はブラウザ(下のコメントと decisions 項目28)。
   =========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.location = { hash: '' };

/** 動作する localStorage 相当のスタブ(S3 と同じ作り)。書込み回数も数える */
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  const writes = [];
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { writes.push(k); map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
    clear: () => map.clear(),
    key: i => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    has: k => map.has(k),
    dump: () => Object.fromEntries(map),
    writes
  };
}

const { NS, KEYS, LEGACY, mapView, saveMapView, forgetMapView } =
  await import('../src/renderer/storage.js');

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const html = read('index.html');
const canvasSrc = read('src/renderer/canvas.js');
const uisrc = read('src/renderer/ui-state.js');
const tabsSrc = read('src/renderer/tabs.js');
const rsrc = read('src/renderer/renderer.js');
const storeSrc = read('src/renderer/storage.js');

/** `{ }` で囲まれた関数の中身を抜き出す */
function bodyOf(src, head) {
  const i = src.indexOf(head);
  assert.ok(i >= 0, '見つからない: ' + head);
  const a = src.indexOf('{', i);
  let d = 0;
  for (let j = a; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (d === 0) return src.slice(a, j + 1); }
  }
  assert.fail('閉じ括弧が見つからない: ' + head);
}
/** CSS の `<style>` 全体 */
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
/** `sel` から始まるルールの中身(`{ }` の中) */
const cssOf = sel => {
  const i = css.indexOf(sel);
  assert.ok(i >= 0, `CSS が無い: ${sel}`);
  const a = css.indexOf('{', i), b = css.indexOf('}', a);
  return css.slice(a + 1, b);
};
const colorOf = body => (body.match(/color:\s*(#[0-9a-fA-F]{6})/) || [])[1];
/** WCAG の相対輝度 */
const lum = hex => {
  const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(x => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

test('U7-1 見かけの位置は路線図ごとに覚え、読めない値は捨てられる', () => {
  globalThis.localStorage = makeStorage();
  // 2つの路線図それぞれに覚える
  saveMapView('m1', 2, 10, 20);
  saveMapView('m2', 1.5, 0, 300);
  assert.deepEqual(mapView('m1'), { z: 2, l: 10, t: 20 });
  assert.deepEqual(mapView('m2'), { z: 1.5, l: 0, t: 300 });

  // 同じ値なら書かない(スクロールのたびに書き込まないため)
  const w = globalThis.localStorage.writes.filter(k => k === KEYS.view).length;
  saveMapView('m1', 2, 10, 20);
  assert.equal(globalThis.localStorage.writes.filter(k => k === KEYS.view).length, w, '同じ値を書き直した');

  // 数値でない位置は渡さない
  saveMapView('m1', NaN, 1, 2);
  saveMapView('', 2, 1, 1);
  assert.equal(globalThis.localStorage.writes.filter(k => k === KEYS.view).length, w, '壊れた値を書いた');

  // 覚えが無い路線図 / 壊れた値 / 壊れた JSON
  assert.equal(mapView('m9'), null);
  assert.equal(mapView(''), null);
  const raw = globalThis.localStorage.getItem(KEYS.view);   // ここまでの記憶(試験後に戻す)

  globalThis.localStorage.setItem(KEYS.view, JSON.stringify({ m3: { z: 'x', l: 1, t: 2 } }));
  assert.equal(mapView('m3'), null, '数値でないズームを採用した');

  globalThis.localStorage.setItem(KEYS.view, '{壊れたJSON');
  assert.equal(mapView('m1'), null, '壊れたJSONで例外か偽の値になる');
  saveMapView('m1', 3, 4, 5);                       // 壊れていても次からは書き直せる
  assert.deepEqual(mapView('m1'), { z: 3, l: 4, t: 5 });

  // 試験で入れた壊れた値を元に戻す(2つ目の路線図の記憶を試験で消さないため)
  globalThis.localStorage.setItem(KEYS.view, raw);
  assert.deepEqual(mapView('m1'), { z: 2, l: 10, t: 20 }, '元の記憶が戻らない');
  assert.deepEqual(mapView('m2'), { z: 1.5, l: 0, t: 300 }, '別の路線図の記憶が消えている');

  // 消した路線図の位置は消す(残ると消した図が原因でファイルが育ち続ける)
  forgetMapView('m1');
  assert.equal(mapView('m1'), null, '消した路線図の位置が残っている');
  assert.deepEqual(mapView('m2'), { z: 1.5, l: 0, t: 300 }, '別の路線図の位置まで消した');

  // キーは S3 の名前空間の下。**この関数が書くのは view のだけ** =
  // 路線図(文書)側のキーに足らない = 書き出しの JSON が変わらない(S3 の DoD と同じ考え方)
  assert.equal(KEYS.view, NS + 'view');
  assert.equal(NS, 'train-map:v1:');
  assert.ok(!Object.values(LEGACY).includes(KEYS.view), 'view に旧キーがある');
  const written = globalThis.localStorage.writes;
  assert.ok(written.length > 0, '何にも書いていない(テストが働いていない)');
  assert.ok(written.every(k => k === KEYS.view), `view 以外にも書いた: ${[...new Set(written)]}`);

  globalThis.localStorage = makeStorage();
});

test('U7-2 位置は路線図の切り替わりで戻し、変えたときに覚える', () => {
  // --- どの路線図の位置を戻したかを覚えて、切り替わった最初の描画でだけ戻す
  assert.match(canvasSrc, /import \{ mapView, saveMapView \} from '\.\/storage\.js'/, '位置の読み書きを import していない');
  const rb = bodyOf(canvasSrc, 'export function renderCanvas()');
  const restoreAt = rb.indexOf('if (viewMapId !== ui.map)');
  assert.ok(restoreAt >= 0, '路線図の切り替わりを確かめていない');
  assert.match(rb, /viewMapId = ui\.map;/, '戻した路線図を記録していない(毎回戻す/2回目から戻らない)');
  assert.match(rb, /ui\.zoom = v \? clamp\(v\.z, 0\.25, 3\) : 1;/,
    'ズームが戻るか既定(100%)に戻らない。範囲は setZoom と同じ 0.25〜3');
  assert.match(rb, /st\.scrollLeft = v \? v\.l : 0; st\.scrollTop = v \? v\.t : 0;/,
    'スクロール位置が戻らない');
  assert.ok(restoreAt < rb.indexOf('applyZoom()'), 'applyZoom より後で戻している(ズームが反映されない)');

  // --- 変えたら覚える。スクロールは連続で来るので少し置いて1回にまとめる
  const zb = bodyOf(canvasSrc, 'export function setZoom(z, cx, cy)');
  assert.match(zb, /saveMapView\(ui\.map, ui\.zoom, stage\.scrollLeft, stage\.scrollTop\)/, 'ズーム変更が保存されない');
  assert.match(canvasSrc, /stage\.addEventListener\('scroll'/, 'スクロールを覚えていない');
  assert.match(canvasSrc, /setTimeout\(saveViewNow, 300\)/, 'スクロールの保存をまとめていない');
  assert.match(canvasSrc, /window\.addEventListener\('pagehide', saveViewNow\)/, '閉じる直前に覚えていない');
  // 一覧画面のあいだは覚えない(キャンバスが隠れている間は位置を読めず、ズームも前の地図のまま)
  const svn = bodyOf(canvasSrc, 'const saveViewNow = () =>');
  assert.match(svn, /if \(ui\.home\) return;/, '一覧画面のまま閉じると、別の地図のズームと 0 で位置を上書きする');

  // --- 消した路線図は位置も消し、取り消しで元の位置に戻す
  const db = bodyOf(tabsSrc, 'export function deleteMap(id)');
  assert.match(db, /const view = mapView\(id\)/, '消す前の位置を覚えていない');
  assert.match(db, /forgetMapView\(id\)/, '消した路線図の位置を消していない');
  const rb2 = bodyOf(tabsSrc, 'function restoreDeleted()');
  assert.match(rb2, /saveMapView\(t\.map\.id, t\.view\.z, t\.view\.l, t\.view\.t\)/,
    '取り消しで位置が戻らない');
});

test('U7-3 ヘッダーに「保存中… / 保存済み / 保存に失敗」が出る', () => {
  // --- 場所: ツールバーの右側(「?」の一覧の手前)。初期表示は「保存済み ✓」
  const toolsAt = html.indexOf('<div id="tools"');
  const indAt = html.indexOf('id="saveind"');
  const helpAt = html.indexOf('id="keyshelp"');
  assert.ok(toolsAt >= 0 && indAt > toolsAt && helpAt > indAt, '保存表示がツールバーに無い/場所が違う');
  assert.match(html, /<span id="saveind" data-state="saved"[^>]*>保存済み ✓<\/span>/, '初期表示が違う');
  assert.ok(/<div id="tools"/.test(html), 'ツールバーが無い');
  // 失敗の読み上げは S5 のバナーが担うので、ここは live region にしない(保存のたびに読み上げるため邪魔)
  assert.ok(!/<span id="saveind"[^>]*aria-live|<span id="saveind"[^>]*role=/.test(html),
    '保存表示が読み上げ領域になっている');

  // --- 3つの状態と、切り替わる場所
  assert.match(uisrc, /const SAVE_IND = \{ saving: '保存中…', saved: '保存済み ✓', failed: '保存に失敗' \};/,
    '3つの表示が揃っていない');
  assert.match(bodyOf(uisrc, 'export const deferSave = () =>'), /setSavePending\(true\)/,
    '保留中(まだ保存していない)のに「保存中…」が出ない');
  assert.match(bodyOf(uisrc, 'export const save = (changedId) =>'), /setSavePending\(false\)/,
    '保存しても「保存済み」に戻らない');
  assert.match(bodyOf(uisrc, 'export function setSaveFailed(on)'), /renderSaveInd\(\)/,
    '保存の失敗が表示に反映されない(S5 とつながらない)');
  assert.match(bodyOf(uisrc, 'function renderSaveInd()'),
    /saveFailed \? 'failed' : savePending \? 'saving' : 'saved'/,
    '失敗より保留の状態を優先している(失敗が隠れる)');
  // 指示書の英語ラベルをそのまま出さない(画面は日本語のまま = i18n を入れない)
  for (const s of ['Saved ✓', 'Saving…', 'Save failed']) {
    assert.ok(uisrc.indexOf(s) < 0 && html.indexOf(s) < 0, `英語ラベルが画面に入っている: ${s}`);
  }

  // --- 3色とも背景(#paper)上で AA(4.5:1)に届く(U4 のコントラスト確認と同じ基準)
  const paper = (css.match(/--paper:\s*(#[0-9a-fA-F]{6})/) || [])[1];
  assert.ok(paper, '--paper の色が読めない');
  const states = [
    ['既定(保存済み)', colorOf(cssOf('#saveind'))],
    ['保存中', colorOf(cssOf('#saveind[data-state="saving"]'))],
    ['保存に失敗', colorOf(cssOf('#saveind[data-state="failed"]'))]
  ];
  for (const [name, c] of states) {
    assert.ok(c, `${name} の色が無い`);
    const r = ratio(c, paper);
    assert.ok(r >= 4.5, `${name}(${c})のコントラストが ${r.toFixed(2)}:1 で 4.5:1 未満`);
  }
});

test('U7-4 動きを減らす設定に従う(ダークテーマは足さない)', () => {
  const i = css.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(i >= 0, 'prefers-reduced-motion の指定が無い');
  const body = cssOf('@media (prefers-reduced-motion: reduce)');
  // 対象: アコーディオンの矢印 + クイック操作パネルのスイッチのトラックとつまみ
  for (const sel of ['.seci', '#quick .qsw .track', '#quick .qsw .track::after']) {
    assert.ok(body.indexOf(sel) >= 0, `動きを止める対象に無い: ${sel}`);
  }
  assert.match(body, /transition:\s*none/, '動きを止めていない');
  // その対象にはもともと transition がある(無ければこの指定自体が意味を持たない)
  assert.match(cssOf('#quick .qsw .track'), /transition:background/, 'スイッチのトラックに動きが無い');
  assert.match(cssOf('#quick .qsw .track::after'), /transition:transform/, 'スイッチのつまみに動きが無い');
  assert.match(cssOf('.seci'), /transition:transform/, 'アコーディオンの矢印に動きが無い');
  // 指示書で禁じられているダークテーマを足さない
  assert.ok(css.indexOf('prefers-color-scheme') < 0 && html.indexOf('prefers-color-scheme') < 0,
    'ダークテーマが入っている');
});

test('U7-5 サイドバー幅は S3 の名前空間とクランプのまま動く', () => {
  // キーは絶対に書かない(画面は storage.js の定数だけを使う)
  assert.match(rsrc, /const PWKEY = KEYS\.panelw/, 'サイドバー幅が名前空間つきキーを使っていない');
  assert.match(rsrc, /localStorage\.getItem\(PWKEY\)/, '生のキー名で読んでいる');
  assert.ok(!/localStorage\.(get|set)Item\('panelw'/.test(rsrc), "生のキー名 'panelw' を使っている");
  assert.match(storeSrc, /for \(const k of \['open', 'acc', 'panelw'\]\)/,
    '旧キーからの移行にサイドバー幅が含まれていない');

  // 幅は必ず範囲に丸める(壊れた値・極端な値が来ても画面が壊れない)
  const range = rsrc.match(/const PWRANGE = \{ left: \[(\d+), (\d+)\], right: \[(\d+), (\d+)\] \};/);
  assert.ok(range, '幅の範囲(PWRANGE)が無い');
  const fix = bodyOf(rsrc, 'const fix = s =>');
  assert.match(fix, /Math\.max\(PWRANGE\[s\]\[0\], Math\.min\(PWRANGE\[s\]\[1\], n\)\)/,
    '読むときの丸めが無い');
  const eff = bodyOf(rsrc, 'function effWidths()');
  assert.match(eff, /Math\.max\(r\[0\], Math\.min\(r\[1\]/, '表示時の丸めが無い');
  // キーボード操作(←/→・Home/End・Enter)の実装は S3/U3 のまま変えていない
  assert.match(rsrc, /e\.key === 'Home'/, 'ハンドルの Home が消えている');
  assert.match(rsrc, /e\.key === 'End'/, 'ハンドルの End が消えている');
  assert.match(rsrc, /e\.key === 'Enter'/, 'ハンドルの Enter が消えている');
  assert.ok(+range[3] >= 220 && +range[4] <= 560, '右サイドバーの範囲が変わっている');
});
