/* =============================================================================
   U2(通常の連絡を alert()/confirm() から出し続けない)のテスト。
   - 「画面を止める呼出が無いこと」と「代わりの知らせが要件を満たすこと」は
     配線の問題なので、まずソースを直接確かめる。
   - `restoreMap()` は core の純関数なので、実際に呼び出して振る舞いを確かめる。
   =========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createCore } from '../src/core/operations.js';

const src = new URL('../src/', import.meta.url);
const files = readdirSync(src, { recursive: true })
  .map(f => String(f).replace(/\\/g, '/'))
  .filter(f => f.endsWith('.js'))
  .map(f => ({ f, text: readFileSync(new URL(f, src), 'utf8') }));

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const toastSrc = read('src/renderer/toast.js');
const rsrc = read('src/renderer/renderer.js');
const uisrc = read('src/renderer/ui-state.js');
const tsrc = read('src/renderer/tabs.js');
const spsrc = read('src/renderer/side-panel.js');
const opsrc = read('src/core/operations.js');

test('U2-1 画面を止める alert()/confirm() がどこにも呼ばれていない', () => {
  const bad = [];
  for (const { f, text } of files) {
    text.split(/\r?\n/).forEach((line, i) => {
      const t = line.trim();
      if (/^(\/\/|\/\*|\*|-|注)/.test(t)) return;          // コメント中の言及は対象外
      if (/\b(alert|confirm)\s*\(/.test(line)) bad.push(`${f}:${i + 1} ${t.slice(0, 60)}`);
    });
  }
  assert.deepEqual(bad, [], `alert/confirm の呼び出しが残っている:\n${bad.join('\n')}`);
});

test('U2-2 トーストは自動で消え、読み上げ対象で、インラインを持たない', () => {
  assert.match(toastSrc, /setAttribute\('role', 'status'\)/, 'role=status が無い');
  assert.match(toastSrc, /setAttribute\('aria-live', 'polite'\)/, 'aria-live=polite が無い');
  assert.match(toastSrc, /setTimeout\(\(\) => dismiss\(item\), ms\)/, '自動で消えない');
  assert.match(toastSrc, /const ms = opts\.ms == null \? 5000 : opts\.ms;/, '既定の表示時間(約5秒)が無い');
  assert.match(toastSrc, /textContent = text/, '文字を textContent で入れていない');
  assert.match(toastSrc, /addEventListener\('click'/, 'ボタンを addEventListener で繋いでいない');
  assert.ok(!/innerHTML\s*=|on(?:click|load|error)\s*=/.test(toastSrc), 'innerHTML / インラインハンドラを使っている');
  assert.match(toastSrc, /opts\.actions/, '対応ボタン(任意)が作れない');
  assert.match(toastSrc, /live\.find\(t => t\.key === key\)/, '同じ知らせを1枚にまとめられない');
});

test('U2-3 restoreMap は削除した路線図を同じ位置へ戻し、代わりに作った空図は外す', () => {
  const core = createCore();
  core.replace({ maps: [] });
  const a = core.addMap('取り消す側');
  const b = core.addMap('残す側');
  const idx = core.getState().maps.indexOf(a);
  assert.equal(core.deleteMap(a.id), null, '残る路線図があるので代わりの路線図は作られない');
  assert.ok(!core.getState().maps.some(m => m.id === a.id), '削除できていない');

  const copy = JSON.parse(JSON.stringify(a));
  assert.equal(core.restoreMap(copy, idx, null), true, '取り消しが失敗した');
  assert.equal(core.getState().maps.indexOf(copy), idx, '元の位置に戻っていない');
  assert.ok(core.getState().maps.some(m => m.id === b.id), '別の路線図を消してしまった');

  // 最後の1つを消したときは代わりに空の路線図が作られる → 取り消しで一緒に外す
  core.deleteMap(b.id);
  const spareId = core.deleteMap(copy.id);   // これが最後の1つ
  assert.ok(spareId, '最後を消したので代わりの路線図が作られる');
  assert.equal(core.restoreMap(copy, 0, spareId), true, '取り消しが失敗した');
  assert.equal(core.getState().maps.length, 1, '代わりに作った空の路線図が残っている');
  assert.equal(core.getState().maps[0].id, copy.id, '取り消した路線図が入っていない');

  // 代わりの路線図に手が入っていたら消さない(入力中の作業を捨てない)
  core.deleteMap(copy.id);
  const edited = core.getState().maps[0];
  core.update(edited, { name: '作業中' });
  assert.equal(core.restoreMap(copy, 0, edited.id), true, '取り消しが失敗した');
  assert.equal(core.getState().maps.length, 2, '手を入れた路線図まで消えてしまった');
});

test('U2-4 知らせの内容: ロックはその場で解除でき、削除は取り消せ、取り込みは件数を出す', () => {
  // ロック中・非表示 → 理由 + その場で直すボタン
  assert.match(uisrc, /label: 'ロックを解除'/, 'ロック解除のボタンが無い');
  assert.match(uisrc, /label: '表示に戻す'/, '表示に戻すボタンが無い');
  assert.match(rsrc, /label: locked \? 'ロックを解除' : '表示に戻す'/, '踏切の案内にボタンが無い');
  // 路線図の削除 → 取り消し(8秒)
  assert.match(tsrc, /ms: 8000/, '取り消せる時間(約8秒)が無い');
  assert.match(tsrc, /label: '取り消し'/, '取り消しボタンが無い');
  assert.match(tsrc, /core\.restoreMap\(/, '取り消しが core を経由していない');
  assert.ok(!/confirm\(/.test(tsrc), '削除に confirm が残っている');
  assert.ok(!/confirm\(/.test(spsrc), '削除に confirm が残っている');
  // 取り込み → 成功の件数と、失敗の理由を分けて出す
  assert.match(rsrc, /件の項目を補正しました/, '補正件数を出していない');
  assert.match(rsrc, /取り込みました。/, '成功の知らせが無い');
  assert.match(rsrc, /このファイルはJSONではありません/, 'JSONとして読めない失敗を区別していない');
  assert.match(rsrc, /路線図のデータではありません/, '形式が違う失敗を区別していない');
  assert.ok(!/読み込めませんでした。書き出したJSONファイルを選んでください。/.test(rsrc),
    '一括りの失敗メッセージが残っている');
  // 画像の失敗も理由別(型・サイズ・解像度・読めない)
  for (const k of ['SVG画像は取り込めません', '上限15MB', '上限5000万画素', '画像として読めませんでした']) {
    assert.ok(rsrc.includes(k), `画像の失敗理由「${k}」が無い`);
  }
});
