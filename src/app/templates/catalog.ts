export type DesignTemplate = {
  id: string
  name: string
  description: string
  category: string
  layout: 'editorial' | 'dashboard' | 'mobile'
  html: string
}

const sharedStyles = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  button { font: inherit; }
`

export const designTemplates: readonly DesignTemplate[] = [
  {
    id: 'editorial-launch',
    name: 'Editorial product launch',
    description:
      'A responsive launch page with strong type, product proof, and a focused call to action.',
    category: 'Website',
    layout: 'editorial',
    html: `<!doctype html>
<html><head><style>
${sharedStyles}
:root { color: #171714; background: #f3f0e8; }
.page { width: 1440px; min-height: 1024px; padding: 32px 64px 80px; background: #f3f0e8; }
nav { display: flex; align-items: center; justify-content: space-between; min-height: 52px; border-bottom: 1px solid #c9c5b9; }
.brand { font-size: 18px; font-weight: 750; letter-spacing: -0.04em; }
.links { display: flex; gap: 28px; font-size: 14px; }
.hero { display: grid; grid-template-columns: 1.35fr 0.65fr; gap: 72px; align-items: end; padding: 104px 0 80px; }
h1 { margin: 0; max-width: 850px; font-family: Georgia, serif; font-size: 92px; line-height: 0.96; font-weight: 500; letter-spacing: -0.055em; }
.intro { padding-bottom: 10px; }
.intro p { margin: 0 0 28px; max-width: 420px; font-size: 20px; line-height: 1.5; color: #555249; }
.cta { display: inline-flex; min-height: 48px; align-items: center; padding: 0 22px; border: 0; border-radius: 4px; background: #d84b2f; color: white; font-weight: 700; }
.proof { display: grid; grid-template-columns: 1.4fr 0.6fr; gap: 20px; }
.visual { min-height: 400px; padding: 38px; background: #1b2735; color: white; }
.visual h2 { margin: 0; max-width: 520px; font-size: 46px; line-height: 1.05; letter-spacing: -0.04em; }
.visual p { margin-top: 180px; max-width: 460px; color: #cbd7e3; line-height: 1.5; }
.notes { display: flex; flex-direction: column; justify-content: space-between; padding: 30px; border: 1px solid #bcb7aa; }
.notes strong { font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; }
.notes p { font-size: 24px; line-height: 1.25; }
</style></head><body><main class="page">
<nav><span class="brand">Field Notes</span><div class="links"><span>Journal</span><span>Objects</span><span>About</span></div></nav>
<section class="hero"><h1>Make the product clear before making it loud.</h1><div class="intro"><p>A disciplined launch page for teams that want the work to speak before the marketing does.</p><button class="cta">Read the release note</button></div></section>
<section class="proof"><article class="visual"><h2>The interface stays out of the way.</h2><p>Replace this frame with a real product screenshot, annotated flow, or working prototype.</p></article><aside class="notes"><strong>Template note</strong><p>Warm paper, editorial type, and one clear accent keep the hierarchy deliberate.</p></aside></section>
</main></body></html>`
  },
  {
    id: 'operations-dashboard',
    name: 'Operations dashboard',
    description: 'A dense desktop dashboard with a usable tablet state and honest hierarchy.',
    category: 'Web app',
    layout: 'dashboard',
    html: `<!doctype html>
<html><head><style>
${sharedStyles}
:root { color: #e8edf2; background: #101316; }
.shell { display: grid; grid-template-columns: 232px 1fr; width: 1440px; min-height: 960px; background: #101316; }
aside { padding: 24px 18px; border-right: 1px solid #2b3137; background: #15191d; }
.logo { margin: 0 10px 32px; font-size: 17px; font-weight: 760; }
.menu { display: grid; gap: 6px; }
.menu div { min-height: 40px; padding: 10px 12px; border-radius: 6px; color: #9ca8b3; }
.menu .active { background: #28323b; color: white; }
main { padding: 30px 34px 64px; }
header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 34px; }
h1 { margin: 0; font-size: 32px; letter-spacing: -0.035em; }
.status { padding: 8px 12px; border: 1px solid #395b4a; border-radius: 5px; color: #8dd6ac; font-size: 13px; }
.summary { display: grid; grid-template-columns: 1.45fr 1fr 1fr; gap: 14px; margin-bottom: 22px; }
.metric { min-height: 142px; padding: 20px; border: 1px solid #2b3137; border-radius: 8px; background: #171c21; }
.metric.primary { background: #e9c46a; color: #1b1a16; }
.metric span { font-size: 13px; color: #96a1ab; }
.metric.primary span { color: #5a4d28; }
.metric strong { display: block; margin-top: 24px; font-size: 34px; }
.grid { display: grid; grid-template-columns: 1.65fr 1fr; gap: 16px; }
.panel { min-height: 430px; padding: 22px; border: 1px solid #2b3137; border-radius: 8px; background: #171c21; }
.panel h2 { margin: 0 0 24px; font-size: 16px; }
.row { display: grid; grid-template-columns: 1fr 110px 90px; gap: 12px; padding: 16px 0; border-top: 1px solid #2b3137; font-size: 14px; }
.row span { color: #9ca8b3; text-align: end; }
.timeline { display: grid; gap: 18px; }
.event { padding-inline-start: 16px; border-inline-start: 2px solid #e9c46a; }
.event strong { display: block; font-size: 14px; }
.event span { display: block; margin-top: 5px; color: #9ca8b3; font-size: 13px; }
</style></head><body><div class="shell">
<aside><div class="logo">Northstar Ops</div><div class="menu"><div class="active">Overview</div><div>Work queue</div><div>Systems</div><div>Reports</div></div></aside>
<main><header><h1>Today at a glance</h1><div class="status">All systems normal</div></header>
<section class="summary"><article class="metric primary"><span>Work completed</span><strong>42</strong></article><article class="metric"><span>In review</span><strong>8</strong></article><article class="metric"><span>Blocked</span><strong>3</strong></article></section>
<section class="grid"><article class="panel"><h2>Active work</h2><div class="row"><strong>Accessibility review</strong><span>Design</span><span>Today</span></div><div class="row"><strong>Checkout states</strong><span>Product</span><span>Tomorrow</span></div><div class="row"><strong>Release notes</strong><span>Editorial</span><span>Friday</span></div></article><article class="panel"><h2>Recent changes</h2><div class="timeline"><div class="event"><strong>Prototype approved</strong><span>Mobile onboarding, 14 minutes ago</span></div><div class="event"><strong>Review requested</strong><span>Empty states, 1 hour ago</span></div><div class="event"><strong>Tokens updated</strong><span>Spacing scale, yesterday</span></div></div></article></section>
</main></div></body></html>`
  },
  {
    id: 'mobile-commerce',
    name: 'Mobile product flow',
    description: 'Three mobile screens covering discovery, product detail, and cart states.',
    category: 'Mobile app',
    layout: 'mobile',
    html: `<!doctype html>
<html><head><style>
${sharedStyles}
:root { color: #28251f; background: #e9e5dc; }
.board { display: flex; gap: 56px; width: 1320px; min-height: 900px; padding: 72px; background: #e9e5dc; }
.phone { width: 360px; min-height: 760px; overflow: hidden; border: 1px solid #bbb4a6; border-radius: 28px; background: #fbfaf6; }
.top { display: flex; align-items: center; justify-content: space-between; padding: 22px 20px 16px; }
.top strong { font-size: 16px; }
.icon { display: grid; place-items: center; width: 40px; height: 40px; border: 1px solid #d7d2c7; border-radius: 50%; }
.hero { margin: 0 16px; min-height: 300px; padding: 28px; border-radius: 18px; background: #b9cfbf; }
.hero small { text-transform: uppercase; letter-spacing: 0.09em; }
.hero h1 { margin: 116px 0 0; max-width: 240px; font-family: Georgia, serif; font-size: 38px; line-height: 1; font-weight: 500; }
.content { padding: 22px 20px 28px; }
.content h2 { margin: 0 0 16px; font-size: 20px; }
.cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.card { min-height: 150px; padding: 14px; border-radius: 14px; background: #ede9df; }
.card:nth-child(2) { background: #ddc3b5; }
.card strong { display: block; margin-top: 82px; font-size: 14px; }
.product-art { min-height: 350px; margin: 0 16px; border-radius: 18px; background: #ddc3b5; }
.price { display: flex; align-items: baseline; justify-content: space-between; margin: 18px 0; }
.price strong { font-size: 24px; }
.action { width: 100%; min-height: 52px; border: 0; border-radius: 10px; background: #2c4938; color: white; font-weight: 700; }
.cart-row { display: grid; grid-template-columns: 72px 1fr auto; gap: 14px; align-items: center; padding: 18px 0; border-bottom: 1px solid #ddd7ca; }
.thumb { width: 72px; height: 84px; border-radius: 10px; background: #b9cfbf; }
.total { display: flex; justify-content: space-between; margin: 180px 0 20px; font-size: 18px; }
</style></head><body><main class="board">
<section class="phone"><header class="top"><strong>Quiet Goods</strong><span class="icon">2</span></header><div class="hero"><small>New collection</small><h1>Objects for slower mornings.</h1></div><div class="content"><h2>Made to be used</h2><div class="cards"><article class="card"><strong>Stone cup</strong></article><article class="card"><strong>Linen tray</strong></article></div></div></section>
<section class="phone"><header class="top"><span class="icon">Back</span><strong>Stone cup</strong><span class="icon">Save</span></header><div class="product-art"></div><div class="content"><h2>Hand-thrown stoneware</h2><p>Balanced weight, matte glaze, and a lip shaped for everyday use.</p><div class="price"><strong>₹1,200</strong><span>In stock</span></div><button class="action">Add to cart</button></div></section>
<section class="phone"><header class="top"><span class="icon">Back</span><strong>Your cart</strong><span></span></header><div class="content"><div class="cart-row"><span class="thumb"></span><div><strong>Stone cup</strong><p>Sand, quantity 1</p></div><strong>₹1,200</strong></div><div class="total"><span>Total</span><strong>₹1,200</strong></div><button class="action">Continue to delivery</button></div></section>
</main></body></html>`
  }
]
