/* =============================================================================
   S3(localStorage の名前空間つきキーと旧データの移行)の受入テスト。
   localStorage / location はスタブを使う(依存パッケージなし)。
   =========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.location = { hash: '' };

/** 動作する localStorage 相当のスタブ(挙動は本物に合わせる) */
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
    clear: () => map.clear(),
    key: i => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    has: k => map.has(k),
    dump: () => Object.fromEntries(map)
  };
}

const { NS, KEYS, LEGACY, migrateLegacyKeys } = await import('../src/renderer/storage.js');

/** 旧キーぶんの保存データ(色が不正 + 日本語の名前 = S1 と S3 を同時に確認できる) */
const LEGACY_DOC = {
  maps: [{
    id: 'm1', name: '旧い路線図',
    lines: [{ id: 'l1', name: '1号線', color: 'red" onload="alert(1)',
      stations: [{ id: 's1', name: '駅いち', x: 100, y: 200 }], crossings: [] }],
    roads: [], stops: [], hubs: [], images: [], boxes: [],
    show: { road: true, stop: true, box: true, img: true }
  }]
};

test('S3-1 キーはすべて train-map:v1: 名前空間の下にある', () => {
  assert.equal(NS, 'train-map:v1:');
  for (const k of Object.values(KEYS)) assert.ok(k.startsWith(NS), `${k} が名前空間外`);
  for (const k of Object.values(LEGACY)) assert.ok(!Object.values(KEYS).includes(k), `${k} が旧キー`);
  assert.equal(KEYS.maps, 'train-map:v1:maps');
});

test('S3-2 新しい方のキーが無ければ旧キーから移行し、旧キーは残す', () => {
  globalThis.localStorage = makeStorage({
    railmaps: JSON.stringify(LEGACY_DOC),
    railopen: JSON.stringify(['m1']),
    railacc: JSON.stringify({ line: true }),
    railpanelw: JSON.stringify({ left: 500, right: 300 })
  });
  migrateLegacyKeys();
  const d = globalThis.localStorage.dump();

  assert.ok(d[KEYS.maps], '地図が移行していない');
  assert.ok(d[KEYS.open], '開いているタブが移行していない');
  assert.ok(d[KEYS.acc], '開閉状態が移行していない');
  assert.ok(d[KEYS.panelw], 'サイドバー幅が移行していない');
  // 旧キーは消さない(同じリリースでデータを捨てない)
  assert.ok(d.railmaps, '旧 railmaps を消した');
  assert.ok(d.railopen, '旧 railopen を消した');
  assert.ok(d.railacc, '旧 railacc を消した');
  assert.ok(d.railpanelw, '旧 railpanelw を消した');
  // 移行するときも S1 を通す(不正な色は既定へ、日本語の名前はそのまま)
  const moved = JSON.parse(d[KEYS.maps]);
  assert.equal(moved.maps[0].name, '旧い路線図', '路線図の名前を落とした');
  assert.equal(moved.maps[0].lines[0].stations[0].name, '駅いち', '駅名(日本語)を落とした');
  assert.notEqual(moved.maps[0].lines[0].color, 'red" onload="alert(1)', '不正な色がそのまま移った');
  assert.match(moved.maps[0].lines[0].color, /^#[0-9a-fA-F]{6}$/);
  // 小さなUI設定はそのまま移る
  assert.deepEqual(JSON.parse(d[KEYS.open]), ['m1']);
  assert.deepEqual(JSON.parse(d[KEYS.panelw]), { left: 500, right: 300 });
});

test('S3-3 移行済みの値は上書きしない(旧キーに書き戻さない)', () => {
  const store = makeStorage({
    [KEYS.maps]: JSON.stringify({ maps: [{ id: 'm2', name: '新しい側', lines: [] }] }),
    [KEYS.open]: JSON.stringify(['m2']),
    railmaps: JSON.stringify(LEGACY_DOC),
    railopen: JSON.stringify(['m1'])
  });
  globalThis.localStorage = store;
  migrateLegacyKeys();
  const d = store.dump();
  assert.equal(JSON.parse(d[KEYS.maps]).maps[0].name, '新しい側', '移行済みの値を上書きした');
  assert.equal(JSON.parse(d[KEYS.open])[0], 'm2', '移行済みの開閉状態を上書きした');
  assert.equal(JSON.parse(d.railmaps).maps[0].name, '旧い路線図', '旧キー側を変えた');
});

test('S3-4 直せない旧データなら移さない(旧キーを守り、起動は初期状態で始める)', () => {
  const store = makeStorage({ railmaps: 'これは{壊れたJSON' });
  globalThis.localStorage = store;
  migrateLegacyKeys();
  assert.equal(store.has(KEYS.maps), false, '読めないデータを無理に移した');
  assert.equal(store.getItem('railmaps'), 'これは{壊れたJSON', '壊れた旧データを消した');
  // 例外ではなく黙って続行すること
  store.clear();
  store.setItem('railmaps', JSON.stringify({ maps: null }));
  migrateLegacyKeys();   // ここで例外が出れば失敗
  assert.equal(store.has(KEYS.maps), false);
});

test('S3-5 旧キーの書込み箇所が画面側から消えている(4キーすべて)', () => {
  const files = ['ui-state.js', 'tabs.js', 'side-panel.js', 'renderer.js'];
  for (const f of files) {
    const src = readFileSync(new URL(`../src/renderer/${f}`, import.meta.url), 'utf8');
    for (const k of Object.values(LEGACY)) {
      assert.ok(!src.includes(`'${k}'`), `${f} が旧キー '${k}' を直接使っている`);
    }
  }
  // storage イベントのキー判定も名前空間つきキーでないとタブ間同期が死ぬ
  const r = readFileSync(new URL('../src/renderer/renderer.js', import.meta.url), 'utf8');
  assert.match(r, /e\.key !== KEYS\.maps/, 'storage イベントのキー判定が古い');
  // 読み込み前に移行が走ること
  const u = readFileSync(new URL('../src/renderer/ui-state.js', import.meta.url), 'utf8');
  assert.match(u, /migrateLegacyKeys\(\)/, '起動時の移行呼び出しが無い');
});

test('S3-6 起動: 旧キーだけのプロファイルで地図が読み込め、保存は新キーへ行く', async () => {
  globalThis.document = { getElementById: () => null };   // save() が触るボタンは無いものとして扱う
  const store = makeStorage({ railmaps: JSON.stringify(LEGACY_DOC), railopen: JSON.stringify(['m1']) });
  globalThis.localStorage = store;
  const M = await import('../src/renderer/ui-state.js');

  // 旧キーの地図が読み込めている(名前を落としていない)
  const st = M.core.getState();
  assert.equal(st.maps[0].name, '旧い路線図', '旧データが起動時に読み込めなかった');
  assert.equal(st.maps[0].lines[0].stations[0].name, '駅いち');
  assert.ok(store.has(KEYS.maps), '新キーに移っていない');
  assert.ok(store.getItem('railmaps'), '旧キーを消した(データ喪失)');

  // 書き出しは新キーへのみ(旧キーは移行時点のまま)
  const before = store.getItem('railmaps');
  M.core.importDocument({ maps: [{ id: 'm3', name: '新しく置き換えた図', lines: [{ id: 'l3', name: 'L', color: '#112233', stations: [], crossings: [] }] }] });
  M.save();
  assert.equal(JSON.parse(store.getItem(KEYS.maps)).maps[0].name, '新しく置き換えた図', '保存が新キーへ行っていない');
  assert.equal(store.getItem('railmaps'), before, '保存が旧キーに書いた');
});
