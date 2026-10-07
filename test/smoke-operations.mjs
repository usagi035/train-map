/* =============================================================================
   smoke-operations.mjs — 操作のスモーク(PART 3「No regressions」の下支え)。
   指示書 PART3 は「追加 / 移動 / 削除 / Undo-Redo … を**実ブラウザで手動確認**」と決めている。
   その手動確認の前に、**DOM を使わず src/core の操作だけ**を一度に通して、
   「操作そのものが壊れていない」を先に確かめる(依存パッケージなし = `node --test`)。
   - 追加: 駅 / 乗り換え駅 / 踏切 / バス停 / バスターミナル / 幹線道路 / ラベル枠 / 画像
   - 動かす・大きさを変える・消す・Undo / Redo・JSON の書き出し→読み込み
   ブラウザ側の挙動(ズーム・サイドバーの幅・PNG 書き出し・2タブ同期)はここでは扱わない
   = u1〜u7 / s3 / s6 のテストと、手動確認の領分。
   =========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCore } from '../src/core/operations.js';

// 手では置かない、サニタイザの形式チェックを通る小さな PNG の data URL
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

const core = createCore();
/** いま見ている路線図と路線(履歴に残す「そのときの表示」) */
const view = () => { const s = core.getState(); return { map: s.maps[0].id, line: s.maps[0].lines[0].id }; };

