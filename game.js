// 天空ブランコ（sky-swing）。体ボタンで漕いで、手ボタンを離して飛び、次のブランコの鎖をつかんで登る
// 物理は phys.js（固定60Hz）。ここは入力・演出・描画・画面。仕様の正本: ~/Desktop/claudecode/ideas/sky-swing.md
;(() => {
'use strict'
window.__jsUp = true
const D = SS_DATA, PH = SS_PHYS, P = PH.P, DT = PH.DT
const $ = s => document.querySelector(s)
const on = (s, f) => $(s).addEventListener('click', f)
const isJa = () => (navigator.language || 'ja').toLowerCase().startsWith('ja')
let lang = 'ja'
try { lang = localStorage.getItem('ss_lang') || (isJa() ? 'ja' : 'en') } catch (e) { lang = isJa() ? 'ja' : 'en' }
const T = () => D.TXT[lang]
const clamp = (v, a, b) => v < a ? a : v > b ? b : v
const lerp = (a, b, k) => a + (b - a) * k
// 演出用の乱数（物理とは別。結果に関わらない）
let fxSeed = 12345
const FR = () => (fxSeed = fxSeed * 16807 % 2147483647) / 2147483647
const pick = a => a[Math.floor(FR() * a.length)]

// ---- 音（録音素材） ----
const N = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1))
Snd.def({
  creak: N(3, i => `snd/creak${i}.mp3`), clank: N(3, i => `snd/clank${i}.mp3`), swish: N(3, i => `snd/swish${i}.mp3`),
  thud: N(3, i => `snd/thud${i}.mp3`), splat: ['snd/splat1.mp3', 'snd/splat2.mp3'], fall: ['snd/fall1.mp3', 'snd/fall2.mp3'], splash: ['snd/splash1.mp3', 'snd/splash2.mp3'],
  giggle: 'snd/giggle.mp3', flap: 'snd/flap.mp3', whistle: 'snd/whistle.mp3', click: 'snd/click.mp3',
  jgood: 'snd/jgood.mp3', jmeh: 'snd/jmeh.mp3', jrare: 'snd/jrare.mp3', jover: 'snd/jover.mp3',
})
const LOOPS = { bgmT: 'snd/bgm_title.mp3', bgm: 'snd/bgm_play.mp3', park: 'snd/amb_park.mp3', wind: 'snd/amb_wind.mp3' }
let muted = false
try { muted = localStorage.getItem('ss_mute') === '1' } catch (e) {}
Snd.setMute(muted)
const sfx = (n, o) => Snd.play(n, o)
function loopVol(slot, v, tc = 0.2) { const l = Snd.loops[slot]; if (l && l.g && Snd.ctx) { l.g.gain.cancelScheduledValues(Snd.ctx.currentTime); l.g.gain.setTargetAtTime(Math.max(0.0001, v), Snd.ctx.currentTime, tc) } }
const loopsOn = {}
function loop(slot, vol) { if (vol == null) { if (loopsOn[slot]) { Snd.loop(slot, null); loopsOn[slot] = 0 } return } if (!loopsOn[slot]) { Snd.loop(slot, LOOPS[slot], vol); loopsOn[slot] = 1 } else loopVol(slot, vol) }
function allLoopsOff() { for (const k in loopsOn) loop(k, null) }

// ---- 画面 ----
const cv = $('#cv'), cx = cv.getContext('2d')
let W = 390, H = 844, DPR = 1
function resize() {
  const r = cv.getBoundingClientRect()
  W = Math.max(240, r.width || innerWidth); H = Math.max(320, r.height || innerHeight)
  DPR = Math.min(2, window.devicePixelRatio || 1)
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR)
  sizeTitleArt()
}
addEventListener('resize', () => { resize(); if (G.scene === 'end') drawRes() })
const padTop = () => { const p = $('#pBody').getBoundingClientRect(); return p.height ? p.top - cv.getBoundingClientRect().top - 24 : H - 150 }

// ---- 状態 ----
let w = PH.makeWorld(1)
const G = window.__ssG = {
  scene: 'title', paused: false, cam: { x: 0, y: 3, s: 60 }, fx: [], lines: [], shake: 0, flash: 0, hitstop: 0, slowT: 0, slowOnce: false,
  bub: null, bubNext: 0, popUntil: 0, amp: 0, curMax: 0, lastSgn: 0, face: 1, tutOn: false, tutStep: '', tutDoneT: 0, selfBest: 0,
  prev: null, alpha: 1, bot: null, inp: { body: false, hand: false }, shownBest: 0, mile: 0, endAt: 0, ended: false, warned: false,
  saidStart: false, flipsShown: 0, nPigeon: 0, flyBirds: [], lastLand: null, result: null, demo: false, seed: 1,
}
const INK = '#1f2433'

// ---- 入力（2つの座面ボタン・F/J） ----
const pads = { body: $('#pBody'), hand: $('#pHand') }
const held = { body: new Set(), hand: new Set() }
function setPad(k) { const v = held[k].size > 0; G.inp[k] = v; pads[k].classList.toggle('on', v) }
for (const k of ['body', 'hand']) {
  const el = pads[k]
  el.addEventListener('pointerdown', e => { e.preventDefault(); Snd.init(); held[k].add(e.pointerId); try { el.setPointerCapture(e.pointerId) } catch (er) {} setPad(k) })
  const up = e => { held[k].delete(e.pointerId); setPad(k) }
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up)
}
const KEYS = { f: 'body', j: 'hand' }
addEventListener('keydown', e => { const k = KEYS[(e.key || '').toLowerCase()]; if (!k || G.scene !== 'play') return; e.preventDefault(); Snd.init(); held[k].add('key'); setPad(k) })
addEventListener('keyup', e => { const k = KEYS[(e.key || '').toLowerCase()]; if (!k) return; held[k].delete('key'); setPad(k) })
addEventListener('blur', () => { for (const k of ['body', 'hand']) { held[k].clear(); setPad(k) } })

// ---- 1コマ（固定60Hz） ----
function snap() {
  const m = w.me, sw = {}
  for (const s of w.swings) sw[s.i] = s.th
  return { mode: m.mode, si: m.si, x: m.x, y: m.y, phi: m.phi, tk: m.tk, L: m.L, th: m.th, sw }
}
function tick() {
  G.prev = snap()
  const inp = G.bot ? G.bot(w) : G.inp
  if (G.bot && G.demo) syncDemoPads(inp)
  PH.step(w, inp)
  if (G.trace) G.trace.push(w.tick + ':' + w.me.x.toFixed(6) + ',' + w.me.y.toFixed(6) + ',' + w.phase)
  trackAmp()
  for (const e of w.ev) onEvent(e)
  w.ev.length = 0
  nearSlow()
  stepFx()
  if (w.phase === 'over' && !G.ended) { G.ended = true; G.endAt = w.t + (w.why === 'closing' ? 1.6 : 1.1) }
  if (G.ended && w.t >= G.endAt && G.scene === 'play') showEnd()
  else if (G.ended && G.scene === 'play') w.t += 0   // over の後は物理が止まるので、時計だけ進める
}
// over の後も演出の時計を進める
function tickOver() { G.prev = snap(); w.tick++; w.t = w.tick * DT; stepFx(); if (w.t >= G.endAt && G.scene === 'play') showEnd() }

function trackAmp() {
  const m = w.me
  if (m.mode !== 'swing') { G.amp = 0; G.curMax = 0; G.lastSgn = 0; return }
  const om = m.h / (m.L * m.L), sg = Math.sign(om)
  G.curMax = Math.max(G.curMax, Math.abs(m.th))
  if (sg && G.lastSgn && sg !== G.lastSgn) { G.amp = G.curMax; G.curMax = 0 }
  if (sg) G.lastSgn = sg
}
// 鎖まであと少しで届かない時だけ、少しのあいだスローにする
function nearSlow() {
  const m = w.me
  if (w.phase !== 'air' || G.slowOnce) return
  const path = []
  let x = m.x, y = m.y, vx = m.vx, vy = m.vy, phi = m.phi
  const arm = P.armExt + (P.armTuck - P.armExt) * m.tk
  for (let i = 0; i < 20; i++) { vy -= PH.GR * DT; x += vx * DT; y += vy * DT; phi += m.spin * DT; path.push({ x: x - Math.sin(phi) * arm, y: y + Math.cos(phi) * arm, cx: x, cy: y, phi }) }
  for (const s of w.swings) {
    if (s.i === m.relFrom || Math.abs(s.x - m.x) > 4 || Math.abs(s.y - m.y) > 5) continue
    const h = PH.predictHit(w, s.i, path)
    if (h.d > P.reach && h.d < P.reach + 0.28) { G.slowOnce = true; G.slowT = 0.55; return }
  }
}

// ---- 出来事から音・演出・ひとことへ ----
const groundVisible = () => worldToScreen(0, 0)[1] < H - 40
function onEvent(e) {
  const t = T(), m = w.me
  switch (e.t) {
    case 'hold':
      if (!G.saidStart && w.bestIdx === 0) { G.saidStart = true; G.bubNext = w.t + 2.5 }
      break
    case 'creak': if (e.amp > 0.5) sfx('creak', { vol: clamp(e.amp / 2.2, 0.15, 0.55) }); if (e.amp > 1.6 && w.me.si === 0 && FR() < 0.4) kidSay(t.kid.big); break
    case 'release': {
      sfx('swish', { vol: clamp(e.v / 9, 0.3, 1), rate: 0.85 + FR() * 0.2 })
      G.slowOnce = false
      const sw = w.swings[e.si + 1]; if (sw) G.face = Math.sign(sw.x - w.swings[e.si].x) || G.face
      if (e.si === 0 && FR() < 0.5) kidSay(t.kid.release)
      break
    }
    case 'grab': {
      sfx('clank', { vol: 0.7 }); G.hitstop = 0.06; G.shake = Math.max(G.shake, 0.35); G.flash = 0.6
      const s = w.swings[e.si]
      burst(s.x + s.C * 0.4 * Math.sin(s.th), s.y - s.C * 0.4 * Math.cos(s.th), 'spark', 8)
      const nx = w.swings[e.si + 1]; if (nx) G.face = Math.sign(nx.x - s.x) || G.face
      if (e.pigeon) { sfx('flap', { vol: 0.6 }); G.flyBirds.push({ x: s.x + s.C * Math.sin(s.th), y: s.y - s.C * Math.cos(s.th) + 0.15, vx: (FR() - 0.5) * 3, vy: 2.5, t: 0 }); sayAt(pick(t.pigeon), s.x, s.y - s.C + 0.6, 1.2) }
      if (e.up) {
        if (G.selfBest > 0.5 && e.h > G.selfBest && G.shownBest <= G.selfBest) { pop(t.newBest, 'good'); sfx('jrare', { vol: 0.5 }) }
        else if (e.d < 0.08) pop(t.nice, 'good')
        const ml = D.MILES[G.mile]; if (ml && e.h >= ml.y) { G.mile++; if (G.popUntil < realT) pop(ml[lang], 'good') }
        G.shownBest = Math.max(G.shownBest, e.h)
        if (e.first) { kidSay(t.kid.grab); if (G.tutOn) { G.tutStep = 'done'; G.tutDoneT = realT + 2.4; try { localStorage.setItem('ss_tut', '1') } catch (er) {} } }
        else if (!e.pigeon) bandSay(s)
      }
      bumpHud()
      break
    }
    case 'near': if (e.cm <= 45) pop(t.near(e.cm), 'bad'); break
    case 'upside': pop(t.upside, 'bad'); break
    case 'slip': pop(t.slip, 'bad'); sfx('clank', { vol: 0.4, rate: 1.3 }); break
    case 'loop': pop(t.loop, 'good'); sfx('swish', { vol: 1, rate: 0.7 }); kidSay(t.kid.loop); break
    case 'flip': if (G.flipsShown++ < 3) pop(t.flip, 'good'); break
    case 'fallStart': sfx('swish', { vol: 1, rate: 0.6 }); if (FR() < 0.5) saySelf(pick([t.me[1], t.me[0]])); break
    case 'land': {
      const k = e.pose
      if (e.kind === 'pond') { sfx('splash', { vol: 1 }); burst(m.x, 0.3, 'water', 26) }
      else if (e.kind === 'bush') { sfx('thud', { vol: 0.9 }); burst(m.x, 0.7, 'leaf', 20) }
      else { sfx(e.v > 9 ? 'splat' : 'thud', { vol: 1 }); burst(m.x, 0.2, e.kind === 'sand' ? 'sand' : 'grass', 22) }
      G.shake = Math.max(G.shake, e.h > 8 ? 1 : 0.55)
      G.lastLand = { ...e, x: m.x }
      if (e.from > 0) pop(D.FALLS[k][lang], k === 'stand' ? 'good' : 'bad')
      setTimeout(() => sfx('giggle', { vol: 0.35 }), 250)
      const kk = k === 'sandHead' || k === 'sandSit' ? 'sand' : k
      if (t.kid[kk]) kidSay(t.kid[kk], true)
      break
    }
    case 'miss': {
      drawShoes(); G.shoeFly = { x: m.landX ?? m.x, y: 0.6, vx: (FR() < 0.5 ? -1 : 1) * 3.5, vy: 7, r: 0, t: 0 }
      setTimeout(() => kidSay(T().kid.shoe, true), 700)
      break
    }
    case 'respawn': G.slowOnce = false; G.amp = 0; G.curMax = 0; break
    case 'over':
      if (e.why === 'closing') { sfx('whistle', { vol: 0.8 }); pop(t.closing, 'bad') }
      else sfx('jover', { vol: 0.5, delay: 0.4 })
      break
  }
}

