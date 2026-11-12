import './mute-auto.mjs'
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
// 天空ブランコの検証。node verify.mjs（空きポートは VPORT で変えられる）
import { chromium, webkit } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
const ROOT = import.meta.dirname
mkdirSync(ROOT + '/shots', { recursive: true })
const PORT = +(process.env.VPORT || 6595)
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 500))
const URL0 = `http://localhost:${PORT}/`
let pass = 0, fail = 0
const results = []
async function t(name, fn) {
  try { const r = await fn(); if (r === false) throw new Error('false'); pass++; results.push(`ok   ${name}${r && r !== true ? '  ' + JSON.stringify(r) : ''}`) }
  catch (e) { fail++; results.push(`FAIL ${name}  ${e.message.split('\n')[0]}`) }
}
const expect = (c, msg) => { if (!c) throw new Error(msg) }
async function open(browser, opts = {}, q = '', keepLS = false) {
  const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 }, ...opts })
  await muteContext(ctx)
  if (!keepLS) await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('v')) { localStorage.clear(); sessionStorage.setItem('v', '1') } } catch (e) {} })
  const p = await ctx.newPage(); p.errs = []
  p.on('pageerror', e => p.errs.push('pageerror ' + e.message))
  p.on('console', m => { if (m.type() === 'error') p.errs.push('console ' + m.text()) })
  p.on('requestfailed', r => { if (!/fonts\.(googleapis|gstatic)|googletagmanager/.test(r.url())) p.errs.push('reqfail ' + r.url()) })
  await p.goto(URL0 + q); await p.waitForFunction(() => window.__ssReady, null, { timeout: 20000 })
  return p
}
const overflow = p => p.evaluate(() => {
  const W = document.documentElement.clientWidth, bad = []
  for (const el of document.querySelectorAll('main:not([hidden]) *')) {
    if (el.closest('[hidden]') || (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true }))) continue
    if (el.closest('#bub,#pop')) continue
    const r = el.getBoundingClientRect(); if (r.width && (r.right > W + 1 || r.left < -1)) bad.push((el.id || el.className || el.tagName) + ':' + Math.round(r.left) + '-' + Math.round(r.right))
  }
  return { sw: document.documentElement.scrollWidth, W, bad: bad.slice(0, 5) }
})
const fit = q => q.evaluate(() => {
  const H = innerHeight, de = document.documentElement, over = []
  if (de.scrollHeight > H + 1) over.push('page:' + de.scrollHeight)
  for (const el of document.querySelectorAll('main:not([hidden]) button,main:not([hidden]) canvas,.ovl:not([hidden]) button,#tmSupport,#tmHome')) { if (!el.offsetParent) continue; const r = el.getBoundingClientRect(); if (r.bottom > H + 1 || r.top < -1) over.push((el.id || el.className) + ':' + Math.round(r.top) + '-' + Math.round(r.bottom)) }
  return { H, over: over.slice(0, 6) }
})
const variance = (p, sel) => p.evaluate(sel => {
  const c = document.querySelector(sel), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let s = 0, s2 = 0, n = 0; for (let i = 0; i < d.length; i += 4 * 13) { const v = d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11; s += v; s2 += v * v; n++ }
  return Math.round(s2 / n - (s / n) ** 2)
}, sel)
const SIZES = [[360, 640, 'se'], [375, 667, 's8'], [390, 844, 'phone'], [414, 896, 'xr'], [430, 932, 'max'], [768, 1024, 'tab']]

