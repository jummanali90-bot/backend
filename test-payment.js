require('dotenv').config()
const { spawn } = require('child_process')
const speakeasy = require('speakeasy')
const { User } = require('./models')

const server = spawn(process.execPath, ['./server.js'], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] })
server.stderr.on('data', (d) => process.stderr.write(d))

const BASE = 'http://localhost:5000'
const req = async (method, path, { token, twofa, body } = {}) => {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (twofa) headers['x-2fa-token'] = twofa
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch {}
  return { status: res.status, data }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const run = async () => {
  console.log('\n=== REGISTER + CHECKOUT (tracking) ===')
  const email = `pay${Date.now()}@t.com`
  const reg = await req('POST', '/api/auth/register', { body: { name: 'T', email, password: 'X@123456', phone: '01900000000' } })
  const token = reg.data?.token
  await req('POST', '/api/cart', { token, body: { productId: '1', quantity: 2 } })
  const checkout = await req('POST', '/api/orders/checkout', { token, body: { shippingAddress: 'X', paymentMethod: 'COD' } })
  const order = checkout.data?.order
  console.log('checkout:', checkout.status, '| total:', order?.totalAmount)
  console.log('tracking entries:', order?.tracking?.map((t) => `${t.status}@${t.createdAt.slice(0, 19)}`) || 'MISSING')

  console.log('\n=== GET ORDER (tracking included) ===')
  const got = await req('GET', `/api/orders/${order.id}`, { token })
  console.log('status:', got.status, '| tracking:', got.data?.order?.tracking?.length)

  console.log('\n=== TRAILING SLASH /api/orders/ (list) ===')
  const list = await req('GET', '/api/orders/', { token })
  console.log('status:', list.status, '| count:', list.data?.orders?.length)

  console.log('\n=== PAYMENT PLACEHOLDERS (expect 503, no keys) ===')
  const rzp = await req('POST', '/api/payments/razorpay/order', { token })
  console.log('razorpay order:', rzp.status, '|', rzp.data?.message)
  const pp = await req('POST', '/api/payments/paypal/create-order', { token })
  console.log('paypal create:', pp.status, '|', pp.data?.message)
  const rzpNoKeys = await req('POST', '/api/payments/razorpay/verify', { token, body: { razorpay_order_id: 'a', razorpay_payment_id: 'b', razorpay_signature: 'c' } })
  console.log('razorpay verify (no secret):', rzpNoKeys.status, '|', rzpNoKeys.data?.message)

  console.log('\n=== ADMIN: STATUS UPDATE LOGS TRACKING ===')
  const adminLogin = await req('POST', '/api/auth/login', { body: { email: 'admin@minjumart.com', password: 'Admin@123' } })
  const adminToken = adminLogin.data?.token
  const admin = await User.findOne({ where: { email: 'admin@minjumart.com' } })
  let admin2fa = admin
  if (!admin.twoFactorEnabled) {
    await req('POST', '/api/auth/enable-2fa', { token: adminToken })
    admin2fa = await User.findOne({ where: { email: 'admin@minjumart.com' } })
    const totp = speakeasy.totp({ secret: admin2fa.twoFactorSecret, encoding: 'base32' })
    await req('POST', '/api/auth/confirm-2fa', { token: adminToken, body: { token: totp } })
  }
  const twofa = speakeasy.totp({ secret: admin2fa.twoFactorSecret, encoding: 'base32' })
  const update = await req('PATCH', `/api/admin/orders/${order.id}/status`, { token: adminToken, twofa, body: { status: 'processing', note: 'Packed and ready.' } })
  console.log('update:', update.status, '->', update.data?.order?.status)
  console.log('tracking now:', update.data?.order?.tracking?.map((t) => t.status) || 'MISSING')

  console.log('\n=== PAYMENTS WITHOUT AUTH (expect 401) ===')
  const noAuth = await req('POST', '/api/payments/razorpay/order')
  console.log('status:', noAuth.status)

  console.log('\nDONE')
  server.kill()
  process.exit(0)
}

const wait = async (tries = 20) => {
  for (let i = 0; i < tries; i++) {
    try { await fetch(BASE + '/api/health'); return true } catch { await sleep(500) }
  }
  return false
}

wait().then((ok) => {
  if (!ok) { console.error('Server did not start'); server.kill(); process.exit(1) }
  return run()
}).catch((e) => { console.error('Error:', e.message); server.kill(); process.exit(1) })