// ---- 演出 ----
function burst(x, y, kind, n) {
  const col = { spark: '#fff2b0', sand: '#e6cf98', grass: '#7fbf5e', water: '#bfe6ff', leaf: '#5d9e45' }[kind]
  for (let i = 0; i < n; i++) {
    const a = FR() * Math.PI * (kind === 'spark' ? 2 : 1), sp = (kind === 'spark' ? 2.5 : 3.5) + FR() * 3
    G.fx.push({ x, y, vx: Math.cos(a) * sp * (kind === 'spark' ? 1 : 0.8), vy: Math.sin(a) * sp, life: 0.5 + FR() * 0.5, t: 0, col, r: kind === 'spark' ? 0.04 : 0.06 + FR() * 0.05, g: kind === 'spark' ? 2 : 9.8 })
  }
}
function stepFx() {
  for (const f of G.fx) { f.t += DT; f.vy -= f.g * DT; f.x += f.vx * DT; f.y += f.vy * DT; if (f.y < 0.02 && f.g > 5) { f.y = 0.02; f.vy *= -0.2; f.vx *= 0.6 } }
  G.fx = G.fx.filter(f => f.t < f.life)
  for (const b of G.flyBirds) { b.t += DT; b.vy += 1.5 * DT; b.x += b.vx * DT; b.y += b.vy * DT }
  G.flyBirds = G.flyBirds.filter(b => b.t < 3)
  if (G.shoeFly) { const s = G.shoeFly; s.t += DT; s.vy -= 9.8 * DT; s.x += s.vx * DT; s.y += s.vy * DT; s.r += 12 * DT; if (s.y < 0.05) { s.y = 0.05; s.vy = 0; s.vx *= 0.8 } if (s.t > 2.5) G.shoeFly = null }
}
let realT = 0
function sayAt(text, wx, wy, sec = 1.6, me = false) { if (G.popUntil > realT) return; G.bub = { text, wx, wy, until: realT + Math.max(sec, 0.9 + text.length * 0.09), me }; G.bubNext = realT + 4 }
function kidSay(list, force) {
  if (!force && realT < G.bubNext) return
  if (!groundVisible()) return
  const k = KIDS[Math.floor(FR() * KIDS.length)]
  sayAt(pick(list), k.x, 1.45)
}
function saySelf(text) { const m = w.me; sayAt(text, m.x, m.y + 1.0, 1.6, true) }
function bandSay(s) {
  if (realT < G.bubNext || FR() < 0.45) return
  const t = T()
  if (s.band === 'park') return kidSay(t.kid.grab)
  if (FR() < 0.2) return saySelf(pick(t.me))
  const list = t.who[s.band]; if (!list) return
  const a = speakerOf(s)
  sayAt(pick(list), a[0], a[1])
}
function pop(text, cls = '', sec = 1.25) {
  const el = $('#pop'); el.textContent = text; el.className = ''; void el.offsetWidth; el.className = 'on ' + cls
  G.popUntil = realT + sec
  if (G.bub && G.bub.until > realT) G.bub.until = realT   // 文字は同時に1つまで
}
function bumpHud() {
  const el = $('#hN'); el.innerHTML = `${w.best.toFixed(1)}<small>${T().unit}</small>`
  el.animate && el.animate([{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' })
}
const SHOE = (gone) => `<svg viewBox="0 0 34 24" class="${gone ? 'gone' : ''}"><path d="M3 15c0-4 2-7 6-8l3 3c3 1 7 1 10 0l4-1c3 0 6 2 6 5v2c0 2-1 3-3 3H5c-1 0-2-1-2-2z" fill="${gone ? '#d9d4c7' : '#1d1d1f'}" stroke="#1f2433" stroke-width="2" stroke-linejoin="round"/><path d="M5 19h26" stroke="${gone ? '#b7b0a0' : '#4a4a50'}" stroke-width="2"/></svg>`
function drawShoes() { $('#hShoes').innerHTML = [0, 1].map(i => SHOE(i < w.misses)).join('') }

// ---- カメラ ----
function worldToScreen(x, y) { return [W / 2 + (x - G.cam.x) * G.cam.s + G.shx, G.cy - (y - G.cam.y) * G.cam.s + G.shy] }
G.shx = 0; G.shy = 0; G.cy = H * 0.42
function camTarget() {
  const m = w.me
  const playH = padTop()
  const base = Math.min(W / 7.2, playH / 9.5)
  let xs = [], ys = []
  const addSw = s => { if (!s) return; xs.push(s.x - s.C * 0.8, s.x + s.C * 0.8); ys.push(s.y + 0.6, s.y - s.C - 0.3) }
  if (w.phase === 'down' || (w.phase === 'over' && m.mode === 'down')) {
    return { x: m.landX ?? m.x, y: 2.2, s: base * 1.1 }
  }
  if (w.phase === 'fall') return { x: m.x, y: m.y - 1, s: base * 0.85 }
  if (m.mode === 'swing') { const s = w.swings[m.si]; addSw(s); addSw(w.swings[m.si + 1]); if (m.si === 0) { xs.push(-3.6, 4.3); ys.push(-0.2) } }
  else { addSw(w.swings[m.relFrom]); addSw(w.swings[m.relFrom + 1]); xs.push(m.x); ys.push(m.y) }
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const s = clamp(Math.min((W - 30) / (x1 - x0), (playH * 0.86) / (y1 - y0)), base * 0.62, base * 1.15)
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 - 0.2, s }
}
function camStep(dt) {
  G.cy = padTop() * 0.5
  const tg = camTarget(), k = 1 - Math.exp(-dt * (w.phase === 'fall' ? 7 : 3.2))
  G.cam.x = lerp(G.cam.x, tg.x, k); G.cam.y = lerp(G.cam.y, tg.y, k); G.cam.s = lerp(G.cam.s, tg.s, 1 - Math.exp(-dt * 2.2))
  G.shake = Math.max(0, G.shake - dt * 2.4)
  const a = G.shake * 7
  G.shx = (Math.random() - 0.5) * a; G.shy = (Math.random() - 0.5) * a
}

// ---- 描画 ----
// 空の色（高さで変わる）
const SKY = [[0, '#86c6ee', '#d6eef8'], [22, '#64ade6', '#b4dbf3'], [40, '#4888d2', '#93c3ec'], [62, '#2b57a6', '#6a9ad6'], [90, '#122450', '#35558f'], [130, '#05091a', '#16244c']]
function mixHex(a, b, k) { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16); const r = (pa >> 16) + (((pb >> 16) - (pa >> 16)) * k), g = ((pa >> 8) & 255) + ((((pb >> 8) & 255) - ((pa >> 8) & 255)) * k), bl = (pa & 255) + (((pb & 255) - (pa & 255)) * k); return `rgb(${r | 0},${g | 0},${bl | 0})` }
function skyAt(y) { for (let i = 0; i < SKY.length - 1; i++) { const a = SKY[i], b = SKY[i + 1]; if (y < b[0]) { const k = (y - a[0]) / (b[0] - a[0]); return [mixHex(a[1], b[1], k), mixHex(a[2], b[2], k)] } } return [SKY[SKY.length - 1][1], SKY[SKY.length - 1][2]] }
const STARS = Array.from({ length: 70 }, (_, i) => [((i * 137.5) % 100) / 100, ((i * 61.8) % 100) / 100, 0.6 + (i % 3) * 0.5])
const BLD = Array.from({ length: 26 }, (_, i) => ({ x: i * 3.1 + ((i * 7) % 5) * 0.4 - 40, w: 2 + ((i * 3) % 4) * 0.6, h: 4 + ((i * 11) % 9) * 1.3 + (i % 5 === 0 ? 6 : 0), c: i % 3 }))
const CLOUDS = Array.from({ length: 18 }, (_, i) => ({ x: ((i * 7.3) % 40) - 20, y: 22 + i * 4.2 + ((i * 5) % 3) * 1.5, r: 1.6 + (i % 4) * 0.6, p: 0.55 + (i % 3) * 0.12 }))
const KIDS = [{ x: 3.55, h: 1.05, c: '#e45b4c', hat: '#f2c230' }, { x: 4.05, h: 1.2, c: '#3d8fd6', hat: null }, { x: -2.35, h: 0.95, c: '#f29bb8', hat: '#ffffff' }]

function rr(c, x, y, ww, hh, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + ww, y, x + ww, y + hh, r); c.arcTo(x + ww, y + hh, x, y + hh, r); c.arcTo(x, y + hh, x, y, r); c.arcTo(x, y, x + ww, y, r); c.closePath() }
// 世界座標で太い線（黒い縁つき）
function seg(c, x1, y1, x2, y2, wd, col, ink = true) {
  const [a, b] = worldToScreen(x1, y1), [p, q] = worldToScreen(x2, y2), s = G.cam.s
  c.lineCap = 'round'; c.lineJoin = 'round'
  if (ink) { c.strokeStyle = INK; c.lineWidth = wd * s + 3.2; c.beginPath(); c.moveTo(a, b); c.lineTo(p, q); c.stroke() }
  c.strokeStyle = col; c.lineWidth = wd * s; c.beginPath(); c.moveTo(a, b); c.lineTo(p, q); c.stroke()
}
function poly(c, pts, fill, ink = true, lw = 2.5) { c.beginPath(); pts.forEach(([x, y], i) => { const [a, b] = worldToScreen(x, y); i ? c.lineTo(a, b) : c.moveTo(a, b) }); c.closePath(); c.fillStyle = fill; c.fill(); if (ink) { c.strokeStyle = INK; c.lineWidth = lw; c.stroke() } }
function circ(c, x, y, r, fill, ink = true, lw = 2.5) { const [a, b] = worldToScreen(x, y); c.beginPath(); c.arc(a, b, Math.max(0.5, r * G.cam.s), 0, Math.PI * 2); c.fillStyle = fill; c.fill(); if (ink) { c.strokeStyle = INK; c.lineWidth = lw; c.stroke() } }