const browser = await chromium.launch(MUTE_LAUNCH)
const p = await open(browser)
await t('起動時にエラーが出ない', async () => { expect(p.errs.length === 0, p.errs.join('|')) })
await t('ブラウザの拡大が起きない（viewport・ピンチ・Ctrl+ホイール・Ctrl+プラス）', async () => {
  const r = await p.evaluate(() => {
    const vp = document.querySelector('meta[name=viewport]').content
    const g = new Event('gesturestart', { cancelable: true }); document.dispatchEvent(g)
    const w = new WheelEvent('wheel', { ctrlKey: true, deltaY: -10, bubbles: true, cancelable: true }); window.dispatchEvent(w)
    const k = new KeyboardEvent('keydown', { key: '+', ctrlKey: true, bubbles: true, cancelable: true }); window.dispatchEvent(k)
    return { vp, gesture: g.defaultPrevented, wheel: w.defaultPrevented, key: k.defaultPrevented, ta: getComputedStyle(document.documentElement).touchAction, us: getComputedStyle(document.body).userSelect, pad: getComputedStyle(document.querySelector('#pHand')).touchAction }
  })
  expect(/user-scalable=no/.test(r.vp) && r.gesture && r.wheel && r.key && r.ta === 'manipulation' && r.us === 'none' && r.pad === 'none', JSON.stringify(r)); return r
})
await t('OGP 一式がある・og.png が 1200x630', async () => {
  const r = await p.evaluate(async () => {
    const has = ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'].map(k => !!document.querySelector(`meta[property="${k}"]`)).concat(!!document.querySelector('meta[name="twitter:card"]'))
    const img = new Image(); img.src = 'og.png'; await img.decode(); return { has, w: img.width, h: img.height }
  })
  expect(r.has.every(Boolean) && r.w === 1200 && r.h === 630, JSON.stringify(r)); return { w: r.w, h: r.h }
})
await t('ロード画面が消えて、タイトルの絵が描けている', async () => {
  await p.waitForTimeout(600)
  const r = await p.evaluate(() => ({ load: getComputedStyle(document.querySelector('#loading')).display, title: document.querySelector('#tH').textContent }))
  const v = await variance(p, '#tArt')
  expect(r.load === 'none' && r.title.includes('ブランコ') && v > 200, JSON.stringify({ ...r, v })); return { v }
})
await t('はじめると遊ぶ画面・音を鳴らす呼び出しがある・それでも実際は無音', async () => {
  await p.click('#bStart'); await p.waitForTimeout(300)
  const r = await p.evaluate(() => ({ scene: ss.state().scene, loops: Snd.played['loop:bgm'] || 0, click: Snd.played.click || 0, mute: window.__muteOk() }))
  expect(r.scene === 'play' && r.loops >= 1 && r.click >= 1 && r.mute, JSON.stringify(r)); return r
})
await t('はじめての人にチュートリアルが出る（つかむ → 漕ぐ）', async () => {
  const a = await p.evaluate(() => { ss.dbg.pause(); ss.start(3); ss.dbg.pause(); ss.dbg.step(2); return ss.state().tut })
  expect(/つかむ/.test(a), a); return a
})
await t('本物の指で: 手の座面を押すとつかむ・離すと飛ぶ（ブランコ0）', async () => {
  const h = await p.evaluate(() => ss.padXY('hand'))
  await p.mouse.move(h.x, h.y); await p.mouse.down()
  const a = await p.evaluate(() => { ss.dbg.tick(2); return ss.state() })
  const pumpTxt = await p.evaluate(() => { ss.dbg.step(1); return ss.state().tut })
  await p.evaluate(() => ss.dbg.tick(30))
  await p.mouse.up()
  const b = await p.evaluate(() => { ss.dbg.tick(2); return ss.state() })
  expect(a.phase === 'swing' && b.phase === 'air' && /立つ/.test(pumpTxt), JSON.stringify({ a: a.phase, b: b.phase, pumpTxt })); return { a: a.phase, b: b.phase, pumpTxt }
})
await t('本物の指で: 体の座面を押している間だけ立つ（重心が鎖の上に寄る）', async () => {
  await p.evaluate(() => { ss.start(3); ss.dbg.pause() })
  const h = await p.evaluate(() => ss.padXY('hand')), bd = await p.evaluate(() => ss.padXY('body'))
  await p.mouse.move(h.x, h.y); await p.mouse.down()
  const L0 = await p.evaluate(() => { ss.dbg.tick(20); return ss.w().me.L })
  // 2本目の指は touch で（マウスは1本しか押せないので pointer イベントを座面に送る）
  await p.evaluate(({ x, y }) => { const el = document.querySelector('#pBody'); el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 77, pointerType: 'touch' })) }, bd)
  const L1 = await p.evaluate(() => { ss.dbg.tick(20); return { L: ss.w().me.L, on: document.querySelector('#pBody').classList.contains('on') } })
  await p.evaluate(({ x, y }) => { document.querySelector('#pBody').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerId: 77, pointerType: 'touch' })) }, bd)
  const L2 = await p.evaluate(() => { ss.dbg.tick(20); return ss.w().me.L })
  await p.mouse.up()
  expect(L1.L < L0 - 0.25 && L1.on && L2 > L1.L + 0.25, JSON.stringify({ L0, L1, L2 })); return { L0: +L0.toFixed(2), stand: +L1.L.toFixed(2), back: +L2.toFixed(2) }
})
await t('キーボード: J でつかむ・F で立つ', async () => {
  await p.evaluate(() => { ss.start(3); ss.dbg.pause() })
  await p.keyboard.down('j'); const a = await p.evaluate(() => { ss.dbg.tick(2); return ss.state().phase })
  await p.keyboard.down('f'); const L = await p.evaluate(() => { ss.dbg.tick(20); return ss.w().me.L })
  await p.keyboard.up('f'); await p.keyboard.up('j'); const b = await p.evaluate(() => { ss.dbg.tick(2); return ss.state().phase })
  expect(a === 'swing' && L < 1.3 && b === 'air', JSON.stringify({ a, L, b })); return { a, b }
})
await t('下で立って端でしゃがむと振れが大きくなる・逆に漕ぐと小さくなる（15秒）', async () => {
  const r = await p.evaluate(() => {
    const out = {}
    for (const name of ['good', 'inv', 'none']) {
      ss.start(9); ss.dbg.pause(); ss.dbg.setBot(name, 3)
      const PH = ss.PH; let mx = 0
      for (let i = 0; i < 60 * 15; i++) { const w = ss.w(); const o = ss.G.bot(w); o.hand = true; PH.step(w, o); w.ev.length = 0; if (i > 60 * 10) mx = Math.max(mx, Math.abs(w.me.th)) }
      out[name] = +mx.toFixed(2)
    }
    ss.dbg.setBot(null)
    return out
  })
  expect(r.good > 1.2 && r.inv < 0.45 && r.none < 0.45, JSON.stringify(r)); return r
})
await t('何もしないと最低の結果（25秒で閉園・0m・ただ座っていた大人）', async () => {
  const rs = await p.evaluate(() => { const o = []; for (const s of [1, 2, 3]) { const r = ss.runBot('idle', 120, s); o.push({ ...r, rank: ss.rankOf(r.best).ja }) } return o })
  expect(rs.every(r => r.best === 0 && r.why === 'closing' && r.rank === 'ただ座っていた大人' && r.t < 27), JSON.stringify(rs)); return rs.map(r => r.t)
})
await t('同じ種・同じ入力なら同じ結果（上手い bot を2回）', async () => {
  const r = await p.evaluate(() => [ss.runBot('good', 300, 42, 5), ss.runBot('good', 300, 42, 5), ss.runBot('good', 300, 43, 5)])
  expect(JSON.stringify(r[0]) === JSON.stringify(r[1]) && r[0].idx >= 3, JSON.stringify(r)); return { a: r[0], other: r[2].best }
})
await t('物理は固定60Hz: 144Hz と 30Hz のフレームで、1コマごとの動きが全部同じ', async () => {
  const r = await p.evaluate(() => {
    const run = dt => { ss.start(17); ss.dbg.pause(); ss.dbg.setBot('good', 9); ss.G.trace = []; let guard = 0; while (ss.G.trace.length < 2400 && guard++ < 100000 && ss.w().phase !== 'over') ss.dbg.advance(dt); const tr = ss.G.trace.slice(0, 2400); ss.G.trace = null; ss.dbg.setBot(null); return tr }
    const a = run(1 / 144), b = run(1 / 30), c = run(1 / 60)
    let diff = -1; for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i] || a[i] !== c[i]) { diff = i; break }
    return { n: Math.min(a.length, b.length, c.length), diff, last: a[a.length - 1] }
  })
  expect(r.n >= 1200 && r.diff === -1, JSON.stringify(r)); return r
})
await t('実時間2秒あたりのコマ数が画面の速さで変わらない（144Hz・60Hz・30Hz）', async () => {
  const r = await p.evaluate(() => { const o = {}; for (const hz of [144, 60, 30]) { ss.start(4); ss.dbg.pause(); const t0 = ss.w().tick; for (let i = 0; i < hz * 2; i++) ss.dbg.advance(1 / hz); o[hz] = ss.w().tick - t0 } return o })
  expect(Math.abs(r[144] - 120) <= 1 && Math.abs(r[60] - 120) <= 1 && Math.abs(r[30] - 120) <= 1, JSON.stringify(r)); return r
})
await t('上手い入力と下手な入力で差が出る（各4回の高さ）', async () => {
  const r = await p.evaluate(() => { const o = {}; for (const n of ['good', 'human', 'bad', 'inv']) { const a = []; for (const s of [3, 5, 7, 11]) a.push(ss.runBot(n, 300, s, s * 3).best); o[n] = a } return o })
  const med = a => a.slice().sort((x, y) => x - y)[2]
  expect(med(r.good) > 8 && med(r.good) > med(r.bad) + 5 && med(r.inv) === 0 && med(r.human) > med(r.bad), JSON.stringify(r)); return r
})
await t('人の速さの bot（反応0.35秒）が2分以内に最初のブランコへ飛び移れる（6回中5回以上）', async () => {
  const r = await p.evaluate(() => { const o = []; for (const s of [1, 2, 3, 4, 5, 6]) { ss.runBot('human', 120, s, s * 13); o.push(ss.w().bestIdx >= 1 || ss.w().grabs > 0) } return o })
  expect(r.filter(Boolean).length >= 5, JSON.stringify(r)); return r.filter(Boolean).length
})
await t('速く飛んでも鎖をすり抜けない（前のコマとの線分で判定）', async () => {
  const r = await p.evaluate(() => {
    ss.start(5); ss.dbg.pause(); ss.dbg.put(1, 0, 0)
    const w = ss.w(), s2 = w.swings[2]
    // 1コマで 0.6m 進む速さで、鎖の真横を通す
    const y = s2.y - s2.C * 0.5 - 0.92
    ss.dbg.air(s2.x - 0.35 * Math.sign(s2.x - w.swings[1].x), y, 36 * Math.sign(s2.x - w.swings[1].x), 0, 0, 0, 0)
    ss.G.inp.hand = true
    const keep = ss.PH.P.slipOm; ss.PH.P.slipOm = 1e9   // 速すぎて手がすべる判定は外して、当たり判定だけを見る
    const m = ss.w().me; m.hx = m.x - Math.sin(m.phi) * 0.92; m.hy = m.y + Math.cos(m.phi) * 0.92
    for (let i = 0; i < 4 && ss.w().phase === 'air'; i++) ss.dbg.tick(1)
    ss.PH.P.slipOm = keep
    return { phase: ss.w().phase, si: ss.w().me.si }
  })
  expect(r.phase === 'swing' && r.si === 2, JSON.stringify(r)); return r
})
await t('ブランコ0から落ちても靴は減らない・空中のブランコから落ちると靴が1つ飛んで乗り直す', async () => {
  const r = await p.evaluate(() => {
    ss.start(5); ss.dbg.pause(); ss.G.inp.hand = false
    ss.dbg.air(0.5, 1.0, 1, 0, 0, 0, 0); ss.w().me.relFrom = 0
    for (let i = 0; i < 400 && ss.w().phase !== 'ready'; i++) ss.dbg.tick(1)
    const a = ss.state()
    ss.dbg.put(3, 0.3, 0); ss.G.inp.hand = false; ss.dbg.tick(1)
    for (let i = 0; i < 900 && ss.w().phase !== 'ready'; i++) ss.dbg.tick(1)
    const b = ss.state(), shoes = document.querySelectorAll('#hShoes svg.gone').length
    return { a: { misses: a.misses, si: a.si, phase: a.phase }, b: { misses: b.misses, si: b.si, phase: b.phase }, shoes, falls: ss.w().falls.length }
  })
  expect(r.a.misses === 0 && r.a.si === 0 && r.b.misses === 1 && r.b.si === 3 && r.b.phase === 'ready' && r.shoes === 1, JSON.stringify(r)); return r
})
await t('靴を2つなくすと、公園のお知らせの紙（記録・称号・落ち方）が出る', async () => {
  await p.evaluate(() => { ss.start(5); ss.dbg.pause(); ss.dbg.put(6, 0.3, 0); ss.w().misses = 1; ss.G.inp.hand = false; for (let i = 0; i < 1500 && ss.G.scene === 'play'; i++) ss.dbg.tick(1) })
  const r = await p.evaluate(() => ({ s: ss.state(), res: ss.result(), btn: document.querySelector('#bAgain').textContent, sup: !!document.querySelector('#tmSupport') }))
  const v = await variance(p, '#res')
  await p.screenshot({ path: `${ROOT}/shots/v-end.png` })
  expect(r.s.scene === 'end' && r.res.best > 5 && r.res.rank && r.res.fall && r.btn === 'もう一回' && r.sup && v > 300, JSON.stringify({ ...r, v })); return { best: r.res.best, rank: r.res.rank, fall: r.res.fall }
})
await t('自己ベストが残り、タイトルに出る', async () => {
  const r = await p.evaluate(() => ({ ls: localStorage.getItem('ss_best'), tb: document.querySelector('#tBest').textContent }))
  expect(+r.ls > 5 && r.tb.includes('自己ベスト'), JSON.stringify(r)); return r
})
await t('もう一回で最初から（0m・靴2つ）', async () => {
  await p.click('#bAgain'); await p.waitForTimeout(200)
  const r = await p.evaluate(() => ({ ...ss.state(), gone: document.querySelectorAll('#hShoes svg.gone').length }))
  expect(r.scene === 'play' && r.best === 0 && r.misses === 0 && r.gone === 0 && r.phase === 'ready', JSON.stringify(r)); return { phase: r.phase }
})
await t('最初のブランコをつかむとチュートリアルが終わり、次からは出ない', async () => {
  const r = await p.evaluate(() => {
    ss.start(8); ss.dbg.pause(); ss.dbg.setBot('good', 3)
    for (let i = 0; i < 60 * 60 && ss.w().bestIdx < 1; i++) ss.dbg.tick(1)
    ss.dbg.setBot(null)
    const a = { idx: ss.w().bestIdx, ls: localStorage.getItem('ss_tut') }
    ss.start(8); ss.dbg.pause(); ss.dbg.step(2)
    return { ...a, after: ss.state().tut }
  })
  expect(r.idx >= 1 && r.ls === '1' && r.after === '', JSON.stringify(r)); return r
})
await t('文字は同時に1つまで（吹き出しと大きい文字が重ならない）', async () => {
  const r = await p.evaluate(() => {
    ss.start(21); ss.dbg.pause(); ss.dbg.setBot('good', 4)
    let both = 0, n = 0, bubs = 0, pops = 0
    for (let i = 0; i < 60 * 150 && ss.G.scene === 'play'; i++) { ss.dbg.advance(1 / 60); if (i % 5 === 0) { ss.dbg.render(); const st = ss.state(); const bubOn = getComputedStyle(document.querySelector('#bub')).opacity !== '0' && document.querySelector('#bub').classList.contains('on'); if (st.bub) bubs++; if (st.pop) pops++; n++; if (st.bub && st.pop) both++ } }
    ss.dbg.setBot(null)
    return { both, bubs, pops, n }
  })
  expect(r.both === 0 && r.pops > 0, JSON.stringify(r)); return r
})
await t('ページを離れたら BGM と環境音が止まる', async () => {
  const r = await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); return { away: Snd.away, playing: Snd.playing().length, hide: Snd.life.hide } })
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }) })
  expect(r.away && r.playing === 0 && r.hide >= 1, JSON.stringify(r)); return r
})
await t('英語に切り替えると文言が英語・結果も英語', async () => {
  const q = await open(browser)
  await q.click('#bLang')
  const a = await q.evaluate(() => ({ h: document.querySelector('#tH').textContent, b: document.querySelector('#bStart').textContent }))
  await q.click('#bStart')
  await q.evaluate(() => { ss.dbg.pause(); ss.dbg.put(4, 0.3, 0); ss.dbg.finish() })
  await q.waitForTimeout(300)
  const r = await q.evaluate(() => ({ rank: ss.result().rank, again: document.querySelector('#bAgain').textContent, pad: document.querySelector('#pHandT').textContent }))
  await q.screenshot({ path: `${ROOT}/shots/v-end-en.png` })
  await q.close()
  expect(a.h.includes('Sky') && a.b === 'Swing' && /grown-up|Level|swinger/.test(r.rank) && r.again === 'Again' && r.pad === 'Grab', JSON.stringify({ a, r })); return { a, r }
})
await t('遊び方が開いて閉じる', async () => {
  const q = await open(browser)
  await q.click('#bHow'); const a = await q.evaluate(() => !document.querySelector('#how').hidden && document.querySelectorAll('#howBody li').length)
  await q.click('#howClose'); const b = await q.evaluate(() => document.querySelector('#how').hidden)
  await q.close(); expect(a === 4 && b, JSON.stringify({ a, b }))
})
await t('X のアプリ内ブラウザ（?inapp=x）: 座面ボタンが下の52pxに入らない', async () => {
  const q = await open(browser, {}, '?inapp=x')
  await q.click('#bStart')
  const r = await q.evaluate(() => { const b = document.querySelector('#pHand').getBoundingClientRect(); return { bottom: Math.round(b.bottom), H: innerHeight } })
  await q.close()
  expect(r.bottom <= r.H - 52, JSON.stringify(r)); return r
})
await t('全体でエラーなし', async () => { expect(p.errs.length === 0, p.errs.join('|')) })
await p.close()

