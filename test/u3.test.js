/* =============================================================================
   U3(ツールバーの整理)のテスト。
   - グループの並びと区切りは見た目の決まりなので、`index.html` の `#tools` を
     上から順に確認する。
   - `aria-pressed` は「いま押しているモード」の同期が肝なのでソースで確かめる。
   =========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const uisrc = readFileSync(new URL('../src/renderer/ui-state.js', import.meta.url), 'utf8');
const rsrc = readFileSync(new URL('../src/renderer/renderer.js', import.meta.url), 'utf8');

/** `from` 以降で順に見つかること(見つからなければその文字列を返す) */
const seq = (arr, from = 0) => {
  let i = from;
  for (const s of arr) {
    const j = html.indexOf(s, i);
    if (j < 0) return `${s} が見つからない`;
    i = j + s.length;
  }
  return null;
};

test('U3-1 ツールバーは指示どおりのグループと順序(区切り付き)', () => {
  assert.equal(seq([
    'data-tool="select"', 'class="sep"',                                     // [選択]
    'data-tool="station"', 'data-tool="hub"', 'data-tool="crossing"',
    'data-tool="busstop"', 'data-tool="terminal"', 'data-tool="road"',
    'data-tool="box"', 'id="addimg"', 'class="sep"',                         // [追加]
    'id="del"', 'id="undo"', 'id="redo"', 'class="sp"',                      // [削除・履歴] + 余白
    'id="zout"', 'id="zin"', 'id="zreset"', 'class="sep"',                   // [ズーム]
    'id="exp"', 'id="imp"', 'id="expimg"', 'class="sep"',                    // [書き出し系]
    'id="keyshelp"', 'id="keyspop"',
  ]), null, 'グループの並びまたは区切りが違う');
  const seps = html.match(/class="sep"/g) || [];
  assert.ok(seps.length >= 3, `区切りが足りない(${seps.length}個)`);
  assert.ok((html.match(/class="sp"/g) || []).length >= 1, 'グループ間の余白が無い');
});

test('U3-2 モードのボタンは aria-pressed で「押している」を表す', () => {
  assert.match(uisrc, /b\.setAttribute\('aria-pressed', on \? 'true' : 'false'\)/, 'aria-pressed を付けていない');
  assert.match(uisrc, /document\.querySelectorAll\('\[data-tool\]'\)\.forEach/, '全ツールボタンを対象にしていない');
  // モード切替は renderTools を通る(勝手に同期する経路が無いこと)
  assert.match(rsrc, /renderTools\(\)/, 'renderTools が呼ばれていない');
});

test('U3-3 ショートカットを持つボタンは title にそれを書く', () => {
  const tools = html.match(/<button data-tool="[^"]+"[^>]*>/g) || [];
  assert.equal(tools.length, 8, `ツールボタンが ${tools.length} 個(8個のはず)`);
  for (const t of tools) assert.match(t, /title="/, `title 無し: ${t}`);
  const checks = [
    [/id="del"[^>]*title="[^"]*Delete \/ Backspace/, '削除の Delete/Backspace'],
    [/id="undo"[^>]*title="[^"]*Ctrl\+Z/, '元に戻すの Ctrl+Z'],
    [/id="redo"[^>]*title="[^"]*Ctrl\+Y/, 'やり直すの Ctrl+Y'],
    [/data-tool="road"[^>]*title="[^"]*Enter \/ ダブルクリック/, '道路の確定方法'],
    [/id="zin"[^>]*title="[^"]*Ctrl\+ホイール/, 'ズームの Ctrl+ホイール'],
    [/id="zout"[^>]*title="[^"]*Ctrl\+ホイール/, '縮小の Ctrl+ホイール'],
    [/data-tool="select"[^>]*title="[^"]*Esc/, 'Esc で選択ツールへ'],
  ];
  for (const [re, msg] of checks) assert.match(html, re, `title に書かれていない: ${msg}`);
});

test('U3-4 「?」でショートカット一覧が開き、閉じる経路もある', () => {
  assert.match(html, /id="keyshelp"[^>]*aria-expanded="false"[^>]*aria-controls="keyspop"/, '? ボタンの aria が無い');
  assert.match(html, /<div id="keyspop" hidden>/, '一覧の本体が無い(初期は閉じている)');
  // 指示書が名指しした4つ + 矢印は必ず載っている
  for (const k of ['Delete / Backspace', 'Esc', 'Enter', 'Space + ドラッグ', '← / →']) {
    assert.ok(html.includes(k), `一覧に「${k}」が無い`);
  }
  // 開いたままにしない(Esc / 場所のクリック)
  assert.match(rsrc, /keyshelp\.addEventListener\('click'/, '? の開閉が無い');
  assert.match(rsrc, /e\.key === 'Escape' && !keyspop\.hidden/, 'Esc で閉じない');
  assert.match(rsrc, /!keyspop\.contains\(e\.target\)/, '場所を押しても閉じない');
  assert.match(rsrc, /setAttribute\('aria-expanded', on \? 'true' : 'false'\)/, '開閉を aria に反映していない');
});