function drawSky(c) {
  const [top, bot] = skyAt(G.cam.y + 4)
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, top); g.addColorStop(1, bot)
  c.fillStyle = g; c.fillRect(0, 0, W, H)
  // 太陽（右上・光）
  const sg = c.createRadialGradient(W * 0.86, H * 0.1, 4, W * 0.86, H * 0.1, W * 0.55)
  sg.addColorStop(0, 'rgba(255,250,225,.95)'); sg.addColorStop(0.08, 'rgba(255,245,205,.55)'); sg.addColorStop(1, 'rgba(255,240,200,0)')
  c.fillStyle = sg; c.fillRect(0, 0, W, H)
  // 星
  const st = clamp((G.cam.y - 70) / 50, 0, 1)
  if (st > 0) { c.fillStyle = `rgba(255,255,255,${st})`; for (const [u, v, r] of STARS) { c.beginPath(); c.arc(u * W, ((v * H + G.cam.y * 3) % H), r, 0, 7); c.fill() } }
}
// 遠くの景色（パララックス）
function drawFar(c) {
  const s = G.cam.s
  // 山
  const gy = G.cy + (G.cam.y * s) * 0.12 + 40
  if (gy < H + 200) {
    c.fillStyle = 'rgba(120,160,190,.55)'
    c.beginPath(); c.moveTo(0, H); for (let i = 0; i <= 10; i++) { const x = i / 10 * W; c.lineTo(x, gy - 50 - Math.sin(i * 1.7 + G.cam.x * 0.01) * 26 - (i % 3) * 14) } c.lineTo(W, H); c.closePath(); c.fill()
  }
  // 街（ビル）
  const by = G.cy + G.cam.y * s * 0.3 + 70
  if (by - 60 * 0.3 * s < H + 40) {
    for (const b of BLD) {
      const x = W / 2 + (b.x - G.cam.x * 0.3) * s * 0.3, ww = b.w * s * 0.3, hh = b.h * s * 0.3
      if (x + ww < 0 || x > W) continue
      c.fillStyle = ['#9db8cf', '#a9c2d6', '#8faac3'][b.c]; c.fillRect(x, by - hh, ww, hh + H)
      c.fillStyle = 'rgba(255,255,255,.35)'; for (let yy = by - hh + 4; yy < by - 4; yy += 7) for (let xx = x + 3; xx < x + ww - 3; xx += 6) c.fillRect(xx, yy, 2.5, 3)
      c.fillStyle = 'rgba(60,80,110,.18)'; c.fillRect(x, by - hh, ww * 0.3, hh + H)
    }
  }
  // 雲（パララックス）
  for (const cl of CLOUDS) {
    const x = W / 2 + (cl.x - G.cam.x * cl.p) * s * cl.p, y = G.cy - (cl.y - G.cam.y) * s * cl.p
    if (y < -120 || y > H + 120) continue
    cloud(c, x, y, cl.r * s * cl.p, 0.85)
  }
}
function cloud(c, x, y, r, a = 1) {
  c.save(); c.globalAlpha = a
  c.fillStyle = '#d8e6f2'; for (const [dx, dy, k] of [[-1.1, 0.25, 0.7], [0, 0.3, 0.9], [1.1, 0.25, 0.7]]) { c.beginPath(); c.arc(x + dx * r, y + dy * r + r * 0.12, r * k, 0, 7); c.fill() }
  c.fillStyle = '#ffffff'; for (const [dx, dy, k] of [[-1.1, 0.2, 0.62], [-0.3, -0.25, 0.85], [0.6, -0.1, 0.75], [1.2, 0.2, 0.55]]) { c.beginPath(); c.arc(x + dx * r, y + dy * r, r * k, 0, 7); c.fill() }
  c.restore()
}
function drawGround(c) {
  const [, gy] = worldToScreen(0, 0)
  if (gy > H + 20) return
  const s = G.cam.s
  // 芝生
  const g = c.createLinearGradient(0, gy, 0, gy + 3 * s); g.addColorStop(0, '#78b85c'); g.addColorStop(1, '#5c9a47')
  c.fillStyle = g; c.fillRect(0, gy, W, H - gy + 10)
  // 木（奥）
  const x0 = G.cam.x - W / 2 / s - 4, x1 = G.cam.x + W / 2 / s + 4
  for (let tx = Math.floor(x0 / 6) * 6; tx < x1; tx += 6) {
    const k = ((tx / 6) % 3 + 3) % 3
    const [a, b] = worldToScreen(tx + 1.5, 0)
    c.fillStyle = '#7a5a3d'; c.fillRect(a - 0.12 * s, b - 2.2 * s, 0.24 * s, 2.2 * s)
    c.fillStyle = ['#4f8d43', '#5d9b4c', '#477f3c'][k]; c.beginPath(); c.arc(a, b - 2.6 * s, 1.1 * s, 0, 7); c.arc(a - 0.7 * s, b - 2.1 * s, 0.8 * s, 0, 7); c.arc(a + 0.7 * s, b - 2.2 * s, 0.85 * s, 0, 7); c.fill()
    c.fillStyle = 'rgba(255,255,220,.18)'; c.beginPath(); c.arc(a + 0.35 * s, b - 2.95 * s, 0.6 * s, 0, 7); c.fill()
  }
  // 地面の種類
  for (let x = Math.floor(x0); x < x1; x += 0.5) {
    const k = PH.groundAt(x + 0.25)
    const [a, b] = worldToScreen(x, 0)
    if (k === 'sand') { c.fillStyle = '#e8d19c'; c.fillRect(a, b - 1, 0.5 * s + 1, 0.35 * s); c.fillStyle = '#d7bd84'; c.fillRect(a, b + 0.2 * s, 0.5 * s + 1, 0.15 * s) }
    else if (k === 'pond') { c.fillStyle = '#5aa6d8'; c.fillRect(a, b - 1, 0.5 * s + 1, 0.4 * s); c.fillStyle = 'rgba(255,255,255,.5)'; if (((x * 2) | 0) % 3 === 0) c.fillRect(a + 2, b + 0.08 * s, 0.25 * s, 2) }
    else if (k === 'bush') { c.fillStyle = '#3f7d36'; c.beginPath(); c.arc(a + 0.25 * s, b - 0.15 * s, 0.42 * s, Math.PI, 0); c.fill(); c.fillStyle = '#58994a'; c.beginPath(); c.arc(a + 0.15 * s, b - 0.3 * s, 0.2 * s, 0, 7); c.fill() }
  }
  // 砂場と池の縁
  for (let tile = Math.floor((x0 + 3) / 14) - 1; tile <= Math.floor((x1 + 3) / 14) + 1; tile++) {
    const o = tile * 14
    const edge = (xa, xb, col) => { const [a, b] = worldToScreen(xa, 0), [p] = worldToScreen(xb, 0); c.fillStyle = col; c.fillRect(a - 0.1 * s, b - 0.12 * s, 0.2 * s, 0.2 * s); c.fillRect(p - 0.1 * s, b - 0.12 * s, 0.2 * s, 0.2 * s) }
    edge(o - 3, o + 3, '#a4774b'); edge(o + 4.5, o + 9.5, '#9aa3a8')
    // 池のカモ
    const [da, db] = worldToScreen(o + 7.4 + Math.sin(realT * 0.4 + tile) * 0.8, 0.05)
    c.fillStyle = '#f7f3e8'; c.beginPath(); c.ellipse(da, db, 0.22 * s, 0.11 * s, 0, 0, 7); c.fill(); c.beginPath(); c.arc(da + 0.16 * s, db - 0.12 * s, 0.08 * s, 0, 7); c.fill(); c.fillStyle = '#f2a33a'; c.fillRect(da + 0.22 * s, db - 0.13 * s, 0.08 * s, 0.03 * s)
  }
  // ベンチとお母さんと子ども（0 のブランコの左）
  const [bx, by] = worldToScreen(-3.4, 0)
  if (bx > -100 && bx < W + 100) {
    c.fillStyle = '#8a5a36'; c.fillRect(bx - 0.7 * s, by - 0.5 * s, 1.4 * s, 0.1 * s); c.fillRect(bx - 0.6 * s, by - 0.5 * s, 0.08 * s, 0.5 * s); c.fillRect(bx + 0.52 * s, by - 0.5 * s, 0.08 * s, 0.5 * s)
    // カバン（本人の）
    c.fillStyle = '#3a2a20'; c.fillRect(bx + 0.15 * s, by - 0.82 * s, 0.42 * s, 0.32 * s); c.strokeStyle = '#3a2a20'; c.lineWidth = 2; c.beginPath(); c.arc(bx + 0.36 * s, by - 0.82 * s, 0.09 * s, Math.PI, 0); c.stroke()
    person2d(c, -3.65, 0, 1.6, '#c96f8f', true)
  }
  for (const k of KIDS) person2d(c, k.x, 0, k.h, k.c, false, k.hat)
  // 管理人（何もしないと来る）
  if (G.manager != null) { person2d(c, G.manager, 0, 1.65, '#5a6b4a', false, '#3d4a33'); }
}
// 見物人（小さい切り絵ふうの人）
function person2d(c, x, y, h, col, sit, hat) {
  const s = G.cam.s, [a, b] = worldToScreen(x, y)
  const hh = h * s
  c.save(); c.lineJoin = 'round'
  const body = sit ? 0.45 : 0.5, legs = sit ? 0.32 : 0.48
  c.fillStyle = '#2f3440'; c.fillRect(a - 0.09 * hh, b - legs * hh, 0.07 * hh, legs * hh); c.fillRect(a + 0.03 * hh, b - legs * hh, 0.07 * hh, legs * hh)
  c.fillStyle = col; c.strokeStyle = INK; c.lineWidth = 2
  rr(c, a - 0.16 * hh, b - (legs + body * 0.62) * hh, 0.32 * hh, body * 0.66 * hh, 0.08 * hh); c.fill(); c.stroke()
  c.fillStyle = '#f1c7a0'; c.beginPath(); c.arc(a, b - (legs + body * 0.62 + 0.13) * hh, 0.13 * hh, 0, 7); c.fill(); c.stroke()
  c.fillStyle = INK; c.beginPath(); c.arc(a + 0.05 * hh, b - (legs + body * 0.62 + 0.15) * hh, 0.018 * hh, 0, 7); c.fill()
  if (hat) { c.fillStyle = hat; c.beginPath(); c.arc(a, b - (legs + body * 0.62 + 0.17) * hh, 0.135 * hh, Math.PI, 0); c.fill(); c.stroke() }
  else { c.fillStyle = '#3a2a22'; c.beginPath(); c.arc(a - 0.02 * hh, b - (legs + body * 0.62 + 0.18) * hh, 0.12 * hh, Math.PI * 0.9, Math.PI * 2.05); c.fill() }
  c.restore()
}
const speakerOf = s => s.band === 'pole' ? [s.x - G.face * 0.9, s.y + 1.6] : s.band === 'crane' ? [s.x + 1.5, s.y + 1.4] : s.band === 'heli' ? [s.x, s.y + 1.6] : s.band === 'plane' ? [s.x + 1.2, s.y + 2.0] : [s.x, s.y + 1.4]

