require('dotenv').config()

const { spawn } = require('child_process')
const speakeasy = require('speakeasy')
const { User } = require('./models')

const server = spawn(process.execPath, ['./server.js'], {
  cwd: __dirname,
  stdio: ['ignore', 'pipe', 'pipe'],
})

server.stderr.on('data', (d) => process.stderr.write(d))
server.stdout.on('data', (d) => process.stdout.write(d))

const BASE = 'http://localhost:5000'

const req = async (method, path, { token, body, twofa } = {}) => {
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
  console.log('=== HEALTH ===')
  console.log(await req('GET', '/api/health'))

  console.log('\n=== REGISTER USER ===')
  const reg = await req('POST', '/api/auth/register', {
    body: { name: 'FlowUser', email: 'flow@minjumart.com', password: 'Pass@123', phone: '01800000000' },
  })
  console.log('status:', reg.status, '| otp returned:', !!reg.data?.otp)
  const otp = reg.data?.otp
  const userToken = reg.data?.token

  console.log('\n=== VERIFY OTP ===')
  const verify = await req('POST', '/api/auth/verify-otp', {
    body: { email: 'flow@minjumart.com', otp },
  })
  console.log('status:', verify.status, '|', verify.data?.message)

  console.log('\n=== CART WITHOUT TOKEN (expect 401) ===')
  const noAuth = await req('GET', '/api/cart')
  console.log('status:', noAuth.status)

  console.log('\n=== ADD TO CART ===')
  const add = await req('POST', '/api/cart', { token: userToken, body: { productId: '1', quantity: 2 } })
  console.log('status:', add.status, '|', add.data?.message)

  console.log('\n=== GET CART WITH PRODUCT ENRICHED ===')
  const cart = await req('GET', '/api/cart', { token: userToken })
  console.log('status:', cart.status, '| product:', cart.data?.cartItems?.[0]?.product?.name)

  console.log('\n=== WISHLIST ===')
  const wish = await req('POST', '/api/wishlist', { token: userToken, body: { productId: '3' } })
  console.log('status:', wish.status, '|', wish.data?.message)

  console.log('\n=== CHECKOUT ===')
  const checkout = await req('POST', '/api/orders/checkout', {
    token: userToken,
    body: { shippingAddress: '456 Flow Street', paymentMethod: 'COD' },
  })
  console.log('status:', checkout.status, '| total:', checkout.data?.order?.totalAmount, '| items:', checkout.data?.order?.items?.length)

  console.log('\n=== ORDERS LIST ===')
  const orders = await req('GET', '/api/orders', { token: userToken })
  console.log('status:', orders.status, '| count:', orders.data?.orders?.length)

  console.log('\n=== ADMIN LOGIN ===')
  const adminLogin = await req('POST', '/api/auth/login', {
    body: { email: 'admin@minjumart.com', password: 'Admin@123' },
  })
  console.log('status:', adminLogin.status, '| role:', adminLogin.data?.user?.role)
  const adminToken = adminLogin.data?.token

  console.log('\n=== ADMIN: ENABLE 2FA ===')
  const enable = await req('POST', '/api/auth/enable-2fa', { token: adminToken })
  console.log('status:', enable.status, '| secret issued:', !!enable.data?.secret)

  const admin = await User.findOne({ where: { email: 'admin@minjumart.com' } })
  const totp = speakeasy.totp({ secret: admin.twoFactorSecret, encoding: 'base32' })

  console.log('\n=== ADMIN: CONFIRM 2FA ===')
  const confirm = await req('POST', '/api/auth/confirm-2fa', { token: adminToken, body: { token: totp } })
  console.log('status:', confirm.status, '|', confirm.data?.message)

  const totp2 = speakeasy.totp({ secret: admin.twoFactorSecret, encoding: 'base32' })

  console.log('\n=== ADMIN STATS WITHOUT 2FA (expect 403) ===')
  const statsNo2fa = await req('GET', '/api/admin/stats', { token: adminToken })
  console.log('status:', statsNo2fa.status, '|', statsNo2fa.data?.message)

  console.log('\n=== ADMIN STATS WITH 2FA ===')
  const stats = await req('GET', '/api/admin/stats', { token: adminToken, twofa: totp2 })
  console.log('status:', stats.status, '| stats:', JSON.stringify(stats.data?.stats))

  console.log('\n=== ADMIN USERS WITH 2FA ===')
  const users = await req('GET', '/api/admin/users', { token: adminToken, twofa: totp2 })
  console.log('status:', users.status, '| users:', users.data?.users?.length)

  console.log('\nDONE')
  server.kill()
  process.exit(0)
}

const wait = async (url, tries = 20) => {
  for (let i = 0; i < tries; i++) {
    try {
      await fetch(url)
      return true
    } catch {
      await sleep(500)
    }
  }
  return false
}

wait(BASE + '/api/health').then((ok) => {
  if (!ok) {
    console.error('Server did not start.')
    server.kill()
    process.exit(1)
  }
  return run()
}).catch((err) => {
  console.error('Test error:', err.message)
  server.kill()
  process.exit(1)
})