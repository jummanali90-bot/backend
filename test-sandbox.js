require('dotenv').config()
const { spawn } = require('child_process')

const server = spawn(process.execPath, ['./server.js'], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] })
server.stderr.on('data', () => {})

const BASE = 'http://localhost:5000'
const req = async (method, path, { token, body } = {}) => {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  let data = null
  try { data = await res.json() } catch {}
  return { status: res.status, data }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const wait = async (tries = 20) => {
  for (let i = 0; i < tries; i++) {
    try { await fetch(BASE + '/api/health'); return true } catch { await sleep(500) }
  }
  return false
}

wait().then(async () => {
  const email = `sandbox${Date.now()}@t.com`
  const reg = await req('POST', '/api/auth/register', { body: { name: 'S', email, password: 'X@123456', phone: `0192${Date.now()}` } })
  const token = reg.data?.token
  await req('POST', '/api/cart', { token, body: { productId: '2', quantity: 1 } })

  console.log('\n=== RAZORPAY CREATE ORDER (real key) ===')
  const rzp = await req('POST', '/api/payments/razorpay/order', { token })
  console.log('status:', rzp.status)
  console.log('keyId:', rzp.data?.keyId?.slice(0, 12) + '...')
  console.log('razorpay order id:', rzp.data?.razorpayOrder?.id, '| amount:', rzp.data?.razorpayOrder?.amount)

  console.log('\n=== RAZORPAY VERIFY (fake signature, expect 400) ===')
  const verify = await req('POST', '/api/payments/razorpay/verify', {
    token,
    body: { razorpay_order_id: 'order_FAKE', razorpay_payment_id: 'pay_FAKE', razorpay_signature: 'deadbeef' },
  })
  console.log('status:', verify.status, '|', verify.data?.message)

  console.log('\n=== PAYPAL CREATE ORDER (real client id) ===')
  const pp = await req('POST', '/api/payments/paypal/create-order', { token })
  console.log('status:', pp.status)
  if (pp.status === 502) console.log('paypal error:', JSON.stringify(pp.data?.error, null, 2))
  console.log('clientId:', pp.data?.clientId?.slice(0, 12) + '...')
  console.log('paypal order id:', pp.data?.paypalOrder?.id, '| status:', pp.data?.paypalOrder?.status, '| amount:', pp.data?.paypalOrder?.purchase_units?.[0]?.amount?.value)

  console.log('\nDONE')
  server.kill()
  process.exit(0)
}).catch((e) => { console.error('Test error:', e.message); server.kill(); process.exit(1) })