// ブランコの吊り元（高さで変わる）
function drawMount(c, s) {
  const x = s.x, y = s.y, sd = -(s.dir || 1)
  switch (s.band) {
    case 'park': {
      // A字の枠（赤いパイプ）
      seg(c, x - 0.75, y + 0.06, x - 1.35, 0, 0.11, '#d8452c'); seg(c, x + 0.75, y + 0.06, x + 1.35, 0, 0.11, '#d8452c')
      seg(c, x - 0.9, y + 0.06, x + 0.9, y + 0.06, 0.12, '#f2c230')
      break
    }
    case 'pole': {
      const px = x + sd * 1.0
      const [a, b] = worldToScreen(px, y + 1.4), [, gb] = worldToScreen(px, 0)
      const gr = c.createLinearGradient(a - 0.14 * G.cam.s, 0, a + 0.14 * G.cam.s, 0); gr.addColorStop(0, '#8d9094'); gr.addColorStop(0.55, '#c9cbcd'); gr.addColorStop(1, '#a5a8ab')
      c.fillStyle = gr; c.fillRect(a - 0.13 * G.cam.s, b, 0.26 * G.cam.s, Math.min(gb, H + 10) - b)
      c.strokeStyle = INK; c.lineWidth = 2.5; c.strokeRect(a - 0.13 * G.cam.s, b, 0.26 * G.cam.s, Math.min(gb, H + 10) - b)
      // 黄色と黒の巻き（下）
      seg(c, px - sd * 0.05, y + 0.12, x - sd * 0.2, y + 0.12, 0.1, '#5b5f66')
      seg(c, px, y + 0.12, px + sd * 0.7, y + 0.12, 0.1, '#5b5f66')
      for (const ix of [px + sd * 0.55, x + sd * 0.15]) { circ(c, ix, y + 0.3, 0.08, '#f4f1ea', true, 2) }
      break
    }
    case 'crane': {
      const y2 = y + 0.55, L = 2.4
      lattice(c, x - L, y2, x + L, y2, 0.32, '#f2b51e')
      seg(c, x, y2 - 0.1, x, y + 0.02, 0.03, '#454850', false)
      poly(c, [[x - 0.22, y + 0.12], [x + 0.22, y + 0.12], [x + 0.14, y - 0.05], [x - 0.14, y - 0.05]], '#d8452c')
      const mx = x + sd * L
      c.save(); c.globalAlpha = 0.2; lattice(c, mx, y2, mx, Math.max(-2, y2 - 9), 0.42, '#f2b51e'); c.restore()
      const [ca, cb] = worldToScreen(mx - sd * 0.1, y2 - 0.35)
      c.fillStyle = '#e8ecef'; c.strokeStyle = INK; c.lineWidth = 2.5; c.fillRect(ca - 0.32 * G.cam.s, cb, 0.64 * G.cam.s, 0.5 * G.cam.s); c.strokeRect(ca - 0.32 * G.cam.s, cb, 0.64 * G.cam.s, 0.5 * G.cam.s)
      c.fillStyle = '#7fb7d9'; c.fillRect(ca - 0.24 * G.cam.s, cb + 0.08 * G.cam.s, 0.48 * G.cam.s, 0.2 * G.cam.s)
      poly(c, [[x - sd * L, y2 + 0.2], [x - sd * (L - 0.8), y2 + 0.2], [x - sd * (L - 0.8), y2 - 0.55], [x - sd * L, y2 - 0.55]], '#8d9094')
      break
    }
    case 'tower': {
      const tx = x + sd * 2.6
      lattice(c, tx, y + 0.3, x - sd * 0.15, y + 0.3, 0.26, '#a8b0b8')
      seg(c, x, y + 0.3, x, y + 0.05, 0.05, '#c9d2c0', false)
      for (let k = 0; k < 3; k++) circ(c, x, y + 0.25 - k * 0.07, 0.07, '#e6ece0', true, 1.6)
      // 鉄塔の体（下に広がる）
      const top = y + 2.2, bot = Math.max(-1, y - 12)
      c.save(); c.globalAlpha = 0.4
      for (const side of [-1, 1]) seg(c, tx + side * 0.35, top, tx + side * (0.35 + (top - bot) * 0.05), bot, 0.06, '#8e979f')
      for (let yy = top; yy > bot; yy -= 1.2) { const wdt = 0.35 + yy * 0.05; seg(c, tx - wdt, yy, tx + wdt + 0.06, yy - 1.2, 0.035, '#8e979f', false); seg(c, tx + wdt, yy, tx - wdt - 0.06, yy - 1.2, 0.035, '#8e979f', false) }
      c.restore()
      break
    }
    case 'cloud': {
      const [a, b] = worldToScreen(x, y + 0.45)
      cloud(c, a, b, 0.75 * G.cam.s, 1)
      circ(c, x, y + 0.02, 0.07, '#c9a35e', true, 2)
      break
    }
    case 'heli': {
      const hy = y + 0.75 + Math.sin(realT * 2 + s.i) * 0.05
      seg(c, x, hy - 0.2, x, y, 0.03, '#454850', false)
      poly(c, [[x - 1.1, hy + 0.35], [x + 0.6, hy + 0.45], [x + 0.95, hy + 0.1], [x + 0.6, hy - 0.2], [x - 0.9, hy - 0.2]], '#d8452c')
      poly(c, [[x + 0.15, hy + 0.38], [x + 0.62, hy + 0.4], [x + 0.85, hy + 0.12], [x + 0.25, hy + 0.08]], '#9fd3ef')
      seg(c, x - 1.0, hy + 0.15, x - 2.6, hy + 0.35, 0.12, '#d8452c')
      seg(c, x - 0.8, hy - 0.32, x + 0.6, hy - 0.32, 0.05, '#454850')
      seg(c, x - 0.1, hy + 0.45, x - 0.1, hy + 0.62, 0.06, '#454850')
      const ph = realT * 30, len = 2.2
      c.save(); c.globalAlpha = 0.5; seg(c, x - 0.1 - Math.cos(ph) * len, hy + 0.64, x - 0.1 + Math.cos(ph) * len, hy + 0.64, 0.05, '#2b2f37', false); c.restore()
      break
    }
    case 'plane': {
      const py = y + 1.25
      poly(c, [[x - 4, py + 0.35], [x + 3.3, py + 0.42], [x + 4.3, py], [x + 3.3, py - 0.42], [x - 3.8, py - 0.36], [x - 4.6, py + 0.9], [x - 4.1, py + 0.95]], '#f4f6f8')
      poly(c, [[x - 0.6, py - 0.15], [x + 0.6, py - 0.15], [x + 0.2, py - 1.0], [x - 0.3, py - 1.0]], '#d0d6dc')
      c.fillStyle = '#2d5aa8'; for (let k = 0; k < 9; k++) { const [a, b] = worldToScreen(x - 3 + k * 0.7, py + 0.1); c.beginPath(); c.arc(a, b, 0.09 * G.cam.s, 0, 7); c.fill() }
      seg(c, x, py - 0.95, x, y, 0.03, '#454850', false)
      seg(c, x - 4, py - 0.05, x + 3.6, py - 0.05, 0.06, '#d8452c', false)
      break
    }
    case 'moon': {
      const [a, b] = worldToScreen(x + 0.4, y + 1.3)
      c.fillStyle = '#fff2b8'; c.beginPath(); c.arc(a, b, 1.3 * G.cam.s, 0, 7); c.fill()
      c.fillStyle = 'rgba(230,205,130,.6)'; c.beginPath(); c.arc(a - 0.4 * G.cam.s, b - 0.2 * G.cam.s, 0.25 * G.cam.s, 0, 7); c.arc(a + 0.5 * G.cam.s, b + 0.4 * G.cam.s, 0.18 * G.cam.s, 0, 7); c.fill()
      seg(c, x, y + 0.1, x, y, 0.03, '#454850', false)
      break
    }
  }
}
function lattice(c, x1, y1, x2, y2, wdt, col) {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy), nx = -dy / L * wdt / 2, ny = dx / L * wdt / 2
  seg(c, x1 + nx, y1 + ny, x2 + nx, y2 + ny, 0.06, col); seg(c, x1 - nx, y1 - ny, x2 - nx, y2 - ny, 0.06, col)
  const n = Math.max(1, Math.round(L / (wdt * 1.2)))
  for (let i = 0; i < n; i++) { const a = i / n, b = (i + 1) / n; seg(c, x1 + dx * a + nx, y1 + dy * a + ny, x1 + dx * b - nx, y1 + dy * b - ny, 0.035, col, false) }
}
// 電柱どうしの電線
function drawWires(c) {
  let prev = null
  for (const s of w.swings) {
    if (s.band !== 'pole') { prev = null; continue }
    const px = s.x - (s.dir || 1) * 1.0, py = s.y + 1.25
    if (prev) { const [a, b] = worldToScreen(prev[0], prev[1]), [p, q] = worldToScreen(px, py); c.strokeStyle = 'rgba(31,36,51,.75)'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(a, b); c.quadraticCurveTo((a + p) / 2, (b + q) / 2 + 0.6 * G.cam.s, p, q); c.stroke() }
    prev = [px, py]
  }
}
function swTh(s) { const pv = G.prev && G.prev.sw[s.i]; return pv == null ? s.th : lerpA(pv, s.th, G.alpha) }
function lerpA(a, b, k) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * k }
function drawSwing(c, s) {
  const th = swTh(s)
  const sx = s.x + s.C * Math.sin(th), sy = s.y - s.C * Math.cos(th)
  // 鎖（輪を点線で）
  const [a, b] = worldToScreen(s.x, s.y), [p, q] = worldToScreen(sx, sy)
  c.lineCap = 'round'
  c.strokeStyle = '#4b5059'; c.lineWidth = Math.max(2, 0.06 * G.cam.s); c.setLineDash([Math.max(2, 0.07 * G.cam.s), Math.max(1, 0.03 * G.cam.s)]); c.beginPath(); c.moveTo(a, b); c.lineTo(p, q); c.stroke()
  c.strokeStyle = '#c3c8cf'; c.lineWidth = Math.max(1, 0.025 * G.cam.s); c.beginPath(); c.moveTo(a, b); c.lineTo(p, q); c.stroke(); c.setLineDash([])
  // 座面（黒いゴム）
  const ux = Math.cos(th), uy = Math.sin(th)
  seg(c, sx - ux * 0.26, sy - uy * 0.26, sx + ux * 0.26, sy + uy * 0.26, 0.09, s.i === 0 ? '#2b2f37' : s.amp ? '#3a4d72' : '#2b2f37')
  if (s.pigeon && !s.pigeonGone) pigeon(c, sx + 0.05, sy + 0.05, 1)
}
function pigeon(c, x, y, k) {
  const [a, b] = worldToScreen(x, y), r = 0.13 * G.cam.s * k
  c.fillStyle = '#8f96a3'; c.strokeStyle = INK; c.lineWidth = 2
  c.beginPath(); c.ellipse(a, b - r, r * 1.3, r * 0.85, 0, 0, 7); c.fill(); c.stroke()
  c.beginPath(); c.arc(a + r * 1.1, b - r * 1.7, r * 0.55, 0, 7); c.fill(); c.stroke()
  c.fillStyle = '#6fae9a'; c.fillRect(a + r * 0.7, b - r * 1.35, r * 0.6, r * 0.3)
  c.fillStyle = '#e8a33a'; c.fillRect(a + r * 1.55, b - r * 1.75, r * 0.4, r * 0.18)
  c.fillStyle = INK; c.beginPath(); c.arc(a + r * 1.25, b - r * 1.8, r * 0.1, 0, 7); c.fill()
}

