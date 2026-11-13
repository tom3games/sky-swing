// 天空ブランコの bot（sim・検証・?demo=1 で使う）。v2: 左右の2ボタンだけ
// 人の速さに寄せる: 揺れの向きに気づくまでの遅れ（lag）・タイミングのぶれ（jit）・空中で寄せるかどうか
// cfg: pump 'good'（揺れている向きに押す）|'hold'（次の鎖の向きを押しっぱなし）|'bad'（でたらめ）|'inv'（逆に押す）
//      lag 気づいてから押すまでの秒 / jit ぶれ(秒) / air 空中で次の鎖へ寄せる / airLag 空中で寄せ始めるまでの秒
;(function (root) {
'use strict'
function makeBot(PH, cfg, rnd = Math.random) {
  const hist = []
  const st = { want: 0, cur: 0, at: -1, decT: 0, rnd: 0, airDir: 0, airAt: -1, startAt: -1 }
  const jit = () => (rnd() + rnd() + rnd() - 1.5) * (cfg.jit || 0)
  const lag = () => (cfg.lag || 0) * (0.75 + 0.5 * rnd())
  const out = d => ({ L: d < 0, R: d > 0 })
  return function (w) {
    const m = w.me, t = w.t
    if (cfg.idle) return out(0)
    hist.push({ t, om: m.mode === 'swing' ? m.h / (m.L * m.L) : 0, mode: m.mode })
    while (hist.length > 2 && hist[1].t <= t - (cfg.lag || 0)) hist.shift()
    const seen = hist[0]
    if (w.phase === 'ready') {
      if (st.startAt < 0) st.startAt = t + lag() + 0.3
      if (t < st.startAt) return out(0)
      const nx = w.swings[m.si + 1], s = w.swings[m.si]
      return out(nx ? Math.sign(nx.x - s.x) || 1 : 1)
    }
    st.startAt = -1
    if (w.phase === 'swing') {
      const s = w.swings[m.si], nx = w.swings[m.si + 1]
      const toward = nx ? Math.sign(nx.x - s.x) || 1 : 1
      let want = 0
      if (cfg.pump === 'good') want = seen.mode === 'swing' ? Math.sign(seen.om) || toward : 0
      else if (cfg.pump === 'inv') want = seen.mode === 'swing' ? -Math.sign(seen.om) : 0
      else if (cfg.pump === 'hold') want = toward
      else if (cfg.pump === 'bad') { if (t >= st.decT) { st.rnd = [-1, 0, 1][Math.floor(rnd() * 3)]; st.decT = t + 0.25 + rnd() * 0.7 } want = st.rnd }
      if (want !== st.want) { st.want = want; st.at = t + Math.max(0, jit()) }
      if (st.at >= 0 && t >= st.at) { st.cur = st.want; st.at = -1 }
      st.airDir = 0; st.airAt = -1
      return out(st.cur)
    }
    if (w.phase === 'air') {
      st.cur = 0; st.want = 0
      if (!cfg.air) return out(0)
      if (st.airAt < 0) st.airAt = t + (cfg.airLag != null ? cfg.airLag : 0.3) * (0.8 + 0.4 * rnd())
      if (t < st.airAt) return out(0)
      // 今のまま飛んだら、手が次の鎖の左右どちらを通るか
      const s = w.swings[m.relFrom + 1]
      if (!s) return out(0)
      if (w.tick % 6 === 0) {
        const path = PH.predictAir(w, 0.9)
        let best = 9, side = 0
        for (let k = 0; k < path.length; k++) {
          const tt = (k + 1) * PH.DT, th = s.th + s.om * tt
          const p = path[k]
          const u = (s.y - p.y) / s.C   // 手の高さが鎖のどこか（0 吊り元 / 1 座面）
          if (u < 0 || u > 1.1) continue
          const cx = s.x + s.C * u * Math.sin(th)
          const d = Math.abs(cx - p.x)
          if (d < best) { best = d; side = Math.sign(cx - p.x) }
        }
        st.airDir = best < 0.12 || best > 3 ? 0 : side
      }
      return out(st.airDir)
    }
    return out(0)
  }
}
const BOTS = {
  // 上手い人: 揺れの向きに0.2秒で気づく・空中ですぐ寄せる
  good: { pump: 'good', lag: 0.2, jit: 0.05, air: true, airLag: 0.12 },
  // 人の速さ（初めて数分の人）: 0.35秒遅れ・ぶれ大きめ・空中で寄せるのも遅い
  human: { pump: 'good', lag: 0.35, jit: 0.12, air: true, airLag: 0.35 },
  // 空中で寄せない人（漕ぐだけ）
  noair: { pump: 'good', lag: 0.35, jit: 0.12 },
  // 次の鎖の向きを押しっぱなし
  hold: { pump: 'hold', lag: 0.3 },
  // でたらめに押す
  bad: { pump: 'bad', lag: 0.35, jit: 0.1 },
  // 逆に押す
  inv: { pump: 'inv', lag: 0.3, jit: 0.08 },
  // 押さない
  idle: { idle: true },
}
const API = { makeBot, BOTS }
if (typeof module !== 'undefined' && module.exports) module.exports = API
else root.SS_BOTS = API
})(typeof window !== 'undefined' ? window : globalThis)
