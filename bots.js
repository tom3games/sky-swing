// 天空ブランコの bot（sim・検証・?demo=1 で使う）。人の速さに寄せる: 反応の遅れ・狙いのずれ・漕ぐタイミングのぶれ
// cfg: lag 気づいてから押すまでの秒 / jit タイミングのぶれ(秒) / pump 'good'|'bad'|'inv'|'none' / frac 下で立つ範囲（振れ幅の何割より内側で立つか）
//      aim 先読みの手が鎖にこれだけ近ければ離す / minAmp 離すのを考え始める振れ幅 / tuck 空中で向きを合わせに丸まるか / hand 'air'（空中は押しっぱなし）|'late'（近づいてから押す）
;(function (root) {
'use strict'
function makeBot(PH, cfg, rnd = Math.random) {
  const st = { amp: 0, curMax: 0, lastSgn: 0, relAt: -1, pressAt: -1, body: false, nextBody: -1, bodyWant: false, frac: cfg.frac || 0.5, handAirAt: -1, chooseTuck: false, tuckUntil: -1, decT: 0 }
  const jit = () => (rnd() + rnd() + rnd() - 1.5) * (cfg.jit || 0)
  const lag = () => (cfg.lag || 0) * (0.7 + 0.6 * rnd())
  return function (w) {
    const m = w.me, t = w.t
    const out = { body: false, hand: false }
    if (cfg.idle) return out
    if (w.phase === 'ready') { if (st.pressAt < 0) st.pressAt = t + lag() + 0.3; out.hand = t >= st.pressAt; st.relAt = -1; st.amp = 0; st.curMax = 0; return out }
    st.pressAt = -1
    if (w.phase === 'swing') {
      const om = m.h / (m.L * m.L)
      const sg = Math.sign(om)
      st.curMax = Math.max(st.curMax, Math.abs(m.th))
      if (sg && st.lastSgn && sg !== st.lastSgn) { st.amp = st.curMax; st.curMax = 0; st.frac = (cfg.frac || 0.5) + jit() * 0.6 }
      if (sg) st.lastSgn = sg
      const A = Math.max(st.amp, st.curMax, 0.2)
      // 漕ぐ: 決めた時から lag 遅れて体が動く
      let want
      if (cfg.pump === 'good') want = Math.abs(m.th) < st.frac * A
      else if (cfg.pump === 'inv') want = Math.abs(m.th) > st.frac * A
      else if (cfg.pump === 'bad') { if (t >= st.decT) { st.bodyWant = rnd() < 0.5; st.decT = t + 0.25 + rnd() * 0.6 } want = st.bodyWant }
      else want = false
      if (want !== st.bodyWant2) { st.bodyWant2 = want; st.nextBody = t + Math.max(0, lag() * 0.5 + jit()) }
      if (st.nextBody >= 0 && t >= st.nextBody) { st.body = st.bodyWant2; st.nextBody = -1 }
      out.body = st.body
      // 離す: 先読みで次のブランコに手が届くと見えたら、lag 遅れて離す
      out.hand = true
      if (st.relAt < 0 && A > (cfg.minAmp || 0.5) && (w.tick % 2 === 0)) {
        const j = m.si + 1
        const path = PH.predict(w, 1.5, false)
        const hit = PH.predictHit(w, j, path)
        if (hit.d < (cfg.aim || 0.18) && hit.off < PH.P.upTol * 0.85) { st.relAt = t + (cfg.lead ? 0 : lag() * 0.35) + jit() * 0.5; st.chooseTuck = false }
        else if (cfg.tuck) {
          const p2 = PH.predict(w, 1.5, true), h2 = PH.predictHit(w, j, p2)
          if (h2.d < (cfg.aim || 0.18) && h2.off < PH.P.upTol * 0.85) { st.relAt = t + lag() * 0.35 + jit() * 0.5; st.chooseTuck = true }
        }
        if (cfg.pump === 'bad' && st.relAt < 0 && A > 1.0 && rnd() < 0.02) st.relAt = t + lag()
      }
      if (st.relAt >= 0 && t >= st.relAt) { out.hand = false; st.relAt = -1; st.handAirAt = t + (cfg.hand === 'late' ? 0.25 + lag() : 0.08 + lag() * 0.3); st.tuckUntil = st.chooseTuck ? t + 0.6 : -1 }
      return out
    }
    if (w.phase === 'air') {
      out.hand = t >= st.handAirAt
      out.body = t < st.tuckUntil
      st.amp = 0; st.curMax = 0; st.lastSgn = 0
      return out
    }
    return out
  }
}
const BOTS = {
  // 上手い人: 下で立って端でしゃがむ・反応0.2秒
  good: { pump: 'good', frac: 0.5, lag: 0.2, jit: 0.05, aim: 0.16, minAmp: 0.4, tuck: true },
  // 人の速さ（初めて数分の人）: 反応0.35秒・ぶれ大きめ・丸まりは使わない
  human: { pump: 'good', frac: 0.5, lag: 0.35, jit: 0.1, aim: 0.18, minAmp: 0.4 },
  // 下手: でたらめに立ったりしゃがんだり・届きそうなら離す
  bad: { pump: 'bad', lag: 0.35, jit: 0.1, aim: 0.18, minAmp: 0.4 },
  // 逆に漕ぐ（端で立つ）
  inv: { pump: 'inv', frac: 0.5, lag: 0.3, jit: 0.08, aim: 0.18, minAmp: 0.4 },
  // 漕がない
  none: { pump: 'none', lag: 0.3, jit: 0.08, aim: 0.18, minAmp: 0.4 },
  idle: { idle: true },
}
const API = { makeBot, BOTS }
if (typeof module !== 'undefined' && module.exports) module.exports = API
else root.SS_BOTS = API
})(typeof window !== 'undefined' ? window : globalThis)