test('smoke-operations: 追加 → 動かす → 大きさを変える → 消す → Undo/Redo → 書き出し/読み込み', () => {
  // ---- 起動直後と同じ状態(路線図1つ・路線1本)から始める。履歴もここで空にする
  core.importDocument({
    maps: [{ id: 'm0', name: '路線図 1', lines: [{ id: 'l0', name: '1号線', color: '#1E7BC4', stations: [], crossings: [] }] }]
  });
  core.resetHistory(view());
  let map = core.getState().maps[0], line = map.lines[0];
  assert.ok(line && line.stations.length === 0, 'まっさらな路線から始めていない');

  // ---- 追加(PART3 の一覧どおり)
  const s1 = core.addStation({ map, line, p: { x: 100, y: 100 }, snap: true });
  const s2 = core.addStation({ map, line, p: { x: 300, y: 100 }, snap: true });
  const s3 = core.addStation({ map, line, p: { x: 500, y: 100 }, snap: true });
  const hub = core.addHubStation({ map, p: { x: 700, y: 100 }, snap: true });
  const cxr = core.addCrossing({ map, p: { x: 200, y: 100 }, snap: true });
  const bus = core.addBusStop({ map, p: { x: 120, y: 200 }, kind: 'stop', snap: true });
  const term = core.addBusStop({ map, p: { x: 320, y: 200 }, kind: 'terminal', snap: true });
  const road = core.addRoad(map, [{ x: 100, y: 300 }, { x: 400, y: 300 }]);
  const box = core.addBox(map, { x: 100, y: 400 });
  const img = core.addImage(map, { src: PNG, x: 300, y: 400, w: 100, h: 80 });

  assert.deepEqual(line.stations.map(x => x.id), [s1.id, s2.id, s3.id], '駅が路線に乗っていない');
  assert.ok(map.hubs.includes(hub), '乗り換え駅が置場に無い');
  assert.ok(cxr.crossing, '踏切が線の近くに置けない(' + (cxr.error || '理由なし') + ')');
  assert.equal(cxr.line, line, '踏切が違う路線に付いた');
  assert.equal(map.stops.length, 2, 'バス停・バスターミナルが揃っていない');
  assert.ok(map.stops.some(x => x.kind === 'terminal'), 'バスターミナルの種別が保持されていない');
  assert.equal(map.roads.length, 1, '幹線道路が入っていない');
  assert.equal(map.boxes.length, 1, 'ラベル枠が入っていない');
  assert.equal(map.images.length, 1, '画像が入っていない');
  assert.equal(img.w, 100, '画像の大きさが違う');
  assert.equal(box.w, 120, 'ラベル枠の既定サイズが違う');
  assert.equal(map.show.stop, true, '置いたのにバス停のレイヤーが非表示のまま');
  assert.equal(map.show.box, true, '置いたのにラベル枠のレイヤーが非表示のまま');
  assert.equal(map.show.img, true, '置いたのに画像のレイヤーが非表示のまま');
  assert.ok(core.commit(view()), '追加が履歴に乗らない');

  // ---- 動かす / 大きさを変える(リサイズ)
  const home = { x: s1.x, y: s1.y };
  core.moveStationTo(map, s1, 140, 160);
  assert.equal(s1.x, 140, '駅が動かない');
  assert.equal(s1.y, 160, '駅が動かない');
  core.update(box, { w: 240, h: 120 });
  core.update(img, { w: 200, h: 160, opacity: 0.5 });
  assert.equal(box.w, 240, 'ラベル枠がリサイズできない');
  assert.equal(img.opacity, 0.5, '画像の不透明度を変えられない');
  assert.ok(core.commit(view()), '移動とリサイズが履歴に乗らない');

  // ---- 消す(PART3 の一覧どおり)
  const del = sel => core.deleteElement({ map, sel, fallbackLine: line });
  assert.equal(del({ t: 'st', id: s3.id }), true, '駅が消えない');
  assert.equal(del({ t: 'st', id: hub.id }), true, '乗り換え駅が消えない');
  assert.equal(del({ t: 'cx', id: cxr.crossing.id }), true, '踏切が消えない');
  assert.equal(del({ t: 'stop', id: bus.id }), true, 'バス停が消えない');
  assert.equal(del({ t: 'stop', id: term.id }), true, 'バスターミナルが消えない');
  assert.equal(del({ t: 'road', id: road.id }), true, '幹線道路が消えない');
  assert.equal(del({ t: 'bx', id: box.id }), true, 'ラベル枠が消えない');
  assert.equal(del({ t: 'img', id: img.id }), true, '画像が消えない');
  assert.equal(line.stations.length, 2, '消した分だけ駅が減っていない');
  assert.ok(core.commit(view()), '削除が履歴に乗らない');

  // ---- Undo で「消す前」へ
  assert.ok(core.undo(), 'Undo が動かない');
  map = core.getState().maps[0]; line = map.lines[0];
  assert.equal(line.stations.length, 3, '消した駅が戻らない');
  assert.ok(line.stations.some(x => x.id === s3.id), '消した駅が戻らない');
  assert.ok(line.crossings.length === 1, '消した踏切が戻らない');
  assert.equal(map.hubs.length, 1, '消した乗り換え駅が戻らない');
  assert.equal(map.stops.length, 2, '消したバス停が戻らない');
  assert.equal(map.roads.length, 1, '消した幹線道路が戻らない');
  assert.equal(map.boxes.length, 1, '消したラベル枠が戻らない');
  assert.equal(map.images.length, 1, '消した画像が戻らない');

  // ---- Redo で消した後へ戻る
  assert.ok(core.redo(), 'Redo が動かない');
  map = core.getState().maps[0]; line = map.lines[0];
  assert.equal(line.stations.length, 2, 'Redo で消えない');
  assert.equal(map.stops.length + map.roads.length + map.boxes.length + map.images.length, 0, 'Redo で消えない');

  // ---- もう一度 Undo して「消す前(= 動かした後の全部が揃った状態)」へ
  assert.ok(core.undo());
  map = core.getState().maps[0]; line = map.lines[0];
  assert.equal(map.stops.length, 2, '戻っていない');
  assert.equal(line.stations.length, 3, '戻っていない');

  // ---- JSON を書き出してそのまま読み込む(PART3「JSON round trip」)。中身が変わらないこと
  const json = core.snapshot();
  core.importDocument(JSON.parse(json));       // 保存する文字列をそのまま読む
  assert.deepEqual(core.getState(), JSON.parse(json), '書き出し → 読み込みで中身が変わった');
  map = core.getState().maps[0]; line = map.lines[0];   // 読み込みで中身が差し替わるので取り直す

  // ---- さらに Undo して「動かす前」へ
  assert.ok(core.undo(), '読み込みのあとで Undo が動かなくなった');
  map = core.getState().maps[0]; line = map.lines[0];
  const s1b = line.stations.find(x => x.id === s1.id);
  assert.ok(s1b, '追加した駅が無い');
  assert.equal(s1b.x, home.x, '移動が Undo で戻らない');
  assert.equal(s1b.y, home.y, '移動が Undo で戻らない');
  assert.equal(map.boxes[0].w, 120, 'リサイズが Undo で戻らない');
  assert.equal(map.images[0].w, 100, 'リサイズが Undo で戻らない');
  assert.equal(map.images[0].opacity, 1, '不透明度の変更が Undo で戻らない');

  // ---- もう一度 Undo して「1つも無い」最初へ
  assert.ok(core.undo());
  map = core.getState().maps[0]; line = map.lines[0];
  assert.equal(line.stations.length, 0, '追加が Undo で戻らない');
  assert.equal(line.crossings.length, 0, '追加が Undo で戻らない');
  assert.equal((map.hubs || []).length, 0, '追加が Undo で戻らない');
  assert.equal((map.stops || []).length, 0, '追加が Undo で戻らない');
  assert.equal((map.roads || []).length, 0, '追加が Undo で戻らない');
  assert.equal((map.boxes || []).length, 0, '追加が Undo で戻らない');
  assert.equal((map.images || []).length, 0, '追加が Undo で戻らない');
  assert.equal(core.canUndo(), false, '戻るものが無いのに Undo 可能と出ている');
  assert.equal(core.canRedo(), true, 'Redo で戻せる状態になっていない');
});
