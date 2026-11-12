import './mute-auto.mjs'
// SNS 用の画像 og.png（1200x630）。電柱からクレーンへ飛び移る途中の大人＋下で見上げる子ども＋題名。node og.mjs
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
const ROOT = import.meta.dirname, PORT = +(process.env.PORT || 6594)
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const b = await chromium.launch(MUTE_LAUNCH), ctx = await b.newContext({ locale: 'ja-JP', viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
await muteContext(ctx)
const p = await ctx.newPage()
await p.goto(`http://localhost:${PORT}/`); await p.waitForFunction(() => window.__ssReady)
await p.click('#bStart'); await p.evaluate(() => ss.start(11))
await p.evaluate(async () => {
  ss.dbg.pause()
  document.querySelector('#hud').style.display = 'none'; document.querySelector('#pads').style.display = 'none'; document.querySelector('#tut').style.display = 'none'
  for (const el of document.querySelectorAll('#tmSupport,#tmHome')) el.style.display = 'none'
  ss.dbg.put(2, 0.2, 0)
  const w = ss.w(), s2 = w.swings[2], s3 = w.swings[3]
  // 2 と 3 の間を飛んでいる所
  const mx = s2.x + (s3.x - s2.x) * 0.55, my = Math.max(s2.y, s3.y) - 1.0
  ss.dbg.air(mx, my, Math.sign(s3.x - s2.x) * 4, 1.5, -0.5 * Math.sign(s3.x - s2.x), 0, 0.15)
  ss.G.face = Math.sign(s3.x - s2.x) || 1
  ss.G.cam = { x: mx - 2.75, y: my - 0.6, s: 78 }
  ss.G.cy = 630 * 0.5
  for (let i = 0; i < 30; i++) ss.G.lines.push({ x: Math.random() * 1200, y: Math.random() * 630, t: Math.random() * 0.15 })
  ss.G.bub = null
  ss.dbg.render()
  const d = document.createElement('div')
  d.style.cssText = 'position:fixed;left:44px;top:40px;z-index:50;font-family:"Yusei Magic";color:#1f2433'
  d.innerHTML = '<div style="font-size:112px;line-height:1;text-shadow:0 4px 0 #fff">天空<br><span style="margin-left:.9em">ブランコ</span></div><div style="margin-top:18px;font:900 30px \'Zen Kaku Gothic New\';background:#fff;display:inline-block;padding:4px 14px;transform:rotate(-1.5deg)">公園の大人が、本気で漕いだら。</div>'
  document.body.appendChild(d)
  await document.fonts.ready
})
await p.waitForTimeout(400)
await p.screenshot({ path: ROOT + '/og.png' })
console.log('og.png')
await b.close(); server.kill()
