const { Op } = require('sequelize')
const { Cart, Product, Coupon, User } = require('../models')
const { getSettings, getJSON } = require('./settings')
const { pointsForOrder, tierForPoints } = require('./rewards')

const round2 = (n) => Math.round(Number(n) * 100) / 100

const couponIsValid = (coupon, subtotal) => {
  if (!coupon) return { ok: false, reason: 'Invalid coupon code.' }
  if (!coupon.isActive) return { ok: false, reason: 'This coupon is no longer active.' }
  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
    return { ok: false, reason: 'Coupon usage limit reached.' }
  }
  const now = new Date()
  if (coupon.validFrom && new Date(coupon.validFrom) > now) {
    return { ok: false, reason: 'Coupon is not active yet.' }
  }
  if (coupon.validUntil && new Date(coupon.validUntil) < now) {
    return { ok: false, reason: 'Coupon has expired.' }
  }
  if (Number(coupon.minOrderAmount || 0) > subtotal) {
    return {
      ok: false,
      reason: `Add items worth ${round2(coupon.minOrderAmount)} or more to use this coupon.`,
    }
  }
  return { ok: true }
}

const computeCouponDiscount = (coupon, subtotal) => {
  if (!coupon) return 0
  if (coupon.discountType === 'fixed') return Math.min(Number(coupon.discountValue), subtotal)
  const raw = (subtotal * Number(coupon.discountValue)) / 100
  return coupon.maxDiscount ? Math.min(raw, Number(coupon.maxDiscount)) : raw
}

async function loadCartItems(userId, { checkStock = true } = {}) {
  const cartItems = await Cart.findAll({ where: { userId } })
  if (cartItems.length === 0) return []
  const items = []
  for (const item of cartItems) {
    const product = await Product.findOne({ where: { id: item.productId, isActive: true } })
    if (!product) throw new Error(`Product ${item.productId} not found.`)
    if (checkStock && product.stock < item.quantity) {
      throw new Error(`Only ${product.stock} units of "${product.name}" in stock.`)
    }
    items.push({
      product,
      quantity: item.quantity,
      lineTotal: round2(product.price * item.quantity),
    })
  }
  return items
}

async function getOrderSummary(userId, { couponCode, usePoints = false } = {}) {
  const items = await loadCartItems(userId)
  if (items.length === 0) throw new Error('Cart is empty.')

  const subtotal = round2(items.reduce((s, i) => s + i.lineTotal, 0))

  let coupon = null
  let couponDiscount = 0
  if (couponCode && String(couponCode).trim()) {
    coupon = await Coupon.findOne({ where: { [Op.and]: [{ code: String(couponCode).trim().toUpperCase() }] } })
    const verdict = couponIsValid(coupon, subtotal)
    if (!verdict.ok) {
      const err = new Error(verdict.reason)
      err.statusCode = 400
      throw err
    }
    couponDiscount = round2(computeCouponDiscount(coupon, subtotal))
  }

  const settings = await getSettings()
  const freeShippingAbove = Number(settings.freeShippingAbove || 0)
  const shippingAmount = subtotal >= freeShippingAbove ? 0 : Number(settings.shippingFee || 0)

  const payableBeforePoints = round2(subtotal - couponDiscount)

  const user = await User.findByPk(userId)
  const config = await getJSON('loyaltyConfig', {})
  let redeemValue = 0
  if (usePoints && user.pointsBalance > 0) {
    const maxRedeemPercent = Number(config.maxRedeemPercent || 20)
    const cap = round2((payableBeforePoints * maxRedeemPercent) / 100)
    redeemValue = Math.floor(Math.min(user.pointsBalance, cap))
  }

  const payable = round2(Math.max(0, payableBeforePoints - redeemValue) + shippingAmount)

  const tier = await tierForPoints(user.pointsEarnedCumulative)
  const willEarn = await pointsForOrder(subtotal, tier)

  return {
    items,
    subtotal,
    coupon,
    couponDiscount,
    shippingAmount,
    pointsRedeemed: redeemValue,
    redeemValue,
    payable,
    tier,
    willEarn,
  }
}

module.exports = { getOrderSummary, loadCartItems, couponIsValid, computeCouponDiscount, round2 }