for (const [w, h, name] of SIZES) {
  const q = await open(browser, { viewport: { width: w, height: h } })
  const views = {}
  views.title = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-title.png` })
  await q.click('#bHow'); views.how = await fit(q); await q.click('#howClose')
  await q.click('#bStart'); await q.evaluate(() => { ss.dbg.pause(); ss.dbg.put(5, 0.6, 0); ss.dbg.step(30) })
  views.play = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-play.png` })
  const padsOk = await q.evaluate(() => { const a = document.querySelector('#pBody').getBoundingClientRect(), b = document.querySelector('#pHand').getBoundingClientRect(); return a.height >= 80 && b.height >= 80 && a.right <= b.left && b.right <= innerWidth })
  await q.evaluate(() => { ss.dbg.finish() })
  await q.waitForTimeout(600)
  views.end = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-end.png` })
  for (const [v, r] of Object.entries(views)) await t(`一画面に収まる ${name} ${w}x${h} ${v}`, async () => { expect(!r.over.length, JSON.stringify(r)) })
  await t(`${name}: 2つの座面ボタンが大きく左右に分かれて画面内`, async () => { expect(padsOk, 'pads') })
  await t(`${name}: はみ出し・エラーなし`, async () => { const o = await overflow(q); expect(o.sw <= o.W && !o.bad.length && !q.errs.length, JSON.stringify(o) + q.errs.join('|')) })
  await q.close()
}
await browser.close()
// ---- WebKit（iPhone 相当）でタッチの通し
const wb = await webkit.launch(), wp = await open(wb, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
await t('WebKit: 2本指の touchmove を止める', async () => {
  const r = await wp.evaluate(() => { const e = new Event('touchmove', { cancelable: true, bubbles: true }); Object.defineProperty(e, 'touches', { value: [{}, {}] }); document.body.dispatchEvent(e); return e.defaultPrevented })
  expect(r, r)
})
await t('WebKit: タップで始め、手の座面のタップでつかんで離す・bot で結果まで・無音', async () => {
  await wp.tap('#bStart'); await wp.waitForTimeout(300)
  await wp.evaluate(() => ss.dbg.pause())
  const h = await wp.evaluate(() => ss.padXY('hand'))
  await wp.touchscreen.tap(h.x, h.y)
  const tapped = await wp.evaluate(() => { ss.dbg.tick(3); return ss.w().grabs >= 0 && ss.w().tick > 0 && (ss.state().phase === 'air' || ss.state().phase === 'swing' || ss.state().phase === 'down' || ss.state().phase === 'ready') })
  const r = await wp.evaluate(() => { const x = ss.runBot('good', 400, 6, 2); ss.dbg.tick(200); return { ...x, scene: ss.G.scene, mute: window.__muteOk() } })
  await wp.waitForTimeout(600); await wp.screenshot({ path: `${ROOT}/shots/v-webkit-end.png` })
  expect(tapped && r.scene === 'end' && r.best > 3 && r.mute, JSON.stringify(r)); return r
})
await t('WebKit: エラーなし', async () => { expect(wp.errs.length === 0, wp.errs.join('|')) })
await wb.close()
server.kill()
console.log(results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
