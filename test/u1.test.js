/* =============================================================================
   U1(タッチ / ペン操作)のテスト。
   - 「ポインタイベントに置き換わったか」「タッチで誤爆しない挙動(タップ待ちと
     2本目の到来で取り消す)」「2本指でズーム/パン」は、どの要素がどの順で
     動くかが命なので、ソースの配線を直接確かめる。
   - タッチターゲット(44単位の当たり判定)は canvas.js の生成文字列で確かめる。
   =========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rsrc = readFileSync(new URL('../src/renderer/renderer.js', import.meta.url), 'utf8');
const csrc = readFileSync(new URL('../src/renderer/canvas.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('U1-1 入力は全部ポインタイベント(マウス専用の登録が残っていない)', () => {
  assert.ok(!/addEventListener\('mouse|\.onmouse/.test(rsrc), 'mouse 系のイベント登録が残っている');
  assert.match(rsrc, /cv\.addEventListener\('pointerdown'/, 'キャンバスが pointerdown でない');
  assert.match(rsrc, /window\.addEventListener\('pointerup'/, '離しが pointerup でない');
  assert.match(rsrc, /window\.addEventListener\('pointercancel'/, 'ブラウザの取り消し(pointercancel)を受けていない');
  assert.ok((rsrc.match(/setPointerCapture/g) || []).length >= 2, 'ドラッグで setPointerCapture していない');
  // タッチでブラウザがスクロール/ピンチを奪わないようにする
  assert.match(html, /#cv\s*\{[^}]*touch-action:\s*none/, '#cv に touch-action:none が無い');
});

test('U1-2 2本指 = 開いた距離でズーム・中点の移動でパン(既存の処理を再利用)', () => {
  assert.match(rsrc, /function beginPinch\(\)/, 'ピンチ開始の処理が無い');
  assert.match(rsrc, /function movePinch\(\)/, 'ピンチ移動の処理が無い');
  // ズームは新規実装せず setZoom を使う(マウスの Ctrl+ホイールと同じ)
  assert.match(rsrc, /setZoom\(pinch\.z0 \* \(d \/ pinch\.d\), /, 'ズームが setZoom を使っていない');
  // パンは Space+ドラッグと同じ scrollLeft/scrollTop 操作
  assert.match(rsrc, /stage\.scrollLeft = pinch\.sl - \(\(a\.x \+ b\.x\) \/ 2 - pinch\.cx\);/, 'パンが scroll 操作でない');
  // 2本目が来たら、進行中のドラッグを確定して止める(ズームと誤爆しない)
  assert.match(rsrc, /if \(band\) finishBand\(\);\s*\r?\n\s*if \(drag\) \{ drag = null; save\(\); \}/,
    '2本目の到来で既存の操作を止めていない');
});

test('U1-3 タッチの追加は「動かずに離した(タップ)」だけ。マウスは従来どおり即時', () => {
  assert.match(rsrc, /function actAt\(e, fn\)/, '追加行動の置き場所が無い');
  assert.match(rsrc, /if \(e\.pointerType === 'mouse'\) \{ fn\(\); return; \}/, 'マウスが即時実行でない');
  // 追加する系のツールは全部 actAt 経由(押した瞬間には増やさない)
  for (const k of ['addStation', 'addHubStation', 'addCrossing', 'addBusStop', 'addRoadPoint', 'addBox']) {
    assert.match(rsrc, new RegExp(`actAt\\(e, \\(\\) =>[\\s\\S]{0,160}${k}`), `${k} が actAt 経由でない`);
  }
  // 動いた指・取り消された指では実行しない
  assert.match(rsrc, /pendingAct\.moved = true/, '移動量を見ている');
  assert.match(rsrc, /if \(a && !a\.moved && /, 'タップ判定が無い');
  assert.match(rsrc, /runTap\)/, 'pointercancel でタップを止める分岐が無い');
  // 2本目が来たら保留中の追加を取り消す
  assert.match(rsrc, /pendingAct = null;\s*\r?\n\s*const \[a, b\]/, 'ピンチ開始時に追加を取り消していない');
});

test('U1-4 リサイズハンドルは目立たない広い当たり判定(44単位・透過)を持つ', () => {
  for (const t of ['imgr', 'bxr']) {
    const wide = csrc.match(new RegExp(`data-t="${t}"[^>]*width="44" height="44" fill="transparent" pointer-events="all"`, 'g')) || [];
    assert.ok(wide.length >= 1, `${t}: 44単位の当たり判定が無い`);
    const small = csrc.match(new RegExp(`data-t="${t}"[^>]*width="12" height="12"`, 'g')) || [];
    assert.ok(small.length >= 1, `${t}: 見えているハンドル(12)が消えている`);
  }
});
