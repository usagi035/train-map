/* =============================================================================
   U4(キーボードと支援技術からの操作)のテスト。
   - DOM を使わない `node --test` のため、見た目は「index.html の記述」と
     「CSS の値から実際にコントラスト比を計算する」で確かめる。
   - 矢印キーの移動は「状態を書き換えるのは core 経由だけ」が肝なので、
     nudge() の中身を取り出して直接代入が無いことを確認する。
   =========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const rsrc = readFileSync(new URL('../src/renderer/renderer.js', import.meta.url), 'utf8');
const uisrc = readFileSync(new URL('../src/renderer/ui-state.js', import.meta.url), 'utf8');
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

/** 指定セレクタのルールの中身(`{ }` の中)を返す */
const decl = sel => {
  const i = css.indexOf(sel);
  assert.ok(i >= 0, `CSS が見つからない: ${sel}`);
  const a = css.indexOf('{', i), b = css.indexOf('}', a);
  return css.slice(a + 1, b);
};
/** `function name(` から次の行頭 `}` まで(= 関数の中身)を取り出す */
const bodyOf = (src, sig) => {
  const i = src.indexOf(sig);
  assert.ok(i >= 0, `見つからない: ${sig}`);
  const j = src.indexOf('\n}', i);
  return src.slice(i, j < 0 ? src.length : j);
};
const val = (d, name) => {
  const m = new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+)`).exec(d);
  return m ? m[1].trim() : null;
};
/* ---------- コントラスト比の計算(WCAG 定義どおり) ---------- */
const hex2rgb = s => {
  const h = (s.length === 4 ? '#' + [...s.slice(1)].map(c => c + c).join('') : s).toLowerCase();
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lum = s => {
  const c = hex2rgb(s).map(v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** CSS のアルファ合成と同じ(sRGB でブレンド) */
const blend = (fg, bg, a) => '#' + hex2rgb(fg)
  .map((v, i) => Math.round(v * a + hex2rgb(bg)[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
const ink = /--ink:(#[0-9a-fA-F]{3,6})/.exec(css)[1];
const white = '#ffffff';

test('U4-1 キャンバスは読み上げ対象で、隠れた読み上げ領域がある', () => {
  const cvtag = /<svg id="cv"[^>]*>/.exec(html);
  assert.ok(cvtag, '#cv が無い');
  assert.match(cvtag[0], /role="application"/, '#cv に role が無い');
  assert.match(cvtag[0], /tabindex="0"/, '#cv をフォーカスできない(tabindex 無し)');
  assert.match(cvtag[0], /aria-label="[^"]+"/, '#cv に aria-label が無い');
  // ライブリージョンは本文の最初に置いて、追加された通知を聞き逃さない
  const live = /<div id="live"[^>]*>/.exec(html);
  assert.ok(live, '#live が無い');
  assert.match(live[0], /class="vh"/, '読み上げ領域が視覚的に隠れていない');
  assert.match(live[0], /role="status"[^>]*aria-live="polite"|aria-live="polite"[^>]*role="status"/, 'aria-live が無い');
  assert.ok(html.indexOf('id="live"') < html.indexOf('<header>'), '#live が本文の先頭に無い');
  const vh = decl('.vh {');
  assert.match(vh, /width:1px/, '.vh が1px になっていない');
  assert.match(vh, /clip-path|clip:/, '.vh が切り抜かれていない');
  // クリックでフォーカスして、そのあとの矢印キーを受け取る
  assert.match(rsrc, /cv\.focus\(\{ preventScroll: true \}\)/, 'キャンバスをフォーカスしていない');
});

test('U4-2 選択とツールの変化を読み上げ領域へ流す', () => {
  assert.match(uisrc, /export function announce\(text\)/, 'announce が無い');
  assert.match(uisrc, /el\.textContent = text/, '読み上げは textContent で(setHTML ではなく)');
  assert.match(uisrc, /if \(!text \|\| text === said\) return;/, '同じ文言を繰り返し読み上げてしまう');
  assert.match(uisrc, /export function announceStatus\(\)/, 'announceStatus が無い');
  // ツール名と選択状態の両方を渡す
  assert.match(uisrc, /document\.querySelector\('\[data-tool="' \+ ui\.tool \+ '"\]'\)/, 'ツール名を拾っていない');
  assert.match(uisrc, /export function selLabel\(sel\)/, '選択を言葉にしない');
  assert.match(uisrc, /getBulk\(\)\.length/, '□選択の件数を読み上げていない');
  // renderTools のたびに流れる(ツール切替は renderTools、選択は renderAll → renderTools)
  assert.match(bodyOf(uisrc, 'export function renderTools()'), /announceStatus\(\);/, 'renderTools から呼ばれていない');
});

test('U4-3 矢印キーは core の操作だけを使ってステップ移動する', () => {
  assert.match(rsrc, /const stepOf = e => \(snapOn\(\) \? G : 1\) \* \(e\.shiftKey \? 5 : 1\);/,
    'ステップが「グリッドON=1マス/ OFF=1単位/ Shift×5」になっていない');
  const keys = bodyOf(rsrc, "if (e.key === 'ArrowLeft'");
  assert.match(keys, /ArrowLeft' \|\| e\.key === 'ArrowRight' \|\| e\.key === 'ArrowUp' \|\| e\.key === 'ArrowDown'/);
  assert.match(keys, /if \(!nudgeFocus\(\)\) return;/, '入力中やサイドバー幅ハンドルでも動かしてしまう');
  assert.match(keys, /e\.preventDefault\(\);/, '矢印でページがスクロールしてしまう');
  assert.match(keys, /nudge\(/, 'nudge が呼ばれていない');
  // 矢印キーを触らない場所(入力欄・ハンドル)の判定
  assert.match(rsrc, /return !isTextEditing\(\) && \(!ae \|\| ae === document\.body \|\| ae === cv\);/, 'nudgeFocus の条件が違う');
  const nudge = bodyOf(rsrc, 'function nudge(');
  assert.match(nudge, /if \(!sel \|\| selLocked\(sel\)\) return false;/, 'ロック中かどうか見ていない');
  assert.match(nudge, /core\.moveStationTo\(/, '駅の移動が core 経由でない');
  assert.match(nudge, /core\.moveCrossingTo\(/, '踏切の移動が core 経由でない');
  assert.match(nudge, /core\.ensureRoom\(/, '地図の拡張を呼んでいない');
  assert.match(nudge, /core\.update\(/, 'それ以外の移動が core 経由でない');
  assert.match(nudge, /deferSave\(\);/, '連打が1回ずつの履歴になってしまう');
  // 「並行した変更経路を作らない」= 関数の中で座標を直接代入しない
  assert.doesNotMatch(nudge, /\.x\s*=[^=]/, '座標を直接書き換えている(.x =)');
  assert.doesNotMatch(nudge, /\.y\s*=[^=]/, '座標を直接書き換えている(.y =)');
  assert.match(uisrc, /export function selLocked\(sel\)/, '選択情報からロック判定する関数が無い');
  // 保留中の変更(deferSave)を消さずに終了する / 戻す
  assert.match(rsrc, /window\.addEventListener\('pagehide', \(\) => save\(\)\);/, '保留中の変更が画面を閉じると消える');
  assert.match(bodyOf(rsrc, 'function undo()'), /save\(\);/, 'undo の前に保留中の変更を積んでいない(2つ戻る)');
});

test('U4-4 Tab はキャンバスの中だけで要素を順に選ぶ', () => {
  const tab = bodyOf(rsrc, "if (e.key === 'Tab'");
  assert.match(tab, /document\.activeElement === cv/, 'キャンバス以外でも Tab を奪っている');
  assert.match(tab, /e\.preventDefault\(\);/, 'Tab でフォーカス移動が止まらない');
  assert.match(tab, /cycleSel\(e\.shiftKey\);/, '逆順(Shift+Tab)を扱っていない');
  const cyc = bodyOf(rsrc, 'function cycleSel(');
  assert.match(cyc, /pickInBox\(m, \{ x0: 0, y0: 0, x1: mw\(m\), y1: mh\(m\) \}\)/, '選ぶ対象を集めていない');
  assert.match(cyc, /\(i \+ \(back \? list\.length - 1 : 1\)\) % list\.length/, '端まで行くと先頭へ戻らない');
  assert.match(cyc, /centerOn\(p\.x, p\.y\);/, '選んだ要素が画面外に出ていく');
  assert.match(cyc, /renderAll\(\);/, '選択が画面に出ない');
});

test('U4-5 入力中のガグは SELECT と contenteditable も見る(修正したバグ)', () => {
  // キーボードの入口は isTextEditing() に一本化されている
  assert.match(rsrc, /if \(isTextEditing\(\)\) return;/, 'キー入力のガグが isTextEditing ではない');
  assert.match(bodyOf(rsrc, "if ((e.ctrlKey || e.metaKey) && (k === 'z'"), /if \(isTextEditing\(\)\) return;/,
    'Ctrl+Z のガグが isTextEditing ではない');
  const isTextEditing = bodyOf(rsrc, 'const isTextEditing = () =>');
  assert.match(isTextEditing, /ae\.tagName === 'TEXTAREA' \|\| ae\.tagName === 'SELECT'/, 'SELECT を見ていない');
  assert.match(isTextEditing, /ae\.isContentEditable/, 'contenteditable を見ていない');
  // 再描画のガグも同じ判定(select を開いたまま描き直して閉じてしまわない)
  assert.match(rsrc, /if \(!isTextEditing\(\)\) renderSide\(\);/, '入力中の再描画ガグが isTextEditing ではない');
});

test('U4-6 コントラスト(WCAG AA)を実測する', () => {
  const say = (label, r, need) => `${label} = ${r.toFixed(2)}:1(必要 ${need}:1)`;
  // 1) 注記の文字(.note)
  const note = val(decl('aside .note {'), 'color');
  assert.ok(ratio(note, white) >= 4.5, say('.note ' + note, ratio(note, white), 4.5));
  // 2) 押せないボタン(#tools button:disabled の opacity は文字の可読性に効く)
  const dOp = parseFloat(val(decl('#tools button:disabled {'), 'opacity'));
  const dRatio = ratio(blend(ink, white, dOp), white);
  assert.ok(dRatio >= 4.5, say('無効ボタンの文字(opacity ' + dOp + ')', dRatio, 4.5));
  // 3) 非表示の路線名(#lines li.off .lname)は背景付きで測る
  const offBg = val(decl('#lines li.off {'), 'background');
  const offOp = parseFloat(val(decl('#lines li.off .lname {'), 'opacity'));
  const lRatio = ratio(blend(ink, offBg, offOp), offBg);
  assert.ok(lRatio >= 4.5, say('非表示の路線名(opacity ' + offOp + ')', lRatio, 4.5));
  // 4) トグルスイッチは文字ではないが「ON/OFF の状態」を示す部品なので 3:1(WCAG 1.4.11)
  const track = val(decl('#quick .qsw .track {'), 'background');
  const knob = val(decl('#quick .qsw .track::after {'), 'background');
  assert.ok(ratio(knob, track) >= 3, say('スイッチのツマミ vs トラック', ratio(knob, track), 3));
  assert.ok(ratio(track, white) >= 3, say('スイッチのトラック vs 背景', ratio(track, white), 3));
  const on = /--signal:(#[0-9a-fA-F]{3,6})/.exec(css)[1];
  assert.ok(ratio(on, white) >= 3, say('スイッチON(緑) vs 背景', ratio(on, white), 3));
});
