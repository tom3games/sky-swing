import './mute-auto.mjs'
// 台本どおりに進めて撮る。node shot.mjs [幅 高さ]
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
const ROOT = import.meta.dirname, PORT = +(process.env.PORT || 6592)
mkdirSync(ROOT + '/shots', { recursive: true })
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const w = +(process.argv[2] || 390), h = +(process.argv[3] || 844)
const b = await chromium.launch(MUTE_LAUNCH)
const ctx = await b.newContext({ locale: 'ja-JP', viewport: { width: w, height: h }, deviceScaleFactor: 2 })
await muteContext(ctx)
const p = await ctx.newPage(); const errs = []
p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()) })
await p.goto(`http://localhost:${PORT}/`); await p.waitForFunction(() => window.__ssReady)
await p.waitForTimeout(700)
await p.screenshot({ path: `shots/title_${w}.png` })
await p.click('#bStart'); await p.evaluate(() => { ss.dbg.pause() })
await p.evaluate(() => { ss.dbg.step(30) })
await p.screenshot({ path: `shots/play0_${w}.png` })
// 上手い bot で途中まで
await p.evaluate(() => { ss.dbg.setBot('good', 3); for (let i = 0; i < 60 * 40 && ss.w().bestIdx < 4; i++) ss.dbg.tick(1); ss.dbg.step(1) })
await p.screenshot({ path: `shots/play1_${w}.png` })
await p.evaluate(() => { for (let i = 0; i < 60 * 3 && ss.w().phase !== 'air'; i++) ss.dbg.tick(1); ss.dbg.tick(12); ss.dbg.step(1) })
await p.screenshot({ path: `shots/play2_air_${w}.png` })
await p.evaluate(() => { ss.dbg.setBot(null); ss.start(5); ss.dbg.pause() })
for (const [j, nm] of [[8, 'mid'], [14, 'high'], [22, 'cloud'], [32, 'sky']]) {
  await p.evaluate(j => { ss.dbg.setBot(null); ss.dbg.put(j, 0.9, 0); ss.dbg.step(2) }, j)
  await p.screenshot({ path: `shots/play_${nm}_${w}.png` })
}
await p.evaluate(() => { ss.dbg.put(3, 0.5, 0); ss.dbg.air(ss.w().me.x + 1, 9, 0, -14, 3, 0); for (let i = 0; i < 400 && ss.w().phase !== 'down'; i++) ss.dbg.tick(1); ss.dbg.tick(20); ss.dbg.step(1) })
await p.screenshot({ path: `shots/play_land_${w}.png` })
await p.evaluate(() => { ss.dbg.finish() })
await p.waitForTimeout(700)
await p.screenshot({ path: `shots/end_${w}.png` })
console.log(JSON.stringify(await p.evaluate(() => ss.state())), errs)
await b.close(); server.kill()
