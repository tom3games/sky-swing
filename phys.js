// 天空ブランコ（sky-swing）の物理。固定60Hz（step 1回 = 1/60秒）。乱数はコースを作る時の種だけ。
// 同じ種・同じ入力（1コマごとの body/hand）なら同じ結果になる。ブラウザでも Node でも動く（sim は Node で回す）
// 仕様の正本: ~/Desktop/claudecode/ideas/sky-swing.md
;(function (root) {
'use strict'
const DT = 1 / 60, GR = 9.8
// 調整値（sim で決めた）
const P = {
  squat: 0.45, stand: 0.78,   // 座面から重心までの高さ（しゃがむ / 立つ）
  lenV: 3.4,                  // 立つ・しゃがむ速さ（m/秒）
  damp: 0.03,                 // 漕がないと少しずつ振れが小さくなる
  tuck: 3.2,                  // 丸まると回転が何倍になるか
  tuckV: 9,                   // 丸まる・伸びる速さ
  armExt: 0.92, armTuck: 0.5, // 重心から手まで（伸びた時 / 丸まった時）
  topGap: 0.05,               // 吊り元のすぐ下は掴めない（梁にぶつかる）
  reach: 0.42,                // 手が鎖にどれだけ近ければつかめるか
  upTol: 1.85,                // 体の上向きと「つかむ所の向き」がこれ以上ずれていたら逆さまで掴めない（rad）
  near: 0.42,                 // 「あと何cm」を出す近さ（reach の外側）
  fallBelow: 5.5,             // 最後に乗ったブランコの座面からこれだけ落ちたら落下
  idle: 25,                   // 何もしないで25秒たつと管理人が来る
  regrab: 0.35,               // 離したブランコをすぐ掴み直せない時間
  grabLoss: 0.86,             // つかんだ瞬間に勢いが少し減る
  slipOm: 7.5,                // これより速く回りながら掴むと手がすべる
  wind: 1.6,                  // 雲の上の横風の強さ（m/秒²）
  drag: 0.012,                // 落下中の空気の抵抗
}
function rng(seed) { let s = Math.abs(Math.floor(seed)) % 2147483646 + 1; return () => (s = s * 16807 % 2147483647) / 2147483647 }
const clamp = (v, a, b) => v < a ? a : v > b ? b : v
// 高さの帯（ブランコをどこから吊るすか）
const BANDS = [
  { min: 0, k: 'park' }, { min: 4.2, k: 'pole' }, { min: 10, k: 'crane' }, { min: 18, k: 'tower' },
  { min: 28, k: 'cloud' }, { min: 42, k: 'heli' }, { min: 60, k: 'plane' }, { min: 85, k: 'moon' },
]
const bandOf = y => { let b = BANDS[0].k; for (const x of BANDS) if (y >= x.min) b = x.k; return b }
// 地面の並び（14m ごとにくり返す）。0 のブランコの下は砂場
const GROUND = [[-3, 'sand'], [3, 'grass'], [4.5, 'pond'], [9.5, 'bush'], [11.5, 'grass']]
function groundAt(x) {
  let u = ((x + 3) % 14 + 14) % 14 - 3, k = 'grass'
  for (const [a, n] of GROUND) if (u >= a) k = n
  return k
}

function genNext(w) {
  const s = w.swings, i = s.length, R = w.R
  if (i === 0) { s.push({ i: 0, x: 0, y: 2.35, C: 1.95, amp: 0, ph: 0, band: 'park', dir: 1, th: 0, om: 0 }); return }
  const p = s[i - 1]
  const dir = i === 1 ? 1 : (R() < 0.66 ? p.dir : -p.dir)
  const k = Math.min(i, 30)
  const dx = i === 1 ? 2.7 : 2.55 + R() * 0.9 + k * 0.012
  const dy = i === 1 ? 1.0 : 0.85 + R() * 0.95 + k * 0.022
  const C = i === 1 ? 1.95 : 1.75 + R() * 0.55
  const y = p.y + dy
  // 8m より上は、たまに勝手に揺れている無人ブランコ
  const amp = (y > 8 && R() < Math.min(0.75, 0.3 + (y - 8) * 0.012)) ? 0.12 + R() * Math.min(0.42, 0.12 + (y - 8) * 0.008) : 0
  const ph = R() * Math.PI * 2
  const pigeon = i >= 3 && R() < 0.13
  const sw = { i, x: p.x + dir * dx, y, C, amp, ph, band: bandOf(y), dir, pigeon, th: 0, om: 0 }
  if (amp) { const wn = Math.sqrt(GR / C); sw.th = amp * Math.sin(ph); sw.om = amp * wn * Math.cos(ph) }
  s.push(sw)
}

function makeWorld(seed = 1) {
  const w = {
    seed, R: rng(seed), tick: 0, t: 0, swings: [], ev: [],
    me: null, phase: 'ready', misses: 0, best: 0, bestIdx: 0, grabs: 0, falls: [], pigeons: 0, loops: 0, flips: 0,
    lastIn: 0, inp: { body: false, hand: false }, prevHand: false, tut: true, windT: 0,
  }
  for (let i = 0; i < 6; i++) genNext(w)
  placeOn(w, 0)
  return w
}
const seatOf = s => ({ x: s.x + s.C * Math.sin(s.th), y: s.y - s.C * Math.cos(s.th) })
// ブランコ j に乗せ直す（はじめ・落ちた後）。次のブランコと反対に少し引いた所から
function placeOn(w, j) {
  const s = w.swings[j], nx = w.swings[j + 1]
  const away = nx ? -Math.sign(nx.x - s.x || 1) : -1
  const L = s.C - P.squat
  w.me = { mode: 'swing', si: j, th: away * 0.42, h: 0, L, x: 0, y: 0, vx: 0, vy: 0, phi: 0, spin: 0, tk: 0, Lb: 0, relT: -9, relFrom: -1, hx: 0, hy: 0, near: {}, peakY: 0, lastSgn: 0, flipAcc: 0 }
  s.th = w.me.th; s.om = 0
  w.phase = 'ready'
  syncPos(w)
}
function syncPos(w) {
  const m = w.me
  if (m.mode === 'swing') {
    const s = w.swings[m.si]
    m.x = s.x + m.L * Math.sin(m.th); m.y = s.y - m.L * Math.cos(m.th)
    m.phi = m.th
    const om = m.h / (m.L * m.L)
    m.vx = m.L * om * Math.cos(m.th); m.vy = m.L * om * Math.sin(m.th)
  }
  const arm = P.armExt + (P.armTuck - P.armExt) * m.tk
  m.hx = m.x - Math.sin(m.phi) * arm; m.hy = m.y + Math.cos(m.phi) * arm
}
// 線分と線分の最短距離。返り値 [距離, 鎖の上の位置 0..1]
function segSeg(ax, ay, bx, by, cx, cy, dx, dy) {
  const ux = bx - ax, uy = by - ay, vx = dx - cx, vy = dy - cy, wx = ax - cx, wy = ay - cy
  const a = ux * ux + uy * uy, b = ux * vx + uy * vy, c = vx * vx + vy * vy, d = ux * wx + uy * wy, e = vx * wx + vy * wy
  const D = a * c - b * b
  let sN, sD = D, tN, tD = D
  if (D < 1e-9) { sN = 0; sD = 1; tN = e; tD = c } else {
    sN = b * e - c * d; tN = a * e - b * d
    if (sN < 0) { sN = 0; tN = e; tD = c } else if (sN > sD) { sN = sD; tN = e + b; tD = c }
  }
  if (tN < 0) { tN = 0; if (-d < 0) sN = 0; else if (-d > a) sN = sD; else { sN = -d; sD = a } }
  else if (tN > tD) { tN = tD; if (-d + b < 0) sN = 0; else if (-d + b > a) sN = sD; else { sN = -d + b; sD = a } }
  const sc = Math.abs(sN) < 1e-9 ? 0 : sN / sD, tc = Math.abs(tN) < 1e-9 ? 0 : tN / tD
  const px = wx + sc * ux - tc * vx, py = wy + sc * uy - tc * vy
  return [Math.hypot(px, py), tc]
}
const wrapA = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a }
const windAt = (w, y) => y < 28 ? 0 : P.wind * Math.min(1, (y - 28) / 30) * Math.sin(w.t * 0.37 + 1.3) * (0.6 + 0.4 * Math.sin(w.t * 1.13))

// 1コマ進める。inp = { body, hand }（押している間 true）
function step(w, inp) {
  const m = w.me, ev = w.ev
  if (w.phase === 'over') return
  if (inp.body !== w.inp.body || inp.hand !== w.inp.hand) w.lastIn = w.t
  w.inp = { body: !!inp.body, hand: !!inp.hand }
  w.tick++; w.t = w.tick * DT
  while (w.swings.length < (w.bestIdx + 8)) genNext(w)
  // 誰も乗っていないブランコ（勝手に揺れる物は振れ幅を保つ）
  for (const s of w.swings) {
    if (m.mode === 'swing' && s.i === m.si) continue
    if (Math.abs(s.i - (m.si >= 0 ? m.si : w.bestIdx)) > 6 && !s.amp) continue
    s.om += -GR / s.C * Math.sin(s.th) * DT
    if (!s.amp) s.om *= (1 - 0.6 * DT)
    s.th += s.om * DT
  }
  if (w.phase === 'ready') {
    if (w.inp.hand) { w.phase = 'swing'; ev.push({ t: 'hold' }) }
    else { if (w.t - w.lastIn > P.idle) end(w, 'closing'); syncPos(w); w.prevHand = w.inp.hand; return }
  }
  if (w.phase === 'swing') {
    const s = w.swings[m.si]
    if (!w.inp.hand) { release(w); w.prevHand = false; return }
    const Lt = s.C - (w.inp.body ? P.stand : P.squat)
    const dL = clamp(Lt - m.L, -P.lenV * DT, P.lenV * DT)
    m.L += dL
    m.h += -GR * m.L * Math.sin(m.th) * DT
    m.h *= (1 - P.damp * DT)
    const om = m.h / (m.L * m.L)
    const th0 = m.th
    m.th += om * DT
    m.dL = dL / DT
    // 一回転
    if (Math.abs(m.th) > Math.PI) { m.th = wrapA(m.th); w.loops++; ev.push({ t: 'loop' }) }
    // 端で向きが変わった時にきしむ
    const sg = Math.sign(om)
    if (sg && m.lastSgn && sg !== m.lastSgn && Math.abs(th0) > 0.25) ev.push({ t: 'creak', amp: Math.abs(th0) })
    if (sg) m.lastSgn = sg
    s.th = m.th; s.om = om
    m.tk = Math.max(0, m.tk - P.tuckV * DT)
    syncPos(w)
    if (w.t - w.lastIn > P.idle) end(w, 'closing')
  } else if (w.phase === 'air' || w.phase === 'fall') {
    const hx0 = m.hx, hy0 = m.hy
    m.vy -= GR * DT
    if (w.phase === 'air') m.vx += windAt(w, m.y) * DT
    else { const sp = Math.hypot(m.vx, m.vy); m.vx -= m.vx * sp * P.drag * DT; m.vy -= m.vy * sp * P.drag * DT }
    m.x += m.vx * DT; m.y += m.vy * DT
    // 丸まると速く回る（角運動量はそのまま）
    m.tk = clamp(m.tk + (w.inp.body ? 1 : -1) * P.tuckV * DT, 0, 1)
    const I = 1 - (1 - 1 / P.tuck) * m.tk
    const sp0 = m.spin
    m.spin = w.phase === 'fall' ? m.spin : m.Lb / I
    m.phi += m.spin * DT
    m.flipAcc += m.spin * DT
    if (Math.abs(m.flipAcc) >= Math.PI * 2) { m.flipAcc -= Math.sign(m.flipAcc) * Math.PI * 2; w.flips++; ev.push({ t: 'flip' }) }
    void sp0
    m.peakY = Math.max(m.peakY, m.y)
    syncPos(w)
    if (w.phase === 'air') {
      if (w.inp.hand) tryGrab(w, hx0, hy0)
      if (w.phase === 'air') {
        const last = w.swings[m.relFrom] || w.swings[0]
        const seatY = last.y - last.C
        if (m.y < seatY - P.fallBelow && m.y > 3.2) { w.phase = 'fall'; m.fallFrom = m.peakY; ev.push({ t: 'fallStart', h: m.peakY }) }
      }
    }
    if ((w.phase === 'air' || w.phase === 'fall') && m.y <= 0.55) land(w)
  } else if (w.phase === 'down') {
    m.downT -= DT
    if (m.downT <= 0) {
      if (m.countMiss) { w.misses++; ev.push({ t: 'miss', n: w.misses }) }
      if (w.misses >= 2) end(w, 'shoes')
      else { placeOn(w, m.relFrom < 0 ? 0 : m.relFrom); ev.push({ t: 'respawn' }) }
    }
  }
  w.prevHand = w.inp.hand
}

function release(w) {
  const m = w.me, s = w.swings[m.si]
  const om = m.h / (m.L * m.L)
  const dL = m.dL || 0
  m.vx = m.L * om * Math.cos(m.th) - dL * Math.sin(m.th)
  m.vy = m.L * om * Math.sin(m.th) + dL * Math.cos(m.th)
  m.phi = m.th; m.spin = om; m.tk = 0; m.Lb = om
  m.relT = w.t; m.relFrom = m.si; m.mode = 'air'; m.peakY = m.y; m.near = {}; m.flipAcc = 0
  s.om = om
  w.phase = 'air'
  w.ev.push({ t: 'release', v: Math.hypot(m.vx, m.vy), th: m.th, si: m.si })
  m.si = -1
}

function tryGrab(w, hx0, hy0) {
  const m = w.me
  let best = null
  for (const s of w.swings) {
    if (Math.abs(s.x - m.x) > 5 || Math.abs(s.y - m.y) > 6) continue
    if (s.i === m.relFrom && w.t - m.relT < P.regrab) continue
    const st = seatOf(s)
    // 鎖の上（吊り元の少し下）から、座面の少し先まで
    const ax = s.x + P.topGap * Math.sin(s.th), ay = s.y - P.topGap * Math.cos(s.th)
    const bx = s.x + (s.C + 0.12) * Math.sin(s.th), by = s.y - (s.C + 0.12) * Math.cos(s.th)
    const [d, u] = segSeg(hx0, hy0, m.hx, m.hy, ax, ay, bx, by)
    if (d < P.reach) {
      const gx = ax + (bx - ax) * u, gy = ay + (by - ay) * u
      const want = Math.atan2(-(gx - m.x), gy - m.y)   // 体の上向き（phi）がこの角なら真っすぐ手が届く
      const off = Math.abs(wrapA(m.phi - want))
      if (off > P.upTol) { if (!m.near['u' + s.i]) { m.near['u' + s.i] = 1; w.ev.push({ t: 'upside', si: s.i }) } continue }
      if (!best || d < best.d) best = { s, d, gx, gy, u }
    } else if (d < P.reach + P.near) {
      const k = 'n' + s.i
      if (m.near[k] == null || d < m.near[k]) m.near[k] = d
    }
  }
  // 近くを通り過ぎた（離れ始めた）ら「あと何cm」
  for (const k in m.near) {
    if (k[0] !== 'n' || m.near[k] < 0) continue
    const s = w.swings[+k.slice(1)]
    const st = seatOf(s)
    const dd = distToChain(m.hx, m.hy, s)
    if (dd > m.near[k] + 0.06 && !best) { w.ev.push({ t: 'near', si: s.i, cm: Math.max(1, Math.round((m.near[k] - P.reach) * 100)) }); m.near[k] = -1 }
    void st
  }
  if (best) attach(w, best)
}
function distToChain(px, py, s) {
  const ax = s.x, ay = s.y, bx = s.x + s.C * Math.sin(s.th), by = s.y - s.C * Math.cos(s.th)
  return segSeg(px, py, px, py, ax, ay, bx, by)[0]
}
// 手が鎖を見逃したかどうかに関係なく、手を押していない時の「あと何cm」も数える
function nearNoHand(w) {
  const m = w.me
  for (const s of w.swings) {
    if (s.i === m.relFrom && w.t - m.relT < P.regrab) continue
    if (Math.abs(s.x - m.x) > 4 || Math.abs(s.y - m.y) > 5) continue
    const d = distToChain(m.hx, m.hy, s), k = 'n' + s.i
    if (d < P.reach + P.near) { if (m.near[k] == null || (m.near[k] >= 0 && d < m.near[k])) m.near[k] = Math.max(d, P.reach) }
  }
}
function attach(w, b) {
  const m = w.me, s = b.s
  const rx = m.x - s.x, ry = m.y - s.y
  let L = Math.hypot(rx, ry)
  const th = Math.atan2(rx, -ry)
  let h = (rx * m.vy - ry * m.vx) * P.grabLoss
  const om = h / (L * L)
  // 速く回りすぎていると手がすべる（勢いを落として掴み直せる時もある）
  if (Math.abs(m.spin - om) > P.slipOm) { w.ev.push({ t: 'slip', si: s.i }); m.spin *= 0.5; m.Lb *= 0.5; m.vx *= 0.7; m.vy *= 0.7; m.near['u' + s.i] = 1; return }
  L = clamp(L, 0.7, s.C + 0.6)
  h = om * L * L
  Object.assign(m, { mode: 'swing', si: s.i, th, h, L, tk: m.tk, lastSgn: 0 })
  s.th = th
  w.phase = 'swing'
  const prevBest = w.bestIdx
  const hgt = +(s.y - s.C - 0.4).toFixed(2)
  if (s.i > w.bestIdx) w.bestIdx = s.i
  if (hgt > w.best) w.best = hgt
  w.grabs++
  if (s.pigeon && !s.pigeonGone) { s.pigeonGone = 1; w.pigeons++ }
  w.ev.push({ t: 'grab', si: s.i, d: b.d, spin: Math.abs(m.spin), up: s.i > prevBest, h: hgt, pigeon: !!s.pigeonGone && s.pigeon, first: s.i === 1 && prevBest === 0 })
  syncPos(w)
}
function land(w) {
  const m = w.me
  const kind = groundAt(m.x)
  const fromH = Math.max(m.peakY, m.y)
  const last = m.relFrom < 0 ? 0 : m.relFrom
  const v = Math.hypot(m.vx, m.vy)
  // 頭から落ちたか（体の上向きが下を向いている）
  const headDown = Math.cos(m.phi) < -0.2
  const upright = Math.cos(m.phi) > 0.75 && v < 7
  const pose = kind === 'pond' ? 'pond' : kind === 'bush' ? 'bush' : kind === 'sand' ? (headDown || v > 9 ? 'sandHead' : upright ? 'stand' : 'sandSit') : (upright ? 'stand' : 'flat')
  m.y = 0.55; m.mode = 'down'; m.pose = pose; m.landX = m.x
  m.countMiss = last > 0
  m.downT = last > 0 ? (fromH > 10 ? 2.1 : 1.7) : 1.15
  w.phase = 'down'
  const rec = { kind, pose, h: +fromH.toFixed(1), from: last }
  if (last > 0) w.falls.push(rec)
  w.ev.push({ t: 'land', ...rec, v })
}
function end(w, why) { if (w.phase === 'over') return; w.phase = 'over'; w.why = why; w.ev.push({ t: 'over', why }) }
// 手を押していない時の「あと何cm」は step の後で呼ぶ
const _step = step
function stepAll(w, inp) {
  _step(w, inp)
  if (w.phase === 'air' && !w.inp.hand) {
    nearNoHand(w)
    const m = w.me
    for (const k in m.near) {
      if (k[0] !== 'n' || m.near[k] < 0) continue
      const s = w.swings[+k.slice(1)]
      const dd = distToChain(m.hx, m.hy, s)
      if (dd > m.near[k] + 0.06) { w.ev.push({ t: 'near', si: s.i, cm: Math.max(1, Math.round((m.near[k] - P.reach) * 100) + 1), nohand: true }); m.near[k] = -1 }
    }
  }
}
// 今の状態から、離したら手がどこを通るかを先読みする（練習のブランコの点線と bot が使う）
function predict(w, sec = 1.4, tuck = false) {
  const m = w.me
  if (m.mode !== 'swing') return []
  const om = m.h / (m.L * m.L)
  let x = m.x, y = m.y, vx = m.L * om * Math.cos(m.th), vy = m.L * om * Math.sin(m.th), phi = m.th
  const spin = om * (tuck ? P.tuck : 1)
  const out = []
  const n = Math.round(sec / DT)
  for (let i = 0; i < n; i++) {
    vy -= GR * DT; x += vx * DT; y += vy * DT; phi += spin * DT
    const arm = tuck ? P.armTuck : P.armExt
    out.push({ x: x - Math.sin(phi) * arm, y: y + Math.cos(phi) * arm, cx: x, cy: y, phi })
  }
  return out
}
// 予測の手の通り道が、ブランコ j の鎖にどれだけ近づくか（逆さまでないことも見る）
function predictHit(w, j, path) {
  const s = w.swings[j]
  if (!s) return { d: 9 }
  let best = { d: 9, k: -1 }
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1], b = path[k]
    const tt = (k + 1) * DT
    const th = s.amp ? s.th + s.om * tt : s.th   // 先の揺れは近似
    const ax = s.x + P.topGap * Math.sin(th), ay = s.y - P.topGap * Math.cos(th)
    const bx = s.x + (s.C + 0.12) * Math.sin(th), by = s.y - (s.C + 0.12) * Math.cos(th)
    const [d, u] = segSeg(a.x, a.y, b.x, b.y, ax, ay, bx, by)
    if (d < best.d) {
      const gx = ax + (bx - ax) * u, gy = ay + (by - ay) * u
      const want = Math.atan2(-(gx - b.cx), gy - b.cy)
      best = { d, k, off: Math.abs(wrapA(b.phi - want)) }
    }
  }
  return best
}
function clone(w) { const c = JSON.parse(JSON.stringify(w, (k, v) => k === 'R' ? undefined : v)); c.R = rng(w.seed + w.swings.length * 7919); return c }
const API = { DT, GR, P, makeWorld, step: stepAll, predict, predictHit, groundAt, bandOf, BANDS, seatOf, clone, placeOn }
if (typeof module !== 'undefined' && module.exports) module.exports = API
else root.SS_PHYS = API
})(typeof window !== 'undefined' ? window : globalThis)
