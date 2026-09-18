const base = 'http://localhost:5000/api'

const j = async (r) => {
  const t = await r.text()
  try { return { status: r.status, body: JSON.parse(t) } } catch { return { status: r.status, body: t } }
}

const login = async (email, password) => {
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return j(r)
}

;(async () => {
  const demo = await login('customer@test.com', 'Pass@123')
  if (!demo.body.token) { console.log('LOGIN FAIL', JSON.stringify(demo.body)); return }
  const tok = demo.body.token
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }

  // rewards
  const rewards = await j(await fetch(`${base}/rewards`, { headers: H }))
  console.log('rewards:', rewards.body.rewards.tier, 'bal', rewards.body.rewards.balance, 'next', rewards.body.rewards.nextTierThreshold)

  // coupons available
  const coupons = await j(await fetch(`${base}/coupons/available`, { headers: H }))
  console.log('coupons:', coupons.body.coupons.map((c) => `${c.code}(${c.discountType}${c.discountValue})`).join(', '))

  // profile
  const profile = await j(await fetch(`${base}/profile`, { headers: H }))
  console.log('profile tier/cashback:', profile.body.user.membershipTier, profile.body.user.cashbackPercent, 'addresses', profile.body.user.addressCount)

  // addresses + payments
  const adds = await j(await fetch(`${base}/profile/addresses`, { headers: H }))
  console.log('addresses:', adds.body.addresses.length)
  const pm = await j(await fetch(`${base}/profile/payment-methods`, { headers: H }))
  console.log('payment methods:', pm.body.methods.map((m) => `${m.type}:${m.last4 || m.upiId}`).join(', '))

  // wishlist add + list
  const prods = await j(await fetch(`${base}/products`))
  const pid = prods.body.products[0].id
  const wadd = await j(await fetch(`${base}/wishlist`, { method: 'POST', headers: H, body: JSON.stringify({ productId: pid }) }))
  console.log('wishlist add:', wadd.status, wadd.body.message)
  const wl = await j(await fetch(`${base}/wishlist`, { headers: H }))
  console.log('wishlist count:', wl.body.count)

  // recommendations
  const rec = await j(await fetch(`${base}/profile/recommendations`, { headers: H }))
  console.log('recommendations:', rec.body.recommendations.length, rec.body.becauseOf)

  // reviews my
  const myrev = await j(await fetch(`${base}/reviews/my`, { headers: H }))
  console.log('my reviews:', myrev.body.reviews.length)

  // cart + summary + coupon + points
  await j(await fetch(`${base}/cart`, { method: 'POST', headers: H, body: JSON.stringify({ productId: prods.body.products[1].id, quantity: 2 }) }))
  const sum = await j(await fetch(`${base}/orders/summary?couponCode=SAVE10&usePoints=true`, { headers: H }))
  console.log('summary: sub', sum.body.summary.subtotal, 'disc', sum.body.summary.couponDiscount, 'ship', sum.body.summary.shippingAmount,
    'pts', sum.body.summary.pointsRedeemed, 'pay', sum.body.summary.payable, 'earn', sum.body.summary.willEarn)

  // orders list + invoice
  const orders = await j(await fetch(`${base}/orders`, { headers: H }))
  console.log('orders count:', orders.body.orders.length)
  const oid = orders.body.orders[0].id
  const inv = await j(await fetch(`${base}/orders/${oid}/invoice`, { headers: H }))
  console.log('invoice store:', inv.body.invoice.store.name, 'items', inv.body.invoice.items.length, 'payable', inv.body.invoice.totals.payable)

  // returns eligible
  const elig = await j(await fetch(`${base}/returns/eligible/${oid}`, { headers: H }))
  console.log('returns eligible:', elig.body.eligible, elig.body.orderStatus)

  console.log('--- DEMO SMOKE OK ---')
})().catch((e) => { console.log('ERROR', e.message); process.exit(1) })