// ---- 主人公（スーツの大人）の形 ----
const SUIT = '#2d3a5a', PANTS = '#252f48', SKIN = '#f0c39b', HAIR = '#2a2420'
function twoBone(ax, ay, bx, by, l1, l2, bendX, bendY) {
  const dx = bx - ax, dy = by - ay, d = Math.min(Math.hypot(dx, dy), l1 + l2 - 1e-4)
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a))
  const ux = dx / (Math.hypot(dx, dy) || 1), uy = dy / (Math.hypot(dx, dy) || 1)
  let px = -uy, py = ux; if (px * bendX + py * bendY < 0) { px = -px; py = -py }
  return [ax + ux * a + px * h, ay + uy * a + py * h]
}
function poseNow() {
  const m = w.me, al = G.alpha, pv = G.prev
  const mode = m.mode
  if (mode === 'swing') {
    const s = w.swings[m.si]
    const th = pv && pv.mode === 'swing' && pv.si === m.si ? lerpA(pv.th, m.th, al) : m.th
    const L = pv && pv.mode === 'swing' && pv.si === m.si ? lerp(pv.L, m.L, al) : m.L
    return poseSwing(s, th, L, G.face)
  }
  if (mode === 'down') return poseDown(m)
  const same = pv && pv.mode === mode
  const x = same ? lerp(pv.x, m.x, al) : m.x, y = same ? lerp(pv.y, m.y, al) : m.y
  const phi = same ? lerpA(pv.phi, m.phi, al) : m.phi, tk = same ? lerp(pv.tk, m.tk, al) : m.tk
  return poseAir(x, y, phi, tk, G.face, w.phase === 'fall')
}
function poseSwing(s, th, L, face) {
  const sx = s.x + s.C * Math.sin(th), sy = s.y - s.C * Math.cos(th)
  const ux = -Math.sin(th), uy = Math.cos(th), fx = Math.cos(th) * face, fy = Math.sin(th) * face
  const q = clamp((s.C - L - P.squat) / (P.stand - P.squat), 0, 1)
  const feet = [sx + ux * 0.04, sy + uy * 0.04]
  const hipH = 0.5 + 0.38 * q
  const lean = 0.28 * (1 - q)
  const hip = [feet[0] + ux * hipH - fx * 0.12 * (1 - q), feet[1] + uy * hipH - fy * 0.12 * (1 - q)]
  const knee = twoBone(hip[0], hip[1], feet[0], feet[1], 0.46, 0.46, fx, fy)
  const tx = ux + fx * lean, ty = uy + fy * lean, tl = Math.hypot(tx, ty)
  const sh = [hip[0] + tx / tl * 0.56, hip[1] + ty / tl * 0.56]
  const head = [sh[0] + tx / tl * 0.25, sh[1] + ty / tl * 0.25]
  const hand = [sx + ux * (hipH + 0.6), sy + uy * (hipH + 0.6)]
  const elbow = twoBone(sh[0], sh[1], hand[0], hand[1], 0.32, 0.32, -ux + fx * 0.3, -uy + fy * 0.3)
  return { hip, knee, feet, sh, head, hand, elbow, fx, fy, ux: tx / tl, uy: ty / tl, face, k2: [knee[0] - fx * 0.05, knee[1] - fy * 0.05], f2: [feet[0] - fx * 0.08, feet[1] - fy * 0.08], h2: [hand[0] - fx * 0.03, hand[1] - fy * 0.03], e2: elbow }
}
function poseAir(x, y, phi, tk, face, flail) {
  const ux = -Math.sin(phi), uy = Math.cos(phi), fx = Math.cos(phi) * face, fy = Math.sin(phi) * face
  const at = (u, f) => [x + ux * u + fx * f, y + uy * u + fy * f]
  const mix = (a, b) => [lerp(a[0], b[0], tk), lerp(a[1], b[1], tk)]
  const fl = flail ? Math.sin(realT * 22) * 0.25 : 0, fl2 = flail ? Math.cos(realT * 19) * 0.25 : 0
  const hip = mix(at(-0.08, 0), at(-0.12, -0.08))
  const knee = mix(at(-0.5 + fl * 0.3, 0.08 + fl), at(0.16, 0.3))
  const feet = mix(at(-0.92, -0.02 + fl * 1.4), at(-0.18, 0.32))
  const k2 = mix(at(-0.5, 0.0 - fl), at(0.14, 0.24)), f2 = mix(at(-0.9, -0.12 - fl * 1.4), at(-0.2, 0.26))
  const sh = mix(at(0.46, 0.02), at(0.3, 0.04))
  const head = mix(at(0.7, 0.04), at(0.52, 0.14))
  const hand = flail ? at(0.55 + fl2, 0.45 + fl * 2) : mix(at(0.92, 0.04), at(0.12, 0.34))
  const h2 = flail ? at(0.6 - fl2, -0.4 - fl * 2) : mix(at(0.9, -0.04), at(0.1, 0.28))
  const elbow = twoBone(sh[0], sh[1], hand[0], hand[1], 0.32, 0.32, fx, fy)
  const e2 = twoBone(sh[0], sh[1], h2[0], h2[1], 0.32, 0.32, fx, fy)
  return { hip, knee, feet, sh, head, hand, elbow, k2, f2, h2, e2, fx, fy, ux, uy, face }
}
// 着地した後の姿（地面のネタ）
function poseDown(m) {
  const x = m.landX, f = G.face
  const at = (dx, dy) => [x + dx * f, dy]
  switch (m.pose) {
    case 'sandHead': return { special: 'legsUp', hip: at(0, 0.55), knee: at(0.25, 0.95), feet: at(0.2, 1.35), k2: at(-0.25, 0.95), f2: at(-0.3, 1.3), sink: 0.15, ground: 'sand' }
    case 'pond': return { special: 'legsUp', hip: at(0, 0.25), knee: at(0.2, 0.7), feet: at(0.45, 1.05), k2: at(-0.2, 0.7), f2: at(-0.45, 1.0), sink: 0.3, ground: 'pond' }
    case 'bush': return { special: 'legsUp', hip: at(0, 0.5), knee: at(0.35, 0.8), feet: at(0.7, 0.85), k2: at(-0.1, 0.9), f2: at(-0.2, 1.3), sink: 0.5, ground: 'bush' }
    case 'flat': { const p = { hip: at(0, 0.18), knee: at(-0.45, 0.14), feet: at(-0.9, 0.14), k2: at(-0.4, 0.3), f2: at(-0.85, 0.42), sh: at(0.55, 0.2), head: at(0.82, 0.22), hand: at(0.8, 0.75), elbow: at(0.62, 0.52), h2: at(0.7, -0.2), e2: at(0.5, 0.0), fx: f, fy: 0, ux: f, uy: 0.05, face: f }; return p }
    case 'sandSit': return { hip: at(0, 0.12), knee: at(0.4, 0.42), feet: at(0.75, 0.1), k2: at(0.35, 0.5), f2: at(0.7, 0.12), sh: at(-0.12, 0.66), head: at(-0.16, 0.92), hand: at(-0.45, 0.1), elbow: at(-0.35, 0.38), h2: at(0.2, 0.9), e2: at(0.1, 0.62), fx: f, fy: 0, ux: -0.15 * f, uy: 1, face: f }
    default: return { hip: at(0, 0.92), knee: at(0.05, 0.46), feet: at(0, 0.02), k2: at(-0.08, 0.46), f2: at(-0.12, 0.02), sh: at(0, 1.48), head: at(0, 1.74), hand: at(0.35, 2.1), elbow: at(0.28, 1.8), h2: at(-0.35, 2.1), e2: at(-0.28, 1.8), fx: f, fy: 0, ux: 0, uy: 1, face: f }
  }
}
function drawMan(c, p, shoes) {
  const shoe = (pt, has, dirx, diry) => {
    const [a, b] = worldToScreen(pt[0], pt[1]), s = G.cam.s
    c.save(); c.translate(a, b); c.rotate(Math.atan2(-diry, dirx))
    c.fillStyle = has ? '#18181b' : '#efece4'; c.strokeStyle = INK; c.lineWidth = 2
    c.beginPath(); c.ellipse(0.05 * s, 0, 0.13 * s, 0.065 * s, 0, 0, 7); c.fill(); c.stroke()
    c.restore()
  }
  const fdx = p.fx ?? 1, fdy = p.fy ?? 0
  if (p.special === 'legsUp') {
    // 頭から刺さって足だけ出ている
    seg(c, p.hip[0], p.hip[1], p.k2[0], p.k2[1], 0.15, PANTS); seg(c, p.k2[0], p.k2[1], p.f2[0], p.f2[1], 0.14, PANTS)
    seg(c, p.hip[0], p.hip[1], p.knee[0], p.knee[1], 0.16, PANTS); seg(c, p.knee[0], p.knee[1], p.feet[0], p.feet[1], 0.15, PANTS)
    shoe(p.f2, shoes > 1, 0, 1); shoe(p.feet, shoes > 0, 0, 1)
    const [a, b] = worldToScreen(p.hip[0], 0.05), s = G.cam.s
    c.fillStyle = p.ground === 'pond' ? '#5aa6d8' : p.ground === 'bush' ? '#3f7d36' : '#e8d19c'
    c.beginPath(); c.ellipse(a, b, 0.6 * s, (p.ground === 'bush' ? 0.55 : 0.16) * s, 0, Math.PI, 0); c.fill()
    if (p.ground === 'pond') { c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 2; for (let k = 0; k < 2; k++) { c.beginPath(); c.ellipse(a, b, (0.7 + ((realT * 0.8 + k * 0.5) % 1) * 0.6) * s, 0.12 * s, 0, 0, 7); c.stroke() } }
    return
  }
  // 奥の脚・腕
  seg(c, p.hip[0], p.hip[1], p.k2[0], p.k2[1], 0.15, '#1f2840'); seg(c, p.k2[0], p.k2[1], p.f2[0], p.f2[1], 0.14, '#1f2840')
  shoe(p.f2, shoes > 1, fdx, fdy)
  seg(c, p.sh[0], p.sh[1], p.e2[0], p.e2[1], 0.12, '#25304c'); seg(c, p.e2[0], p.e2[1], p.h2[0], p.h2[1], 0.11, '#25304c')
  circ(c, p.h2[0], p.h2[1], 0.06, SKIN, true, 2)
  // 胴（スーツ）
  seg(c, p.hip[0], p.hip[1], p.sh[0], p.sh[1], 0.32, SUIT)
  // シャツとネクタイ（前側）
  const nx = p.fx * 0.1, ny = p.fy * 0.1
  seg(c, p.sh[0] + nx, p.sh[1] + ny, lerp(p.sh[0], p.hip[0], 0.55) + nx, lerp(p.sh[1], p.hip[1], 0.55) + ny, 0.07, '#f4f1ea', false)
  seg(c, p.sh[0] + nx * 1.05, p.sh[1] + ny * 1.05, lerp(p.sh[0], p.hip[0], 0.48) + nx * 1.05, lerp(p.sh[1], p.hip[1], 0.48) + ny * 1.05, 0.035, '#c8323c', false)
  // 手前の脚
  seg(c, p.hip[0], p.hip[1], p.knee[0], p.knee[1], 0.16, PANTS); seg(c, p.knee[0], p.knee[1], p.feet[0], p.feet[1], 0.15, PANTS)
  shoe(p.feet, shoes > 0, fdx, fdy)
  // 頭
  const [ha, hb] = worldToScreen(p.head[0], p.head[1]), s = G.cam.s, r = 0.15 * s
  c.fillStyle = SKIN; c.strokeStyle = INK; c.lineWidth = 2.5; c.beginPath(); c.arc(ha, hb, r, 0, 7); c.fill(); c.stroke()
  const ang = Math.atan2(-(p.uy ?? 1), p.ux ?? 0)   // 画面の上向き
  const fa = Math.atan2(-(p.fy), p.fx)
  c.fillStyle = HAIR; c.beginPath(); c.arc(ha, hb, r * 1.02, ang - 1.9 + (p.face < 0 ? 0.5 : -0.5) * 0, ang + 1.25); c.closePath(); c.fill()
  // 七三の分け目
  c.strokeStyle = '#4a4038'; c.lineWidth = 1.4; c.beginPath(); c.arc(ha, hb, r * 0.8, ang - 0.4, ang + 0.2); c.stroke()
  // 目と眉（前を向く）
  const ex = ha + Math.cos(fa) * r * 0.55 + Math.cos(ang) * r * 0.1, ey = hb + Math.sin(fa) * r * 0.55 + Math.sin(ang) * r * 0.1
  c.fillStyle = INK; c.beginPath(); c.arc(ex, ey, Math.max(1.2, r * 0.12), 0, 7); c.fill()
  c.strokeStyle = INK; c.lineWidth = 1.6; c.beginPath(); c.moveTo(ex - Math.cos(ang) * 0 + Math.cos(ang) * r * 0.25 - Math.cos(fa) * r * 0.12, ey + Math.sin(ang) * r * 0.25 - Math.sin(fa) * r * 0.12); c.lineTo(ex + Math.cos(ang) * r * 0.32 + Math.cos(fa) * r * 0.14, ey + Math.sin(ang) * r * 0.32 + Math.sin(fa) * r * 0.14); c.stroke()
  // 手前の腕
  seg(c, p.sh[0], p.sh[1], p.elbow[0], p.elbow[1], 0.12, SUIT); seg(c, p.elbow[0], p.elbow[1], p.hand[0], p.hand[1], 0.11, SUIT)
  circ(c, p.hand[0], p.hand[1], 0.065, SKIN, true, 2)
}

