const base = 'http://localhost:5000/api'
const j = async (r) => {
  const t = await r.text()
  try { return { status: r.status, body: JSON.parse(t) } } catch { return { status: r.status, body: t } }
}
const H = (tok) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` })

;(async () => {
  // admin login
  const alogin = await j(await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@minjumart.com', password: 'Admin@123' }) }))
  const A = H(alogin.body.token)

  const ual = await j(await fetch(`${base}/admin/users`, { headers: A }))
  const me = ual.body.users.find((u) => u.email === 'customer@test.com')
  console.log('admin users tier field:', me.membershipTier, 'cashback:', me.cashbackPercent, 'points:', me.pointsBalance)

  // points must be non-zero integer
  const badz = await j(await fetch(`${base}/admin/users/${me.id}/points`, { method: 'PATCH', headers: A, body: JSON.stringify({ points: 0 }) }))
  console.log('points=0 ->', badz.status, badz.body.message)

  // user review with image on a product they purchased but not reviewed yet (watch)
  const ulogin = await j(await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'customer@test.com', password: 'Pass@123' }) }))
  const U = H(ulogin.body.token)
  const imgData = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  const watchId = 'db1d5bbe-cf3d-42e4-83a6-24d144c30ba0'
  const rv = await j(await fetch(`${base}/reviews`, { method: 'POST', headers: U, body: JSON.stringify({ productId: watchId, rating: 4, title: 'With photo upload', comment: 'Nice tracker', images: [imgData] }) }))
  console.log('review w/ image:', rv.status, rv.body.message)

  // product detail includes images
  const pd = await j(await fetch(`${base}/products/${watchId}`))
  const withImg = pd.body.reviews.filter((r) => (r.images || []).length)
  console.log('product detail reviews with images:', withImg.length, 'rating avg:', pd.body.rating.average)

  // profile email/refresh reflects tier after +500 (silver now)
  const mep = await j(await fetch(`${base}/auth/me`, { headers: U }))
  console.log('/auth/me tier:', mep.body.user.membershipTier, 'points:', mep.body.user.pointsBalance)

  console.log('--- PHASE 3 OK ---')
})().catch((e) => { console.log('ERROR', e.message); process.exit(1) })