/* ===========================================================================
   同梱しているサンプル路線図(U5: 初回・空状態)。
   「駅を追加」→ クリック の手順を見る前に、触れるものが1つ無いと最初の操作が
   分からないので、空の路線図から1クリックで読み込めるようにする。
   - このファイルは**データだけ**の純粋モジュール(DOM を触らない)。
   - 中身は `sanitizeDocument()` を警告なしで通ることを `test/sanitize.test.js`
     が検査する(S1 のテストに追加)。書き換えたら必ずテストを通す。
   - `test/fixtures/sample.json` と同じ内容にしてあることもテストで確かめる
     (ブラウザでの検証時にこのファイルを localStorage へ入れ直しているため)。
   =========================================================================== */

export const SAMPLE_MAP = {
  id: 'map-demo-1',
  name: 'サンプル路線図',
  bg: '#f4f6f5',
  w: 2400,
  h: 1600,
  show: { road: true, stop: true, box: true, img: true },
  lines: [
    {
      id: 'line-1',
      name: '1号線',
      color: '#E5352B',
      width: 8,
      loop: false,
      lock: false,
      hidden: false,
      stations: [
        {
          id: 'st-a',
          name: 'あー駅',
          x: 200,
          y: 300,
          hub: false,
          nameX: 10,
          nameY: -4,
          nameRot: 45,
          links: { 'line-2': ['st-c'], '-': [] },
        },
        {
          id: 'st-b',
          name: 'いー駅',
          x: 400,
          y: 300,
          hub: false,
          shape: 'double',
          color: '#1E7BC4',
          links: {},
        },
        {
          id: 'st-c',
          name: 'うー駅',
          x: 600,
          y: 300,
          hub: true,
          links: { 'line-1': ['st-a'] },
        },
      ],
      crossings: [
        { id: 'cx-1', seg: 0, t: 0.5, name: '第一踏切' },
      ],
    },
    {
      id: 'line-2',
      name: '2号線',
      color: '#1E7BC4',
      width: 12,
      loop: true,
      stations: [
        { id: 'st-d', name: 'えー駅', x: 800, y: 500, hub: false, links: { 'line-1': ['st-a'] } },
      ],
      crossings: [],
    },
  ],
  roads: [
    { id: 'road-1', name: '幹線道路 1', color: '#2E9E5B', width: 16, pts: [{ x: 100, y: 700 }, { x: 900, y: 700 }] },
  ],
  stops: [
    { id: 'stop-1', name: 'バス停1', x: 300, y: 700, kind: 'stop', color: '#1f2d36', nameX: 0, nameY: 20, nameRot: 0 },
  ],
  hubs: [
    { id: 'hub-1', name: '路線外駅', x: 1200, y: 400, hub: true, links: { '-': ['st-a'] } },
  ],
  boxes: [
    { id: 'box-1', x: 100, y: 900, w: 240, h: 90, text: '凡例', fill: '#ffffff' },
  ],
  images: [
    { id: 'img-1', src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==', x: 100, y: 1000, w: 320, h: 180, opacity: 0.8, z: 'back' },
  ],
};

/** 文書としてのサンプル(`sanitizeDocument()` に渡す形) */
export const SAMPLE_DOC = { maps: [SAMPLE_MAP] };