// 練習用の点線（0 のブランコだけ）: 今離したら手がどこを通るか
function drawPreview(c) {
  const m = w.me
  if (m.mode !== 'swing' || m.si !== 0 || w.phase !== 'swing') return
  const path = PH.predict(w, 1.3)
  const hit = PH.predictHit(w, 1, path)
  const ok = hit.d < P.reach && hit.off < P.upTol
  c.fillStyle = ok ? 'rgba(255,230,90,.95)' : 'rgba(255,255,255,.75)'
  for (let k = 3; k < path.length; k += 4) {
    if (ok && k > hit.k + 2) break
    const [a, b] = worldToScreen(path[k].x, path[k].y)
    c.beginPath(); c.arc(a, b, ok ? 4 : 3, 0, 7); c.fill()
  }
  G.previewOk = ok
}
function drawBestLine(c) {
  if (G.selfBest < 1) return
  const y = G.selfBest + 0.4, [, sy] = worldToScreen(0, y)
  if (sy < 30 || sy > H) return
  c.save(); c.setLineDash([8, 7]); c.strokeStyle = 'rgba(242,194,48,.9)'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(0, sy); c.lineTo(W, sy); c.stroke(); c.setLineDash([])
  c.font = `900 13px "Zen Kaku Gothic New",sans-serif`; c.fillStyle = '#1f2433'; const tx = `${T().bestLine} ${G.selfBest.toFixed(1)}m`, tw = c.measureText(tx).width
  c.fillStyle = 'rgba(242,194,48,.95)'; c.fillRect(W - tw - 18, sy - 20, tw + 12, 18); c.fillStyle = '#1f2433'; c.fillText(tx, W - tw - 12, sy - 6)
  c.restore()
}
// 速さの線
function drawSpeed(c) {
  const m = w.me, v = Math.hypot(m.vx, m.vy)
  if (v > 5.5 && Math.random() < (v - 5) / 6) G.lines.push({ x: Math.random() * W, y: Math.random() * H, t: 0 })
  const ang = Math.atan2(m.vy, m.vx)
  c.strokeStyle = 'rgba(255,255,255,.6)'; c.lineWidth = 2
  for (const l of G.lines) { l.t += 1 / 60; const len = 40 + v * 6; c.globalAlpha = Math.max(0, 0.7 - l.t * 2.2); c.beginPath(); c.moveTo(l.x, l.y); c.lineTo(l.x - Math.cos(ang) * len, l.y + Math.sin(ang) * len); c.stroke() }
  c.globalAlpha = 1
  G.lines = G.lines.filter(l => l.t < 0.33).slice(-40)
}
function render(c = cx, cw = W, ch = H, opts = {}) {
  if (opts.tf) c.setTransform(opts.tf); else c.setTransform(DPR, 0, 0, DPR, 0, 0)
  drawSky(c); drawFar(c); drawGround(c); drawWires(c)
  const x0 = G.cam.x - W / 2 / G.cam.s - 6, x1 = G.cam.x + W / 2 / G.cam.s + 6
  const yTop = G.cam.y + G.cy / G.cam.s + 4, yBot = G.cam.y - (H - G.cy) / G.cam.s - 3
  const vis = w.swings.filter(s => s.x > x0 && s.x < x1 && s.y - s.C < yTop && s.y + 3 > yBot)
  for (const s of vis) drawMount(c, s)
  for (const s of vis) drawSwing(c, s)
  drawBestLine(c)
  if (!opts.noPreview) drawPreview(c)
  // 主人公の影（地面が見える時）
  const m = w.me, [, gy] = worldToScreen(0, 0)
  if (gy < H && m.mode !== 'down') { const [a] = worldToScreen(m.x, 0), k = clamp(1 - m.y / 12, 0, 1); c.fillStyle = `rgba(30,50,30,${0.25 * k})`; c.beginPath(); c.ellipse(a, gy + 2, 0.5 * G.cam.s * (0.6 + k * 0.4), 0.09 * G.cam.s, 0, 0, 7); c.fill() }
  drawMan(c, poseNow(), 2 - w.misses + (w.phase === 'down' && w.me.countMiss ? 0 : 0))
  for (const f of G.fx) circ(c, f.x, f.y, f.r * (1 - f.t / f.life * 0.5), f.col, false)
  for (const b of G.flyBirds) pigeon(c, b.x, b.y, 1)
  if (G.shoeFly) { const s = G.shoeFly, [a, b] = worldToScreen(s.x, s.y); c.save(); c.translate(a, b); c.rotate(s.r); c.fillStyle = '#18181b'; c.strokeStyle = INK; c.lineWidth = 2; c.beginPath(); c.ellipse(0, 0, 0.15 * G.cam.s, 0.07 * G.cam.s, 0, 0, 7); c.fill(); c.stroke(); c.restore() }
  if (!opts.noSpeed) drawSpeed(c)
  if (G.flash > 0) { const g = c.createRadialGradient(W / 2, H / 2, W * 0.25, W / 2, H / 2, W * 0.8); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, `rgba(255,250,220,${G.flash * 0.7})`); c.fillStyle = g; c.fillRect(0, 0, W, H) }
  if (G.slowT > 0) { c.fillStyle = `rgba(20,24,40,${Math.min(0.22, G.slowT * 0.5)})`; c.fillRect(0, 0, W, H) }
  void cw; void ch
}
// 吹き出しを話し手の位置に
function placeBub() {
  const el = $('#bub'), b = G.bub
  if (!b || realT > b.until || G.popUntil > realT) { el.classList.remove('on'); return }
  const [a, y] = worldToScreen(b.wx, b.wy)
  el.textContent = b.text; el.classList.toggle('me', !!b.me)
  const bw = el.offsetWidth || 120
  el.style.left = clamp(a, bw / 2 + 8, W - bw / 2 - 8) + 'px'; el.style.top = clamp(y, 90, padTop() - 10) + 'px'
  el.classList.add('on')
}

// ---- チュートリアル（はじめての1回・0 のブランコ） ----
const fineP = () => matchMedia('(hover:hover) and (pointer:fine)').matches
function tutUpdate() {
  const t = T().tut, el = $('#tut'), m = w.me
  let step = ''
  if (G.tutStep === 'done') { step = realT < G.tutDoneT ? 'done' : 'off'; if (step === 'off') { G.tutOn = false; G.tutStep = '' } }
  else if (G.tutOn) {
    if (w.phase === 'ready') step = 'hold'
    else if (w.phase === 'swing' && m.si === 0) step = Math.max(G.amp, G.curMax) < 0.95 ? 'pump' : 'rel'
    else if (w.phase === 'air') step = 'air'
    else step = G.lastStep || ''
  }
  G.lastStep = step
  const k = fineP() && t[step + 'K'] ? t[step + 'K'] : t[step]
  if (step && step !== 'off' && k) { el.hidden = false; $('#tutT').textContent = k } else el.hidden = true
  // ボタンを光らせる
  const A = Math.max(G.amp, G.curMax, 0.25)
  const bodyHint = step === 'pump', handHint = step === 'hold' || step === 'air' || step === 'rel'
  pads.body.classList.toggle('hintOn', bodyHint && Math.abs(m.th) < A * 0.5 && m.mode === 'swing')
  pads.body.classList.toggle('hint', false)
  pads.hand.classList.toggle('hint', handHint && step !== 'rel')
  pads.hand.classList.toggle('hintOn', step === 'rel' && !!G.previewOk)
  if (!step || step === 'off' || step === 'done') { pads.body.classList.remove('hintOn'); pads.hand.classList.remove('hint', 'hintOn') }
}

// ---- 時計（固定60Hz・performance.now で数える） ----
let lastT = performance.now(), acc = 0
function timeScale() { return G.slowT > 0 ? 0.3 : w.phase === 'fall' ? 1.7 : 1 }
// 実時間 d 秒ぶん進める（フレームの速さに関係なく、物理は 1/60 秒ずつ）
function advance(d) {
  if (d > 0.25) d = 0.25
  realT += d
  if (G.hitstop > 0) { G.hitstop -= d; return 0 }
  const sc = timeScale()
  if (G.slowT > 0) G.slowT -= d
  acc += d * sc
  let n = 0
  while (acc >= DT) { if (w.phase === 'over') tickOver(); else tick(); acc -= DT; n++ }
  G.alpha = clamp(acc / DT, 0, 1)
  G.flash = Math.max(0, G.flash - d * 3)
  return n
}
function frame() {
  requestAnimationFrame(frame)
  const now = performance.now()
  const d = (now - lastT) / 1000; lastT = now
  if (G.paused) return
  if (G.scene === 'play') { advance(d); camStep(Math.min(d, 0.05)); idleManager(); render(); placeBub(); tutUpdate(); soundStep() }
  else if (G.scene === 'title') { realT += Math.min(d, 0.05); drawTitleArt() }
}
function soundStep() {
  const m = w.me, v = Math.hypot(m.vx, m.vy)
  loopVol('park', 0.3 * clamp(1 - G.cam.y / 18, 0.05, 1))
  loopVol('wind', clamp((v - 2) / 12, 0, 0.42) + clamp((G.cam.y - 20) / 80, 0, 0.12))
}
function idleManager() {
  const idle = (w.phase === 'ready' || w.phase === 'swing') ? w.t - w.lastIn : 0
  if (idle > 17 && !G.warned) { G.warned = true; G.manager = G.cam.x + 6; pop(T().warn, 'bad', 2) }
  if (idle < 1 && w.phase !== 'over') { G.warned = false; G.manager = null }
  if (G.manager != null) G.manager -= 0.02
}

