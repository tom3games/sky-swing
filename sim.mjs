// 遊び方ごとの分布（ブラウザを開かない。Node で物理だけ回す）。node sim.mjs [回数=12] [bot名,...]
// 上手い入力（下で立つ）と下手な入力（でたらめ・逆・漕がない・何もしない）で、高さと時間に差が出るかを見る
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const PH = require('./phys.js'), { makeBot, BOTS } = require('./bots.js')
const N = +(process.argv[2] || 12), ONLY = process.argv[3]
if (process.env.TUNE) Object.assign(PH.P, JSON.parse(process.env.TUNE))
function run(cfg, seed, botSeed, maxSec = 600) {
  const w = PH.makeWorld(seed)
  let rs = botSeed; const Rb = () => (rs = rs * 16807 % 2147483647) / 2147483647
  const bot = makeBot(PH, cfg, Rb)
  let firstGrab = -1
  while (w.phase !== 'over' && w.t < maxSec) {
    PH.step(w, bot(w))
    for (const e of w.ev) if (e.t === 'grab' && e.first && firstGrab < 0) firstGrab = w.t
    w.ev.length = 0
  }
  return { best: w.best, idx: w.bestIdx, t: Math.round(w.t), first: firstGrab < 0 ? -1 : +firstGrab.toFixed(1), falls: w.falls.length, flips: w.flips, loops: w.loops, why: w.why || 'time' }
}
export function simAll(n = N, only = ONLY) {
  const out = {}
  for (const [name, cfg] of Object.entries(BOTS)) {
    if (only && !only.split(',').includes(name)) continue
    const rows = []
    for (let s = 1; s <= n; s++) rows.push(run(cfg, s * 101 + 7, s * 7919 + 13))
    const med = k => rows.map(r => r[k]).sort((a, b) => a - b)[Math.floor(n / 2)]
    out[name] = { medBest: med('best'), min: Math.min(...rows.map(r => r.best)), max: Math.max(...rows.map(r => r.best)), medIdx: med('idx'), medSec: med('t'), medFirst: med('first'), noFirst: rows.filter(r => r.first < 0).length, flips: rows.reduce((a, r) => a + r.flips, 0), bests: rows.map(r => r.best.toFixed(1)).join(','), why: [...new Set(rows.map(r => r.why))].join('/') }
  }
  return out
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const o = simAll()
  for (const [k, v] of Object.entries(o)) console.log(k.padEnd(6), JSON.stringify(v))
}
