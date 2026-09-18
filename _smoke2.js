const base = 'http://localhost:5000/api'
const j = async (r) => {
  const t = await r.text()
  try { return { status: r.status, body: JSON.parse(t) } } catch { return { status: r.status, body: t } }
}
const authHeaders = (tok) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` })

;(async () => {
  // USER: customer
  const login = await j(await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'customer@test.com', password: 'Pass@123' }) }))
  const tok = login.body.token
  const U = authHeaders(tok)
  const pid = '812a94a7-ab4c-4df3-9911-525075de691a'

  // needs wallet product in cart (id 1835...) — add a product to cart
  const add = await j(await fetch(`${base}/cart`, { method: 'POST', headers: U, body: JSON.stringify({ productId: '1835ec90-8ee2-46fe-bcd8-e2011ce6c8fb', quantity: 2 }) }))
  console.log('cart add wallet qty2:', add.status)

  // invalid coupon summary
  const bad = await j(await fetch(`${base}/orders/summary?couponCode=NOPE`, { headers: U }))
  console.log('invalid coupon:', bad.status, bad.body.message)

  // checkout with SAVE10 + points
  const co = await j(await fetch(`${base}/orders/checkout`, { method: 'POST', headers: U, body: JSON.stringify({
    shippingAddress: 'Test Customer, A-404 Silver Oak, New Delhi - 110078',
    paymentMethod: 'COD', couponCode: 'SAVE10', usePoints: true,
  }) }))
  console.log('checkout:', co.status, co.body.message)
  if (co.body.order) {
    console.log('  order: sub', co.body.order.subtotal, 'disc', co.body.order.couponDiscount, 'ptsR', co.body.order.pointsRedeemed, 'shipping', co.body.order.shippingAmount, 'total', co.body.order.totalAmount, 'earned', co.body.order.pointsEarned)
  }

  const rewards = await j(await fetch(`${base}/rewards`, { headers: U }))
  console.log('points after checkout:', rewards.body.rewards.balance, 'transactions:', rewards.body.rewards.transactions.slice(0, 3).map((t) => `${t.reason}:${t.points}`).join(','))

  // create return on oldest delivered order
  const orders = await j(await fetch(`${base}/orders`, { headers: U }))
  const delivered = orders.body.orders.find((o) => o.status === 'delivered' && o.items.length)
  const firstItem = delivered.items[0]
  const ret = await j(await fetch(`${base}/returns`, { method: 'POST', headers: U, body: JSON.stringify({
    orderId: delivered.id, itemIds: [firstItem.id], action: 'return', reason: 'not_as_described', comment: 'Quality not as expected.', photos: [],
  }) }))
  console.log('create return:', ret.status, ret.body.message)
  const rets = await j(await fetch(`${base}/returns`, { headers: U }))
  console.log('my returns:', rets.body.returns.length, 'status', rets.body.returns[0].status)

  // review with an image (tiny gif data url)
  const imgData = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  const rv = await j(await fetch(`${base}/reviews`, { method: 'POST', headers: U, body: JSON.stringify({ productId: pid, rating: 4, title: 'With photo', comment: 'Nice', images: [imgData] }) }))
  console.log('review w/ image:', rv.status, rv.body.message)

  // ADMIN: login + verify 2FA not enabled, then endpoints
  const alogin = await j(await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@minjumart.com', password: 'Admin@123' }) }))
  console.log('admin login:', alogin.status, '2fa?', alogin.body.user.twoFactorEnabled)
  const A = authHeaders(alogin.body.token)

  const cpl = await j(await fetch(`${base}/admin/coupons`, { headers: A }))
  console.log('admin coupons:', cpl.body.coupons.map((c) => `${c.code}:${c.usedCount}used`).join(','))
  const rl = await j(await fetch(`${base}/admin/returns`, { headers: A }))
  console.log('admin returns list:', rl.body.returns.length, 'first status:', rl.body.returns[0].status)
  const rid = rl.body.returns[0].id
  const rap = await j(await fetch(`${base}/admin/returns/${rid}`, { method: 'PATCH', headers: A, body: JSON.stringify({ status: 'approved', adminNote: 'Approved for pickup.', refundAmount: 899 }) }))
  console.log('approve return:', rap.status, rap.body.request.status)
  const ual = await j(await fetch(`${base}/admin/users`, { headers: A }))
  const me = ual.body.users.find((u) => u.email === 'customer@test.com')
  console.log('admin users: customer points=', me.pointsBalance, 'tier field present:', me.membershipTier === undefined ? 'NO' : 'yes')
  const padj = await j(await fetch(`${base}/admin/users/${me.id}/points`, { method: 'PATCH', headers: A, body: JSON.stringify({ points: 500, reason: 'BONUS', description: 'Customer goodwill bonus' }) }))
  console.log('points adjust:', padj.status, padj.body.user.pointsBalance, padj.body.user.membershipTier)
  const plog = await j(await fetch(`${base}/admin/users/${me.id}/points-log`, { headers: A }))
  console.log('points log len:', plog.body.log.length)
  const loy = await j(await fetch(`${base}/admin/settings/loyalty`, { headers: A }))
  console.log('loyalty config gold tier:', loy.body.loyalty.tiers.gold)
  const usr = await j(await fetch(`${base}/admin/users/points`, { method: 'PATCH', headers: A, body: { points: 0 } }))
  console.log('bad adjust (points 0):', usr.status)

  console.log('--- PHASE 2 SMOKE OK ---')
})().catch((e) => { console.log('ERROR', e.message); process.exit(1) })