// ---- タイトルの絵（本物の描画で、漕いでいる大人） ----
const ta = $('#tArt'), tcx = ta.getContext('2d')
let tW = 0, tH = 0
function sizeTitleArt() { const r = ta.getBoundingClientRect(); if (!r.width) return; tW = r.width; tH = r.height; ta.width = Math.round(r.width * DPR); ta.height = Math.round(r.height * DPR) }
const tWorld = PH.makeWorld(3)
function drawTitleArt() {
  if (!tW) sizeTitleArt()
  const keep = { w, W, H, cam: { ...G.cam }, cy: G.cy, prev: G.prev, alpha: G.alpha, face: G.face, sx: G.shx, sy: G.shy, best: G.selfBest }
  w = tWorld; W = tW; H = tH
  const s0 = tWorld.swings[0], tt = realT
  const th = 1.05 * Math.sin(tt * 2.15), stand = Math.abs(th) < 0.5
  tWorld.me.mode = 'swing'; tWorld.me.si = 0; tWorld.me.th = th; tWorld.me.L = s0.C - (stand ? P.stand : P.squat) * 0.98; s0.th = th
  for (const s of tWorld.swings) if (s.i > 0) s.th = 0.15 * Math.sin(tt * 1.7 + s.i)
  G.prev = null; G.alpha = 1; G.face = 1; G.shx = 0; G.shy = 0; G.selfBest = 0
  G.cam = { x: 0.9, y: 3.4, s: Math.min(W / 6.6, H / 11) }; G.cy = H * 0.5
  render(tcx, W, H, { noPreview: true, noSpeed: true })
  w = keep.w; W = keep.W; H = keep.H; G.cam = keep.cam; G.cy = keep.cy; G.prev = keep.prev; G.alpha = keep.alpha; G.face = keep.face; G.shx = keep.sx; G.shy = keep.sy; G.selfBest = keep.best
}

// ---- 画面の出し分け ----
function show(id) { for (const v of ['#vTitle', '#vPlay', '#vEnd']) $(v).hidden = v !== id }
function readBest() { let b = 0; try { b = +localStorage.getItem('ss_best') || 0 } catch (e) {} return b }
function applyLang() {
  const t = T()
  document.documentElement.lang = lang
  $('#tH').innerHTML = `<span>${t.title[0]}</span><span class="b">${t.title[1]}</span>`
  $('#tSub').textContent = t.sub; $('#bStart').textContent = t.start; $('#bHow').textContent = t.how; $('#bLang').textContent = t.lang
  $('#loadTxt').textContent = t.loading; $('#bAgain').textContent = t.again; $('#bSave').textContent = t.save; $('#bPost').textContent = t.post
  $('#howH').textContent = t.howH; $('#howBody').innerHTML = t.howList.map(s => `<li>${s}</li>`).join(''); $('#howClose').textContent = t.close
  $('#howCred').textContent = lang === 'ja' ? '音: Kenney / rubberduck / artisticdude / Of Far Different Nature / Almitory / Joseph Sardin / SpliceSound ほか（CC0）' : 'Sound: Kenney / rubberduck / artisticdude / Of Far Different Nature / Almitory / Joseph Sardin / SpliceSound and others (CC0)'
  $('#pBodyT').textContent = t.bBody; $('#pHandT').textContent = t.bHand
  const fine = fineP(); for (const k of document.querySelectorAll('.pad .k')) k.hidden = !fine
  const b = readBest()
  $('#tBest').textContent = b ? t.best(b.toFixed(1)) : ''
  $('#hN').innerHTML = `${(w.best || 0).toFixed(1)}<small>${t.unit}</small>`
  if (G.scene === 'end') drawRes()
}
function setMuteIcons() { for (const s of ['#bMute', '#bMute2']) { const el = $(s); el.querySelector('.wave').style.display = muted ? 'none' : ''; el.querySelector('.x').style.display = muted ? '' : 'none' } }
function toggleMute() { muted = !muted; Snd.setMute(muted); try { localStorage.setItem('ss_mute', muted ? '1' : '0') } catch (e) {} setMuteIcons() }
on('#bMute', () => { Snd.init(); toggleMute() }); on('#bMute2', () => { Snd.init(); toggleMute() })
on('#bLang', () => { lang = lang === 'ja' ? 'en' : 'ja'; try { localStorage.setItem('ss_lang', lang) } catch (e) {} applyLang() })
on('#bHow', () => { sfx('click', { vol: 0.5 }); $('#how').hidden = false })
on('#howClose', () => { $('#how').hidden = true })
$('#how').addEventListener('click', e => { if (e.target.id === 'how') $('#how').hidden = true })
on('#bStart', () => { Snd.init(); sfx('click', { vol: 0.6 }); startGame() })
on('#bAgain', () => { Snd.init(); sfx('click', { vol: 0.6 }); startGame() })
document.addEventListener('pointerdown', () => { if (G.scene === 'title' && !loopsOn.bgmT && $('#loading').style.display === 'none') { Snd.init(); loop('bgmT', 0.28) } }, true)

function startGame(seed) {
  G.seed = seed != null ? seed : ((Date.now() % 100000) + 1)
  w = PH.makeWorld(G.seed)
  let tut = false; try { tut = localStorage.getItem('ss_tut') !== '1' } catch (e) { tut = true }
  Object.assign(G, { scene: 'play', fx: [], lines: [], shake: 0, flash: 0, hitstop: 0, slowT: 0, slowOnce: false, bub: null, bubNext: 0, popUntil: 0, amp: 0, curMax: 0, lastSgn: 0, face: 1,
    tutOn: tut, tutStep: '', prev: null, alpha: 1, shownBest: 0, mile: 0, ended: false, endAt: 0, warned: false, manager: null, saidStart: false, flipsShown: 0, flyBirds: [], shoeFly: null, lastLand: null, result: null, selfBest: readBest() })
  show('#vPlay'); resize()
  G.cam = { x: 1.2, y: 2.6, s: Math.min(W / 7.2, padTop() / 9.5) }
  acc = 0; lastT = performance.now()
  for (const k of ['body', 'hand']) { held[k].clear(); setPad(k) }
  drawShoes(); applyLang(); $('#pop').className = ''
  allLoopsOff(); loop('bgm', 0.2); loop('park', 0.3); loop('wind', 0.0001)
  window.TM && TM.start()
  setTimeout(() => { if (G.scene === 'play' && w.bestIdx === 0) kidSay(T().kid.start, true) }, 900)
}

