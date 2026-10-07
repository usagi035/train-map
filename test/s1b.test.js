/* =============================================================================
   S1b(出口側の縦の防御)の受入テスト。

   ui-state.js は画面側の入口なので、起動時に触る `location` / `localStorage`
   だけ用意してから読む(依存パッケージ・jsdom は使わない)。
   ========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.location = { hash: '' };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { col, num, idf, esc } = await import('../src/renderer/ui-state.js');

const EVIL_ID = 'a" onclick="alert(1)';
const EVIL_COL = 'red" onload="alert(1)';

test('S1b-1 色は #rrggbb でなければ黒に落ちる(col)', () => {
  assert.equal(col('#E5352B'), '#E5352B', '6桁の色はそのまま');
  assert.equal(col('#1e7bc4'), '#1e7bc4', '小文字の6桁もそのまま');
  assert.equal(col('#fff'), '#000000', '3桁は黒');
  assert.equal(col(EVIL_COL), '#000000', '注入らしき文字列は黒');
  assert.equal(col('red'), '#000000', '色名は黒');
  assert.equal(col(''), '#000000', '空は黒');
  assert.equal(col(undefined), '#000000', '無いものは黒');
  assert.match(col('#E5352B'), /^#[0-9a-fA-F]{6}$/);
});

test('S1b-2 数値でない値は 0 に落ちる(num。文字列は数値化しない)', () => {
  assert.equal(num(12.5), 12.5);
  assert.equal(num(0), 0);
  assert.equal(num('5'), 0, '数字の文字列も数値とみなさない');
  assert.equal(num('1" onload="alert(1)'), 0);
  assert.equal(num(NaN), 0);
  assert.equal(num(Infinity), 0);
  assert.equal(num(null), 0);
  assert.equal(num(undefined), 0);
  assert.equal(num(true), 0);
});

test('S1b-3 ID は規則外なら空文字になる(idf)', () => {
  assert.equal(idf('m1'), 'm1');
  assert.equal(idf('a-b_C-1'), 'a-b_C-1');
  assert.equal(idf(EVIL_ID), '');
  assert.equal(idf('駅1'), '');
  assert.equal(idf('x y'), '');
  assert.equal(idf('x'.repeat(65)), '', '64文字を超えるものは駄目');
  assert.equal(idf(''), '');
  assert.equal(idf(undefined), '');
  assert.equal(idf('#000000'), '');
});

test('S1b-4 esc は HTML の特殊文字を必ずエスケープする', () => {
  assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(esc('a&b"c\'d'), 'a&amp;b&quot;c&#39;d');
});

/* データを入れる属性は、必ず idf() を経由していること(将来の書き足しを止める) */
test('S1b-5 画面のテンプレートはID属性を idf() 経由で埋めている', () => {
  const files = ['canvas.js', 'side-panel.js', 'left-panel.js', 'tabs.js'];
  const re = /data-(?:id|lid|rid|iid|open|del|x|l)="\$\{([^}]*)\}/g;
  let checked = 0;
  for (const f of files) {
    const src = readFileSync(new URL(`../src/renderer/${f}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(re)) {
      checked++;
      assert.match(m[1], /^\s*idf\(/, `${f} の \`${m[0]}\` は idf() を経由していない`);
    }
  }
  assert.ok(checked >= 15, `確認したID属性が少なすぎます(${checked}件)`);
});

/* 色・数値も入っている場所が col()/num() 経由であることの機械的な確認。
   「データ変数をそのまま埋めている行」が無いことを、ファイル単位で確かめる。 */
test('S1b-6 色と数値のデータ変数は col()/num() 経由で埋められている', () => {
  const read = f => readFileSync(new URL(`../src/renderer/${f}`, import.meta.url), 'utf8');
  const canvas = read('canvas.js'), side = read('side-panel.js'), left = read('left-panel.js');
  // キャンバス: 背景・路線・道路・駅・バス停の色
  assert.match(canvas, /bg = col\(m\.bg \|\| BG\)/, '背景色は col 経由');
  assert.match(canvas, /c = col\(s\.color \|\|/, '駅の色は col 経由');
  assert.match(canvas, /stroke="\$\{col\(r\.color\)\}"/, '道路の色は col 経由');
  assert.match(canvas, /stroke="\$\{col\(l\.color\)\}"/, '路線の色は col 経由');
  // キャンバス: 数値(太さ・座標・頂点)
  assert.match(canvas, /stroke-width="\$\{num\(r\.width\)\}"/, '道路の太さは num 経由');
  assert.match(canvas, /stroke-width="\$\{num\(lw\(l\)\)\}"/, '路線の太さは num 経由');
  assert.match(canvas, /num\(p\.x\) \+ ',' \+ num\(p\.y\)/, '頂点は num 経由');
  // 右パネル: color input の value は col 経由
  assert.match(side, /id="lcolor" value="\$\{col\(l\.color\)\}"/, '路線の色は col 経由');
  assert.match(side, /id="rcolor" value="\$\{col\(r\.color\)\}"/, '道路の色は col 経由');
  assert.match(side, /id="bfill" value="\$\{col\(b\.fill\)\}"/, 'ラベル枠の色は col 経由');
  assert.match(side, /id="mbg" value="' \+ col\(m\.bg \|\| BG\)/, '背景色は col 経由');
  // 左パネル: 路線の色バッジ
  assert.match(left, /background:\$\{col\(l\.color\)\}/, '路線の色バッジは col 経由');
  // データ変数をそのまま埋めている行(=防御をすり抜けている行)が残っていないこと
  for (const f of ['canvas.js', 'side-panel.js', 'left-panel.js', 'tabs.js']) {
    const src = read(f);
    for (const line of src.split('\n')) {
      assert.doesNotMatch(line, /(?:stroke|fill|background)="\$\{(?!col\(|fg|BAND_COLOR|tc|bg|sub|c\b)/,
        `${f} に col() を通していない色の埋め込みがあります: ${line.trim().slice(0, 90)}`);
    }
  }
});
