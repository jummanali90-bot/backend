const express = require('express')
const Razorpay = require('razorpay')
const crypto = require('crypto')
const { Order } = require('../models')
const { authenticate } = require('../middleware/auth')
const { getOrderSummary } = require('../utils/pricing')

const router = express.Router()

router.use(authenticate)

const getPayable = async (userId, body) => {
  const summary = await getOrderSummary(userId, {
    couponCode: body?.couponCode || null,
    usePoints: !!body?.usePoints,
  })
  return summary
}

// ------------- RAZORPAY (sandbox via test keys)

const razerpayConfig = () => {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET

  if (!keyId || !keySecret) return null

  return new Razorpay({ key_id: keyId, key_secret: keySecret })
}

// POST /api/payments/razorpay/order
router.post('/razorpay/order', async (req, res) => {
  try {
    const summary = await getPayable(req.user.id, req.body)
    if (summary.payable <= 0) return res.status(400).json({ message: 'Cart is empty.' })

    const rzp = razerpayConfig()
    if (!rzp) {
      return res.status(503).json({
        message: 'Razorpay sandbox keys are not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in backend/.env',
      })
    }

    const options = {
      amount: Math.round(summary.payable * 100),
      currency: 'INR',
      receipt: `order_${Date.now()}`,
      notes: { userId: req.user.id },
    }

    const order = await rzp.orders.create(options)
    res.json({ message: 'Razorpay order created.', keyId: process.env.RAZORPAY_KEY_ID, razorpayOrder: order })
  } catch (err) {
    const status = err.statusCode || 500
    res.status(status).json({ message: 'Server error.', error: err.message })
  }
})

// POST /api/payments/razorpay/verify
router.post('/razorpay/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: 'Missing payment details.' })
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET
    const expected = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex')

    if (expected !== razorpay_signature) {
      return res.status(400).json({ message: 'Payment signature verification failed.' })
    }

    res.json({
      message: 'Payment verified.',
      payment: {
        provider: 'razorpay',
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
      },
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// ------------- PAYPAL SANDBOX

const getPayPalToken = async () => {
  const clientId = process.env.PAYPAL_CLIENT_ID
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET

  if (!clientId || !clientSecret) return null

  const base = process.env.PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com'

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${auth}`,
    },
    body: 'grant_type=client_credentials',
  })

  if (!res.ok) throw new Error(`PayPal token error: ${res.status}`)
  const data = await res.json()
  return { base, accessToken: data.access_token }
}

// POST /api/payments/paypal/create-order
router.post('/paypal/create-order', async (req, res) => {
  try {
    const summary = await getPayable(req.user.id, req.body)
    if (summary.payable <= 0) return res.status(400).json({ message: 'Cart is empty.' })

    const paypal = await getPayPalToken()
    if (!paypal) {
      return res.status(503).json({
        message: 'PayPal sandbox credentials are not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in backend/.env',
      })
    }

    const accessToken = await paypal.accessToken
    const currency = process.env.PAYPAL_CURRENCY || 'INR'
    const body = {
      intent: 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: currency, value: summary.payable.toFixed(2) },
      }],
    }

    const resp = await fetch(`${paypal.base}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    })

    const data = await resp.json()
    if (!resp.ok) {
      return res.status(502).json({ message: 'PayPal create failed.', error: data })
    }

    res.json({ message: 'PayPal order created.', clientId: process.env.PAYPAL_CLIENT_ID, currency, paypalOrder: data })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// POST /api/payments/paypal/capture-order
router.post('/paypal/capture-order', async (req, res) => {
  try {
    const { paypalOrderId } = req.body
    if (!paypalOrderId) return res.status(400).json({ message: 'paypalOrderId is required.' })

    const paypal = await getPayPalToken()
    if (!paypal) {
      return res.status(503).json({ message: 'PayPal credentials not configured.' })
    }

    const resp = await fetch(`${paypal.base}/v2/checkout/orders/${paypalOrderId}/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${paypal.accessToken}`,
      },
    })

    const data = await resp.json()
    if (!resp.ok) {
      return res.status(502).json({ message: 'PayPal capture failed.', error: data })
    }

    res.json({
      message: 'PayPal payment captured.',
      paypalCapture: data,
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

module.exports = router