// ---- 結果（公園のお知らせの紙） ----
const rankOf = h => { let r = D.RANKS[0]; for (const k of D.RANKS) if (h >= k.min) r = k; return r }
function worstFall() {
  if (!w.falls.length) return null
  return w.falls.slice().sort((a, b) => b.h - a.h)[0]
}
function drawCard(c, Wc, Hc) {
  const t = T(), cd = t.card, h = w.best, rk = rankOf(h)
  const F = (wt, px, hand) => hand ? `${px}px "Yusei Magic","Zen Kaku Gothic New",sans-serif` : `${wt} ${px}px "Zen Kaku Gothic New","Hiragino Sans",sans-serif`
  c.setTransform(1, 0, 0, 1, 0, 0)
  // 掲示板（緑の板と木の枠）
  c.fillStyle = '#7a5434'; c.fillRect(0, 0, Wc, Hc)
  c.fillStyle = '#4f7a4a'; c.fillRect(34, 34, Wc - 68, Hc - 68)
  c.fillStyle = 'rgba(255,255,255,.05)'; for (let i = 0; i < 40; i++) c.fillRect(34, 40 + i * 32, Wc - 68, 2)
  // 紙
  c.save(); c.translate(Wc / 2, Hc / 2 + 6); c.rotate(-0.012)
  const pw = Wc - 150, ph = Hc - 150
  c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = 18; c.shadowOffsetY = 8
  c.fillStyle = '#f7f3e8'; c.fillRect(-pw / 2, -ph / 2, pw, ph); c.shadowColor = 'transparent'
  // テープ
  c.fillStyle = 'rgba(242,194,48,.78)'; c.save(); c.rotate(-0.06); c.fillRect(-90, -ph / 2 - 24, 180, 46); c.restore()
  const L = -pw / 2 + 60
  c.fillStyle = INK; c.textAlign = 'left'; c.textBaseline = 'alphabetic'
  c.font = F(900, 64, true); c.fillText(cd.head, L, -ph / 2 + 128)
  c.fillStyle = '#c8323c'; c.fillRect(L, -ph / 2 + 150, pw - 120, 6)
  c.fillStyle = INK; c.font = F(900, 40); c.fillText(cd.lead, L, -ph / 2 + 222)
  // 写真（この大人）
  const phX = pw / 2 - 60 - 330, phY = -ph / 2 + 272, phW = 330, phH = 400
  c.fillStyle = '#fff'; c.fillRect(phX - 14, phY - 14, phW + 28, phH + 80); c.strokeStyle = 'rgba(0,0,0,.15)'; c.lineWidth = 2; c.strokeRect(phX - 14, phY - 14, phW + 28, phH + 80)
  photo(c, phX, phY, phW, phH)
  c.fillStyle = INK; c.font = F(900, 30, true); c.textAlign = 'center'; c.fillText(cd.photo, phX + phW / 2, phY + phH + 50); c.textAlign = 'left'
  // 記録
  c.font = F(900, 34); c.fillStyle = '#5d6170'; c.fillText(cd.rec, L, -ph / 2 + 320)
  c.fillStyle = INK; c.font = F(900, 190); const num = h.toFixed(1); c.fillText(num, L - 6, -ph / 2 + 500)
  const nw = c.measureText(num).width; c.font = F(900, 72); c.fillText('m', L + nw + 4, -ph / 2 + 500)
  c.font = F(900, 46, true)
  const rkLines = wrapT(c, rk[lang], phX - L - 30)
  rkLines.forEach((l, i) => c.fillText(l, L, -ph / 2 + 580 + i * 56))
  // 落ち方など
  let y = -ph / 2 + 760
  const wf = worstFall()
  c.font = F(900, 30); c.fillStyle = '#5d6170'; c.fillText(cd.fall, L, y)
  c.fillStyle = INK; c.font = F(900, 46)
  const fallTxt = w.why === 'closing' && !wf ? cd.closed : wf ? `${D.FALLS[wf.pose][lang]}（${wf.h.toFixed(0)}m）` : cd.none
  wrapT(c, fallTxt, pw - 120).forEach((l, i) => c.fillText(l, L, y + 58 + i * 54))
  y += 150
  c.font = F(900, 34); c.fillText(cd.swings(w.bestIdx), L, y)
  if (w.pigeons) { c.fillText(cd.pigeons(w.pigeons), L, y + 52) }
  // ハンコ
  c.save(); c.translate(pw / 2 - 170, ph / 2 - 150); c.rotate(-0.18)
  c.strokeStyle = 'rgba(200,50,60,.85)'; c.lineWidth = 8; c.beginPath(); c.arc(0, 0, 92, 0, 7); c.stroke(); c.beginPath(); c.arc(0, 0, 78, 0, 7); c.lineWidth = 3; c.stroke()
  c.fillStyle = 'rgba(200,50,60,.9)'; c.textAlign = 'center'; c.font = F(900, lang === 'ja' ? 26 : 17)
  const off = cd.office; if (lang === 'ja') { c.fillText(off.slice(0, 4), 0, -6); c.fillText(off.slice(4), 0, 28) } else { c.fillText('Park Mgmt', 0, -4); c.fillText('Office', 0, 22) }
  c.restore()
  c.textAlign = 'left'; c.fillStyle = '#5d6170'; c.font = F(900, 26); c.fillText('tom3games.com', L, ph / 2 - 50)
  c.restore()
}
function wrapT(c, s, maxW) {
  const out = []; let cur = ''
  for (const ch of (lang === 'ja' ? [...s] : s.split(/(?<= )/))) { if (c.measureText(cur + ch).width > maxW && cur) { out.push(cur.trim()); cur = ch } else cur += ch }
  if (cur) out.push(cur.trim()); return out
}
// 写真の中身: 一番高く登ったブランコで立ち漕ぎしている所
function photo(c, x, y, pw, ph) {
  const keep = { W, H, cam: { ...G.cam }, cy: G.cy, prev: G.prev, alpha: G.alpha, sx: G.shx, sy: G.shy, me: { ...w.me }, misses: w.misses, best: G.selfBest, fx: G.fx, lines: G.lines, flash: G.flash, slowT: G.slowT, bub: G.bub, birds: G.flyBirds, shoe: G.shoeFly, man: G.manager }
  const s = w.swings[w.bestIdx] || w.swings[0]
  c.save(); c.beginPath(); c.rect(x, y, pw, ph); c.clip(); c.translate(x, y)
  W = pw; H = ph; G.prev = null; G.alpha = 1; G.shx = 0; G.shy = 0; G.selfBest = 0; G.fx = []; G.lines = []; G.flash = 0; G.slowT = 0; G.flyBirds = []; G.shoeFly = null; G.manager = null
  G.cam = { x: s.x + 0.3, y: s.y - s.C * 0.55, s: pw / 4.4 }; G.cy = ph * 0.5
  const th0 = s.th
  s.th = 0.55
  Object.assign(w.me, { mode: 'swing', si: s.i, th: 0.55, L: s.C - P.stand })
  try { render(c, pw, ph, { noPreview: true, noSpeed: true, tf: c.getTransform() }) } catch (e) { console.warn(e) }
  s.th = th0
  c.restore()
  // セピアっぽく
  c.fillStyle = 'rgba(255,220,160,.12)'; c.fillRect(x, y, pw, ph)
  W = keep.W; H = keep.H; G.cam = keep.cam; G.cy = keep.cy; G.prev = keep.prev; G.alpha = keep.alpha; G.shx = keep.sx; G.shy = keep.sy; Object.assign(w.me, keep.me); G.selfBest = keep.best; G.fx = keep.fx; G.lines = keep.lines; G.flash = keep.flash; G.slowT = keep.slowT; G.bub = keep.bub; G.flyBirds = keep.birds; G.shoeFly = keep.shoe; G.manager = keep.man
}
function fitRes() {
  const box = $('#resBox').getBoundingClientRect(), el = $('#res')
  const ww = Math.min(box.width, box.height * 0.8)
  el.style.width = ww + 'px'; el.style.height = (ww * 1.25) + 'px'
}
function drawRes() { const el = $('#res'); drawCard(el.getContext('2d'), el.width, el.height); fitRes() }
function showEnd() {
  G.scene = 'end'; show('#vEnd')
  allLoopsOff(); loop('bgmT', 0.22)
  for (const k of ['body', 'hand']) { held[k].clear(); setPad(k) }
  const h = w.best, b = readBest()
  if (h > b) { try { localStorage.setItem('ss_best', String(h)) } catch (e) {} }
  const wf = worstFall()
  G.result = { best: h, rank: rankOf(h)[lang], newBest: h > b, swings: w.bestIdx, misses: w.misses, why: w.why, fall: wf ? D.FALLS[wf.pose][lang] : null, flips: w.flips, loops: w.loops, pigeons: w.pigeons, t: +w.t.toFixed(1), ticks: w.tick }
  sfx(h >= 10 ? 'jgood' : 'jmeh', { vol: 0.6, delay: 0.3 })
  drawRes(); const el = $('#res'); el.classList.remove('in'); void el.offsetWidth; el.classList.add('in')
  window.TM && TM.end(Math.round(h * 10) / 10, h >= 10)
  applyLang()
}
on('#bSave', async () => {
  window.TM && TM.share('save')
  const el = $('#res')
  el.toBlob(async blob => {
    if (!blob) return
    const file = new File([blob], 'sky-swing.png', { type: 'image/png' })
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return } catch (e) { if (e && e.name === 'AbortError') return } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'sky-swing.png'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
  }, 'image/png')
})
on('#bPost', () => {
  window.TM && TM.share('x')
  const r = G.result || { best: 0, rank: '' }
  const u = 'https://x.com/intent/post?text=' + encodeURIComponent(T().postText(r.best.toFixed(1), r.rank)) + '&url=' + encodeURIComponent('https://tom3games.com/play/sky-swing/')
  window.open(u, '_blank', 'noopener')
})

// ---- 読み込み（フォント・短い音を先に） ----
async function boot() {
  applyLang(); setMuteIcons(); resize(); drawShoes()
  const list = ['snd/creak1.mp3', 'snd/clank1.mp3', 'snd/swish1.mp3', 'snd/thud1.mp3', 'snd/splash1.mp3', 'snd/click.mp3']
  let done = 0; const total = list.length + 1, bar = $('#loadBar i')
  const tickL = () => { done++; bar.style.width = Math.round(done / total * 100) + '%' }
  const font = (document.fonts ? Promise.all([document.fonts.load('400 40px "Yusei Magic"', '天空ブランコ公園からのお知らせ'), document.fonts.load('900 20px "Zen Kaku Gothic New"', '立つ丸まるつかむ0123456789m'), document.fonts.load('500 20px "Zen Kaku Gothic New"', 'あ')]) : Promise.resolve()).catch(() => {}).then(tickL)
  const snds = list.map(u => fetch(u).then(r => r.arrayBuffer()).catch(() => {}).then(tickL))
  await Promise.race([Promise.all([font, ...snds]), new Promise(r => setTimeout(r, 12000))])
  const l = $('#loading'); l.style.opacity = '0'; setTimeout(() => { l.style.display = 'none' }, 380)
  sizeTitleArt()
  window.__ssReady = true
}
requestAnimationFrame(frame)
boot()

// ---- ?demo=1: 実機・シミュレーターでの通し確認。bot の入力を本物の pointer イベントで座面ボタンへ送る（鳴らさない） ----
const demoDown = { body: false, hand: false }
function syncDemoPads(inp) {
  for (const k of ['body', 'hand']) {
    if (!!inp[k] === demoDown[k]) continue
    demoDown[k] = !!inp[k]
    const r = pads[k].getBoundingClientRect()
    pads[k].dispatchEvent(new PointerEvent(inp[k] ? 'pointerdown' : 'pointerup', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: k === 'body' ? 31 : 32, pointerType: 'touch' }))
  }
}
if (/[?&]demo=1/.test(location.search)) {
  muted = true; Snd.setMute(true); setMuteIcons()
  const go = () => {
    if (!window.__ssReady) return setTimeout(go, 200)
    $('#bStart').click()
    G.demo = true
    const bot = SS_BOTS.makeBot(PH, SS_BOTS.BOTS.human, Math.random)
    G.bot = w2 => { const o = bot(w2); return o }
  }
  go()
}

// ---- 検証用の窓口 ----
function runBot(name, maxSec = 400, seed = 1, botSeed = 7) {
  let rs = botSeed; const Rb = () => (rs = rs * 16807 % 2147483647) / 2147483647
  const bot = SS_BOTS.makeBot(PH, SS_BOTS.BOTS[name], Rb)
  startGame(seed); G.paused = true; G.bot = bot
  while (w.phase !== 'over' && w.t < maxSec) tick()
  G.bot = null
  return { best: w.best, idx: w.bestIdx, t: +w.t.toFixed(1), why: w.why || 'time', misses: w.misses, falls: w.falls.length, ticks: w.tick }
}
window.ss = {
  G, D, PH, start: startGame, result: () => G.result, rankOf, lang: () => lang, w: () => w,
  state: () => ({ scene: G.scene, phase: w.phase, t: +w.t.toFixed(2), tick: w.tick, best: w.best, idx: w.bestIdx, misses: w.misses, si: w.me.si, mode: w.me.mode, x: +w.me.x.toFixed(3), y: +w.me.y.toFixed(3), th: +(w.me.th || 0).toFixed(4), why: w.why || '', tut: $('#tut').hidden ? '' : $('#tutT').textContent, bub: G.bub && G.bub.until > realT ? G.bub.text : '', pop: G.popUntil > realT ? $('#pop').textContent : '' }),
  padXY: k => { const r = pads[k].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } },
  runBot,
  dbg: {
    pause(b = true) { G.paused = b; lastT = performance.now(); acc = 0 },
    tick(n = 1) { for (let i = 0; i < n; i++) { if (w.phase === 'over') tickOver(); else tick() } },
    step(n = 1) { this.tick(n); camStep(n / 60); for (let i = 0; i < 30; i++) camStep(0.05); render(); placeBub(); tutUpdate() },
    advance, render: () => render(), drawRes, camSnap() { for (let i = 0; i < 60; i++) camStep(0.05) },
    setBot(name, botSeed = 7) { if (!name) { G.bot = null; return } let rs = botSeed; const Rb = () => (rs = rs * 16807 % 2147483647) / 2147483647; G.bot = SS_BOTS.makeBot(PH, SS_BOTS.BOTS[name], Rb) },
    finish() { w.misses = 1; w.falls.push({ kind: 'sand', pose: 'sandHead', h: Math.max(3, w.best + 2), from: 1 }); w.phase = 'over'; w.why = 'shoes'; G.ended = true; G.endAt = w.t; showEnd() },
    // 台本用: ブランコ j に乗せる（勢い om）
    put(j, th = 0.5, om = 0) { if (w.swings.length < j + 8) { w.bestIdx = Math.max(w.bestIdx, j); w.phase = 'swing'; w.me.mode = 'swing'; w.me.si = Math.max(0, w.me.si); PH.step(w, { body: false, hand: true }); w.ev.length = 0 } const s = w.swings[j]; Object.assign(w.me, { mode: 'swing', si: j, th, L: s.C - P.squat, h: om * (s.C - P.squat) ** 2, tk: 0 }); w.phase = 'swing'; s.th = th; const L = w.me.L; w.me.x = s.x + L * Math.sin(th); w.me.y = s.y - L * Math.cos(th); w.bestIdx = Math.max(w.bestIdx, j); w.best = Math.max(w.best, +(s.y - s.C - 0.4).toFixed(2)); G.inp.hand = true; G.prev = null },
    air(x, y, vx, vy, phi = 0, spin = 0, tk = 0) { Object.assign(w.me, { mode: 'air', si: -1, x, y, vx, vy, phi, spin, Lb: spin, tk, relT: w.t - 1, relFrom: Math.max(0, w.me.si) }); w.phase = 'air'; G.prev = null },
  },
}
})()
