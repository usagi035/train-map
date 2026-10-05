/* 旧形式のデータを、いまの内部形式へ移す(§4)。画面には依存しない。 */
import { COLORS, mkLine, mkRoad, mkBusStop } from './model.js';

// 旧形式の移行: 道路を「路線のtype:road + 駅」で持っていたデータを、独立した道路・バス停へ変換する
export function migrate(data) {
  data.maps.forEach(m => {
    if (!Array.isArray(m.roads)) m.roads = [];
    if (!Array.isArray(m.stops)) m.stops = [];
    if (!Array.isArray(m.images)) m.images = [];   // インポートした画像要素
    // 種類ごとの表示/非表示(レイヤー)。無ければ全部表示
    if (!m.show || typeof m.show !== 'object') m.show = {};
    ['road', 'stop', 'box', 'img'].forEach(k => { if (typeof m.show[k] !== 'boolean') m.show[k] = true; });
    if (!Array.isArray(m.hubs)) m.hubs = [];   // 路線に属さない乗り換え駅の置き場所
    if (!Array.isArray(m.lines) || !m.lines.length) { m.lines = [mkLine('1号線', COLORS[0])]; return; }
    // 接続駅リストを「路線ごと」に。旧形式(配列)は、その駅が属する路線の分へまとめる
    const all = [...m.lines.flatMap(l => l.stations), ...(m.hubs || [])];
    const ids = new Set(all.map(x => x.id));
    all.forEach(st => {
      if (Array.isArray(st.links)) {
        const home = m.lines.find(l => l.stations.some(x => x.id === st.id));
        const arr = st.links.slice();
        st.links = {}; st.links[home ? home.id : '-'] = arr;
      } else if (!st.links || typeof st.links !== 'object') {
        if (st.links !== undefined) delete st.links;
      }
      if (st.links && typeof st.links === 'object') {
        Object.keys(st.links).forEach(k => {
          if (Array.isArray(st.links[k])) st.links[k] = st.links[k].filter(x => ids.has(x));   // 存在しない駅への接続は捨てる
          else delete st.links[k];
        });
      }
    });
    const oldRoads = m.lines.filter(l => l.type === 'road');
    if (!oldRoads.length) return;
    oldRoads.forEach(l => {
      if (l.stations.length >= 2)
        m.roads.push(mkRoad(l.name, l.color, l.stations.map(s => ({ x: s.x, y: s.y }))));
      l.stations.forEach(s => {
        const st = mkBusStop(s.name, s.x, s.y, s.shape === 'terminal' ? 'terminal' : 'stop');
        st.color = s.color; st.nameX = s.nameX; st.nameY = s.nameY; st.nameRot = s.nameRot;
        m.stops.push(st);
      });
    });
    m.lines = m.lines.filter(l => l.type !== 'road');
    if (!m.lines.length) m.lines.push(mkLine('1号線', COLORS[0]));
  });
  return data;
}
