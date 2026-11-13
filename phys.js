// 天空ブランコ（sky-swing）の物理。固定60Hz（step 1回 = 1/60秒）。乱数はコースを作る時の種だけ。
// 同じ種・同じ入力（1コマごとの body/hand）なら同じ結果になる。ブラウザでも Node でも動く（sim は Node で回す）
// 仕様の正本: ~/Desktop/claudecode/ideas/sky-swing.md
;(function (root) {
'use strict'
const DT = 1 / 60, GR = 9.8
// 調整値（sim で決めた）。2026-11-13 v2: 操作は左右の2ボタンだけ（揺れている向きに押すと大きくなる・届く所で勝手に飛ぶ）
const P = {
  squat: 0.45,                // 座面から重心までの高さ（座っている）
  push: 3.0,                  // 押している間の横向きの力（m/秒²）。揺れている向きに押すと振れが増え、逆だと減る
  maxA: 1.5,                  // これより大きくは振れない（鎖がたるむ手前）
  damp: 0.3,                  // 押さないと振れが小さくなる（でたらめに押しても大きくならない強さ）
  armExt: 0.92, armTuck: 0.5, // 重心から手まで（伸びた時 / 丸まった時。丸まりは v2 で使わない）
  topGap: 0.05,               // 吊り元のすぐ下は掴めない（梁にぶつかる）
  reach: 0.42,                // 手が鎖にどれだけ近ければつかめるか
  aim: 0.2,                   // 先読みの手が次の鎖にこれだけ近づいたら、勝手に手を離す
  near: 0.42,                 // 「あと何cm」を出す近さ（reach の外側）
  air: 5,                     // 空中で左右を押した時に寄る強さ（m/秒²）
  still: true,                // 勝手に揺れるブランコを「今の位置」で狙う（ずれは空中で寄せる）
  fallBelow: 5.5,             // 最後に乗ったブランコの座面からこれだけ落ちたら落下
  idle: 25,                   // 何もしないで25秒たつと管理人が来る
  hang: 0.45,                 // つかんでから、これだけは勝手に離さない
  grabLoss: 0.86,             // つかんだ瞬間に勢いが少し減る
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

// ブランコ p から、横 ox・上 oy・鎖の長さ C の鎖へ、7割の力で漕いだら手がどこまで近づくか（止まっている鎖として）
function reachD(p, ox, oy, C) {
  const L = p.C - P.squat, tw = Math.sign(ox) || 1
  let th = -tw * 0.42, h = 0, best = 9
  const ax = p.x + ox + P.topGap * 0, ay = p.y + oy - P.topGap, bx = p.x + ox, by = p.y + oy - C - 0.12
  for (let i = 0; i < 60 * 30 && best > P.aim * 0.3; i++) {
    let om = h / (L * L)
    const d = Math.sign(om) || tw
    h += (-GR * L * Math.sin(th) + d * P.push * 0.7 * L * Math.cos(th)) * DT   // 人の遅れぶん弱めに漕いでも届くこと
    h *= (1 - P.damp * DT)
    om = h / (L * L); th += om * DT
    if (Math.abs(th) > P.maxA) { th = Math.sign(th) * P.maxA; if (Math.sign(om) === Math.sign(th)) { h = 0; om = 0 } }
    if (i % 3 || Math.sign(om) !== tw || Math.abs(om) < 0.3) continue
    let x = p.x + L * Math.sin(th), y = p.y - L * Math.cos(th), vx = L * om * Math.cos(th), vy = L * om * Math.sin(th)
    let hx0 = x - Math.sin(th) * P.armExt, hy0 = y + Math.cos(th) * P.armExt
    for (let k = 0; k < 90; k++) {
      vy -= GR * DT; x += vx * DT; y += vy * DT
      if (y <= 0.55) break
      const hx = x - Math.sin(th) * P.armExt, hy = y + Math.cos(th) * P.armExt
      const dd = segSeg(hx0, hy0, hx, hy, ax, ay, bx, by)[0]
      if (dd < best) best = dd
      hx0 = hx; hy0 = hy
    }
  }
  return best
}
function genNext(w) {
  const s = w.swings, i = s.length, R = w.R
  if (i === 0) { s.push({ i: 0, x: 0, y: 2.35, C: 1.95, amp: 0, ph: 0, band: 'park', dir: 1, th: 0, om: 0 }); return }
  const p = s[i - 1]
  const dir = i === 1 ? 1 : (R() < 0.66 ? p.dir : -p.dir)
  const k = Math.min(i, 30)
  let dx = i === 1 ? 2.6 : 2.45 + R() * 0.75 + k * 0.008
  let dy = i === 1 ? 0.9 : 0.8 + R() * 0.6 + k * 0.01
  const C = i === 1 ? 1.95 : 1.75 + R() * 0.55
  // v2: 漕ぐだけで必ず届く所に置く（届かなければ少しずつ近づける）
  for (let tr = 0; tr < 8 && reachD(p, dir * dx, dy, C) > P.aim * 0.6; tr++) { dx *= 0.94; dy *= 0.9 }
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
    lastIn: 0, inp: { L: false, R: false }, tut: true, windT: 0,
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

// 1コマ進める。inp = { L, R }（押している間 true）
const dirOf = inp => (inp.R ? 1 : 0) - (inp.L ? 1 : 0)
function step(w, inp) {
  const m = w.me, ev = w.ev
  if (w.phase === 'over') return
  if (!!inp.L !== w.inp.L || !!inp.R !== w.inp.R) w.lastIn = w.t
  w.inp = { L: !!inp.L, R: !!inp.R }
  const dir = dirOf(w.inp)
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
    if (dir) { w.phase = 'swing'; ev.push({ t: 'hold' }) }
    else { if (w.t - w.lastIn > P.idle) end(w, 'closing'); syncPos(w); return }
  }
  if (w.phase === 'swing') {
    const s = w.swings[m.si]
    m.L = s.C - P.squat
    // 横向きに押す: 接線の向きの成分だけ効く（揺れている向きなら増え、逆なら減る）
    m.h += (-GR * m.L * Math.sin(m.th) + dir * P.push * m.L * Math.cos(m.th)) * DT
    m.h *= (1 - P.damp * DT)
    let om = m.h / (m.L * m.L)
    const th0 = m.th
    m.th += om * DT
    // 振れの上限（鎖がたるむ手前で止まって戻る）
    if (Math.abs(m.th) > P.maxA) { m.th = Math.sign(m.th) * P.maxA; if (Math.sign(om) === Math.sign(m.th)) { m.h = 0; om = 0 } }
    m.dL = 0; m.push = dir
    // 端で向きが変わった時にきしむ
    const sg = Math.sign(om)
    if (sg && m.lastSgn && sg !== m.lastSgn && Math.abs(th0) > 0.25) ev.push({ t: 'creak', amp: Math.abs(th0) })
    if (sg) m.lastSgn = sg
    s.th = m.th; s.om = om
    m.tk = 0
    syncPos(w)
    // 次の鎖に向かって押していて、今離せば手が届くと見えたら、勝手に手を離す
    const nx = w.swings[m.si + 1]
    if (nx && dir && dir === Math.sign(nx.x - s.x) && Math.sign(om) === dir && (w.tick % 2 === 0)) {
      // 勝手に揺れているブランコは「今の位置」で見るので、ずれた分は空中で左右に寄せる
      const hit = predictHit(w, m.si + 1, predict(w, 1.5), P.still)
      if (hit.d < P.aim && w.t - (m.grabT || -9) > P.hang) { release(w); return }
    }
    if (w.t - w.lastIn > P.idle) end(w, 'closing')
  } else if (w.phase === 'air' || w.phase === 'fall') {
    const hx0 = m.hx, hy0 = m.hy
    m.vy -= GR * DT
    if (w.phase === 'air') m.vx += (windAt(w, m.y) + dir * P.air) * DT
    else { const sp = Math.hypot(m.vx, m.vy); m.vx -= m.vx * sp * P.drag * DT; m.vy -= m.vy * sp * P.drag * DT }
    m.x += m.vx * DT; m.y += m.vy * DT
    m.tk = 0
    // 空中では体は回らない（離した時の向きのまま手を伸ばす。先読みと同じ動き）
    if (w.phase === 'fall') m.phi += m.spin * DT
    m.peakY = Math.max(m.peakY, m.y)
    syncPos(w)
    if (w.phase === 'air') {
      tryGrab(w, hx0, hy0)
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
}

function release(w) {
  const m = w.me, s = w.swings[m.si]
  const om = m.h / (m.L * m.L)
  m.vx = m.L * om * Math.cos(m.th)
  m.vy = m.L * om * Math.sin(m.th)
  m.phi = m.th; m.spin = om * 0.6; m.tk = 0; m.Lb = 0
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
    if (s.i <= m.relFrom) continue   // 離したブランコと、それより下のブランコは掴まない（v2: 進む向きだけ）
    const st = seatOf(s)
    // 鎖の上（吊り元の少し下）から、座面の少し先まで
    const ax = s.x + P.topGap * Math.sin(s.th), ay = s.y - P.topGap * Math.cos(s.th)
    const bx = s.x + (s.C + 0.12) * Math.sin(s.th), by = s.y - (s.C + 0.12) * Math.cos(s.th)
    const [d, u] = segSeg(hx0, hy0, m.hx, m.hy, ax, ay, bx, by)
    if (d < P.reach) {
      const gx = ax + (bx - ax) * u, gy = ay + (by - ay) * u
      if (!best || d < best.d) best = { s, d, gx, gy, u }
    } else if (d < P.reach + P.near && s.i === m.relFrom + 1) {   // 「あと何cm」は狙った次の鎖だけ
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
function attach(w, b) {
  const m = w.me, s = b.s
  const rx = m.x - s.x, ry = m.y - s.y
  let L = Math.hypot(rx, ry)
  const th = Math.atan2(rx, -ry)
  let h = (rx * m.vy - ry * m.vx) * P.grabLoss
  const om = h / (L * L)
  L = clamp(L, 0.7, s.C + 0.6)
  h = om * L * L
  Object.assign(m, { mode: 'swing', si: s.i, th, h, L, tk: 0, lastSgn: 0, grabT: w.t })
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
const stepAll = step
// 今の状態から、離したら手がどこを通るかを先読みする（練習のブランコの点線と bot が使う）
function predict(w, sec = 1.4) {
  const m = w.me
  if (m.mode !== 'swing') return []
  const om = m.h / (m.L * m.L)
  let x = m.x, y = m.y, vx = m.L * om * Math.cos(m.th), vy = m.L * om * Math.sin(m.th), phi = m.th
  const spin = 0
  const out = []
  const n = Math.round(sec / DT)
  for (let i = 0; i < n; i++) {
    vy -= GR * DT; x += vx * DT; y += vy * DT; phi += spin * DT
    if (y <= 0.55) break   // 地面に着いたら、その先は無い
    const arm = P.armExt
    out.push({ x: x - Math.sin(phi) * arm, y: y + Math.cos(phi) * arm, cx: x, cy: y, phi })
  }
  return out
}
// 予測の手の通り道が、ブランコ j の鎖にどれだけ近づくか（逆さまでないことも見る）
function predictHit(w, j, path, still = false) {
  const s = w.swings[j]
  if (!s) return { d: 9 }
  let best = { d: 9, k: -1 }
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1], b = path[k]
    const tt = (k + 1) * DT
    const th = s.amp && !still ? s.th + s.om * tt : s.th   // 先の揺れは近似（still: 今の位置のまま）
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
// 空中で、今のまま飛んだら手がどこを通るか（bot が左右に寄せるのに使う）
function predictAir(w, sec = 0.8) {
  const m = w.me
  let x = m.x, y = m.y, vx = m.vx, vy = m.vy, phi = m.phi
  const out = [], n = Math.round(sec / DT)
  for (let i = 0; i < n; i++) { vy -= GR * DT; vx += windAt(w, y) * DT; x += vx * DT; y += vy * DT; if (y <= 0.55) break; out.push({ x: x - Math.sin(phi) * P.armExt, y: y + Math.cos(phi) * P.armExt, cx: x, cy: y, phi }) }
  return out
}
function clone(w) { const c = JSON.parse(JSON.stringify(w, (k, v) => k === 'R' ? undefined : v)); c.R = rng(w.seed + w.swings.length * 7919); return c }
const API = { DT, GR, P, makeWorld, step: stepAll, predict, predictAir, predictHit, windAt, dirOf, groundAt, bandOf, BANDS, seatOf, clone, placeOn }
if (typeof module !== 'undefined' && module.exports) module.exports = API
else root.SS_PHYS = API
})(typeof window !== 'undefined' ? window : globalThis)
