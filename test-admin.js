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
  const login = await req('POST', '/api/auth/login', { body: { email: 'admin@minjumart.com', password: 'Admin@123' } })
  if (login.status !== 200) { console.log('ADMIN LOGIN FAILED', login.status); server.kill(); return }
  const token = login.data.token
  const admin = await User.findOne({ where: { email: 'admin@minjumart.com' } })
  let twofa
  if (!admin.twoFactorEnabled) {
    await req('POST', '/api/auth/enable-2fa', { token })
    const fresh = await User.findOne({ where: { email: 'admin@minjumart.com' } })
    twofa = speakeasy.totp({ secret: fresh.twoFactorSecret, encoding: 'base32' })
    await req('POST', '/api/auth/confirm-2fa', { token, body: { token: twofa } })
  } else {
    twofa = speakeasy.totp({ secret: admin.twoFactorSecret, encoding: 'base32' })
  }

  console.log('Admin login OK, 2FA OK')

  console.log('\n=== ADMIN: CREATE PRODUCT ===')
  const create = await req('POST', '/api/admin/products', {
    token, twofa,
    body: { name: 'Dummy Test Product', description: 'Integration test', price: 499, category: 'Testing', stock: 10 },
  })
  console.log(create.status, create.data?.message)
  const pid = create.data?.product?.id

  console.log('\n=== ADMIN: LIST PRODUCTS ===')
  const list = await req('GET', '/api/admin/products', { token, twofa })
  console.log(list.status, 'count:', list.data?.products?.length)

  console.log('\n=== ADMIN: UPDATE PRODUCT ===')
  const update = await req('PUT', `/api/admin/products/${pid}`, { token, twofa, body: { stock: 42 } })
  console.log(update.status, 'stock now:', update.data?.product?.stock)

  console.log('\n=== ADMIN: ORDER STATUS (create a real order first) ===')
  const reg = await req('POST', '/api/auth/register', { body: { name: 'T', email: 'o@minjumart.com', password: 'X@123456', phone: '01900000000' } })
  await req('POST', '/api/cart', { token: reg.data.token, body: { productId: '1', quantity: 3 } })
  const order = await req('POST', '/api/orders/checkout', { token: reg.data.token, body: { shippingAddress: 'X', paymentMethod: 'COD' } })
  const oid = order.data?.order?.id
  console.log('checkout:', order.status, 'order id set:', !!oid)

  console.log('\n=== ADMIN: GET ORDERS + SET STATUS ===')
  const orders = await req('GET', '/api/admin/orders', { token, twofa })
  console.log('orders:', orders.status, 'count:', orders.data?.orders?.length)
  const status = await req('PATCH', `/api/admin/orders/${oid}/status`, { token, twofa, body: { status: 'shipped' } })
  console.log('status update:', status.status, '->', status.data?.order?.status)

  console.log('\n=== ADMIN: DELETE TEST PRODUCT ===')
  const del = await req('DELETE', `/api/admin/products/${pid}`, { token, twofa })
  console.log(del.status, del.data?.message)

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