const express = require('express')
const { Op } = require('sequelize')
const { LoyaltyTransaction, Order, Coupon, User } = require('../models')
const { authenticate } = require('../middleware/auth')
const { getLoyaltyConfig } = require('../utils/settings')
const { tierForPoints, cashbackPercentFor } = require('../utils/rewards')

const router = express.Router()

router.use(authenticate)

// GET /api/rewards
router.get('/', async (req, res) => {
  try {
    const config = await getLoyaltyConfig()
    const transactions = await LoyaltyTransaction.findAll({
      where: { userId: req.user.id },
      include: [{ model: Order, as: 'order', attributes: ['id', 'totalAmount', 'status', 'createdAt'] }],
      order: [['createdAt', 'DESC']],
      limit: 50,
    })

    const user = await User.findByPk(req.user.id)
    const tier = await tierForPoints(user.pointsEarnedCumulative)
    const cashbackPercent = await cashbackPercentFor(tier)

    const orders = await Order.findAll({
      where: { userId: req.user.id, status: { [Op.ne]: 'cancelled' } },
      attributes: ['totalAmount'],
    })
    const totalSpent = orders.reduce((s, o) => s + Number(o.totalAmount || 0), 0)
    const nextThreshold = tierThresholdAfter(config.tiers, tier)
    const prevThreshold = Number(config.tiers[tier] || 0)

    res.json({
      rewards: {
        pointsBalance: user.pointsBalance,
        balance: user.pointsBalance,
        pointsEarnedCumulative: user.pointsEarnedCumulative,
        tier,
        cashbackPercent,
        redeemRate: config.redeemRate,
        maxRedeemPercent: config.maxRedeemPercent,
        pointsPer100: Number(config.pointsPer100 || 1),
        tiers: config.tiers,
        orderCount: orders.length,
        totalSpent,
        nextTierThreshold: nextThreshold,
        nextTier: nextThreshold
          ? {
              tier: tierThresholdTier(config.tiers, tier),
              threshold: nextThreshold,
              pointsToNext: Math.max(0, nextThreshold - Number(user.pointsEarnedCumulative || 0)),
              progress: Number(user.pointsEarnedCumulative || 0) >= prevThreshold
                ? Math.min(100, Math.round(((Number(user.pointsEarnedCumulative || 0) - prevThreshold) / Math.max(1, nextThreshold - prevThreshold)) * 100))
                : 0,
            }
          : null,
        transactions,
      },
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

const tierThresholdAfter = (tiers, currentTier) => {
  const list = [['bronze', tiers.bronze], ['silver', tiers.silver], ['gold', tiers.gold], ['platinum', tiers.platinum]]
  const idx = list.findIndex(([t]) => t === currentTier)
  return idx >= 0 && idx < list.length - 1 ? Number(list[idx + 1][1]) : null
}

const tierThresholdTier = (tiers, currentTier) => {
  const list = ['bronze', 'silver', 'gold', 'platinum']
  const idx = list.indexOf(currentTier)
  return idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null
}

// GET /api/coupons/available
router.get('/available', async (req, res) => {
  try {
    const now = new Date()
    const coupons = await Coupon.findAll({
      where: {
        isActive: true,
        [Op.or]: [{ validFrom: null }, { validFrom: { [Op.lte]: now } }],
        [Op.and]: [{ [Op.or]: [{ validUntil: null }, { validUntil: { [Op.gte]: now } }] }],
      },
    })
    const available = coupons
      .filter((c) => !c.usageLimit || c.usedCount < c.usageLimit)
      .map((c) => ({
        id: c.id,
        code: c.code,
        title: c.title,
        description: c.description,
        discountType: c.discountType,
        discountValue: Number(c.discountValue),
        minOrderAmount: Number(c.minOrderAmount || 0),
        maxDiscount: c.maxDiscount ? Number(c.maxDiscount) : null,
        isFeatured: c.isFeatured,
        validUntil: c.validUntil,
      }))
    res.json({ coupons: available })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// POST /api/coupons/validate
router.post('/validate', async (req, res) => {
  try {
    const { code } = req.body
    if (!code) return res.status(400).json({ message: 'Coupon code is required.' })

    const { Cart, Product } = require('../models')
    const rows = await Cart.findAll({ where: { userId: req.user.id } })
    let subtotal = 0
    for (const c of rows) {
      const p = await Product.findByPk(c.productId)
      if (p) subtotal += Number(p.price) * c.quantity
    }

    const { couponIsValid, computeCouponDiscount } = require('../utils/pricing')
    const coupon = await Coupon.findOne({ where: { code: String(code).trim().toUpperCase() } })
    const verdict = couponIsValid(coupon, subtotal)

    if (!verdict.ok) return res.json({ ok: false, reason: verdict.reason })

    const discount = computeCouponDiscount(coupon, subtotal)
    res.json({
      ok: true,
      discount,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        title: coupon.title,
        discountType: coupon.discountType,
        discountValue: Number(coupon.discountValue),
        maxDiscount: coupon.maxDiscount ? Number(coupon.maxDiscount) : null,
      },
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

module.exports = router