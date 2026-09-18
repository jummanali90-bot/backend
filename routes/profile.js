const express = require('express')
const bcrypt = require('bcryptjs')
const { Op } = require('sequelize')
const { User, UserAddress, PaymentMethod, Order, OrderItem, Product, Review } = require('../models')
const { authenticate } = require('../middleware/auth')
const { normalizeProduct } = require('../utils/helpers')
const { sanitizeUser } = require('./auth')
const { tierForPoints, cashbackPercentFor } = require('../utils/rewards')
const sequelize = require('../config/database')

const router = express.Router()

router.use(authenticate)

// ------------------------- PROFILE -------------------------

// GET /api/profile
router.get('/', async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id)
    if (!user) return res.status(404).json({ message: 'User not found.' })
    const addressCount = await UserAddress.count({ where: { userId: user.id } })
    const paymentCount = await PaymentMethod.count({ where: { userId: user.id } })
    const orderCount = await Order.count({ where: { userId: user.id } })
    const tier = await tierForPoints(user.pointsEarnedCumulative)
    const cashbackPercent = await cashbackPercentFor(tier)
    res.json({
      user: {
        ...sanitizeUser(user),
        membershipTier: tier,
        cashbackPercent,
        addressCount,
        paymentCount,
        orderCount,
      },
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// PUT /api/profile
router.put('/', async (req, res) => {
  try {
    const { name, phone } = req.body
    const user = await User.findByPk(req.user.id)
    if (!user) return res.status(404).json({ message: 'User not found.' })
    if (name != null && String(name).trim()) user.name = String(name).trim()
    if (phone != null) user.phone = String(phone).trim()
    await user.save()
    res.json({ message: 'Profile updated.', user: sanitizeUser(user) })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// PUT /api/profile/password
router.put('/password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body
    const user = await User.findByPk(req.user.id)
    if (!user) return res.status(404).json({ message: 'User not found.' })
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password are required.' })
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters.' })
    }
    const valid = await bcrypt.compare(currentPassword, user.password)
    if (!valid) return res.status(400).json({ message: 'Current password is incorrect.' })
    user.password = await bcrypt.hash(String(newPassword), 10)
    await user.save()
    res.json({ message: 'Password changed.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// ------------------------- ADDRESSES -------------------------

// GET /api/profile/addresses
router.get('/addresses', async (req, res) => {
  try {
    const addresses = await UserAddress.findAll({
      where: { userId: req.user.id },
      order: [['isDefault', 'DESC'], ['createdAt', 'DESC']],
    })
    res.json({ addresses })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// POST /api/profile/addresses
router.post('/addresses', async (req, res) => {
  try {
    const { type, name, phone, line1, line2, city, state, pincode, landmark, isDefault } = req.body
    if (!name || !phone || !line1 || !city || !state || !pincode) {
      return res.status(400).json({ message: 'Name, phone, address, city, state and pincode are required.' })
    }
    if (req.body.isDefault !== false) {
      await UserAddress.update({ isDefault: false }, { where: { userId: req.user.id } })
    }
    const address = await UserAddress.create({
      userId: req.user.id,
      type: type || 'home',
      name,
      phone,
      line1,
      line2: line2 || null,
      city,
      state,
      pincode,
      landmark: landmark || null,
      isDefault: true,
    })
    res.status(201).json({ message: 'Address added.', address })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// PUT /api/profile/addresses/:id
router.put('/addresses/:id', async (req, res) => {
  try {
    const address = await UserAddress.findOne({ where: { id: req.params.id, userId: req.user.id } })
    if (!address) return res.status(404).json({ message: 'Address not found.' })
    const { type, name, phone, line1, line2, city, state, pincode, landmark } = req.body
    await address.update({
      type: type || address.type,
      name: name != null ? name : address.name,
      phone: phone != null ? phone : address.phone,
      line1: line1 != null ? line1 : address.line1,
      line2: line2 !== undefined ? line2 : address.line2,
      city: city != null ? city : address.city,
      state: state != null ? state : address.state,
      pincode: pincode != null ? pincode : address.pincode,
      landmark: landmark !== undefined ? landmark : address.landmark,
    })
    res.json({ message: 'Address updated.', address })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// PATCH /api/profile/addresses/:id/default
router.patch('/addresses/:id/default', async (req, res) => {
  try {
    const address = await UserAddress.findOne({ where: { id: req.params.id, userId: req.user.id } })
    if (!address) return res.status(404).json({ message: 'Address not found.' })
    await UserAddress.update({ isDefault: false }, { where: { userId: req.user.id } })
    await address.update({ isDefault: true })
    res.json({ message: 'Default address set.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// DELETE /api/profile/addresses/:id
router.delete('/addresses/:id', async (req, res) => {
  try {
    const deleted = await UserAddress.destroy({ where: { id: req.params.id, userId: req.user.id } })
    if (!deleted) return res.status(404).json({ message: 'Address not found.' })
    res.json({ message: 'Address removed.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// ------------------------- PAYMENT METHODS -------------------------

const normalizePayment = (p) => {
  const json = p.toJSON()
  delete json.user
  return json
}

// GET /api/profile/payment-methods
router.get('/payment-methods', async (req, res) => {
  try {
    const methods = await PaymentMethod.findAll({
      where: { userId: req.user.id },
      order: [['isDefault', 'DESC'], ['createdAt', 'DESC']],
    })
    res.json({ methods: methods.map(normalizePayment) })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// POST /api/profile/payment-methods
router.post('/payment-methods', async (req, res) => {
  try {
    const { type, nickname, cardNumber, cardBrand, expMonth, expYear, upiId, bankName, isDefault } = req.body
    if (!type) return res.status(400).json({ message: 'Payment type is required.' })

    if (type === 'card') {
      if (!cardNumber) return res.status(400).json({ message: 'Card number is required.' })
      if (!/^\d{12,19}$/.test(String(cardNumber))) {
        return res.status(400).json({ message: 'Invalid card number.' })
      }
    }
    if (type === 'upi' && !upiId) {
      return res.status(400).json({ message: 'UPI ID is required.' })
    }
    if (type === 'netbanking' && !bankName) {
      return res.status(400).json({ message: 'Bank name is required.' })
    }

    await sequelize.transaction(async (t) => {
      const existingCount = await PaymentMethod.count({ where: { userId: req.user.id }, transaction: t })
      if (isDefault !== false || existingCount === 0) {
        await PaymentMethod.update({ isDefault: false }, { where: { userId: req.user.id }, transaction: t })
      }
      return PaymentMethod.create({
        userId: req.user.id,
        type,
        nickname: nickname || null,
        cardBrand: type === 'card' ? cardBrand || inferBrand(String(cardNumber)) : null,
        last4: type === 'card' ? String(cardNumber).slice(-4) : null,
        expMonth: type === 'card' ? expMonth || null : null,
        expYear: type === 'card' ? expYear || null : null,
        upiId: type === 'upi' ? upiId : null,
        bankName: type === 'netbanking' ? bankName : null,
        isDefault: existingCount === 0,
      }, { transaction: t })
    }).then((method) => res.status(201).json({ message: 'Payment method added.', method: normalizePayment(method) }))
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

const inferBrand = (num) => {
  const n = String(num)
  if (n.startsWith('4')) return 'Visa'
  if (/^5[1-5]/.test(n)) return 'Mastercard'
  if (/^(34|37)/.test(n)) return 'Amex'
  if (/^6/.test(n)) return 'RuPay'
  return 'Card'
}

// PATCH /api/profile/payment-methods/:id/default
router.patch('/payment-methods/:id/default', async (req, res) => {
  try {
    const method = await PaymentMethod.findOne({ where: { id: req.params.id, userId: req.user.id } })
    if (!method) return res.status(404).json({ message: 'Payment method not found.' })
    await PaymentMethod.update({ isDefault: false }, { where: { userId: req.user.id } })
    await method.update({ isDefault: true })
    res.json({ message: 'Default payment method set.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// DELETE /api/profile/payment-methods/:id
router.delete('/payment-methods/:id', async (req, res) => {
  try {
    const deleted = await PaymentMethod.destroy({ where: { id: req.params.id, userId: req.user.id } })
    if (!deleted) return res.status(404).json({ message: 'Payment method not found.' })
    res.json({ message: 'Payment method removed.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// ------------------------- RECOMMENDATIONS -------------------------

// GET /api/profile/recommendations
router.get('/recommendations', async (req, res) => {
  try {
    const orders = await Order.findAll({
      where: { userId: req.user.id, status: { [Op.ne]: 'cancelled' } },
      include: [{ model: OrderItem, as: 'items', include: [{ model: Product, as: 'product' }] }],
      order: [['createdAt', 'DESC']],
    })

    const categoryCounts = {}
    const purchasedProductIds = new Set()
    for (const order of orders) {
      for (const item of order.items || []) {
        purchasedProductIds.add(String(item.productId))
        const product = item.product
        if (product && product.category) {
          categoryCounts[product.category] = (categoryCounts[product.category] || 0) + item.quantity
        }
      }
    }

    const topCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0]

    let picks = []
    if (topCategory) {
      picks = await Product.findAll({
        where: {
          isActive: true,
          category: topCategory,
          id: { [Op.notIn]: [...purchasedProductIds] },
        },
        order: [['stock', 'DESC']],
        limit: 6,
      })
    }

    if (picks.length < 6) {
      const pickedIds = picks.map((p) => p.id)
      const fillers = await Product.findAll({
        where: {
          isActive: true,
          id: { [Op.notIn]: [...purchasedProductIds, ...pickedIds] },
        },
        order: [['featured', 'DESC'], ['stock', 'DESC']],
        limit: 6 - picks.length,
      })
      picks = [...picks, ...fillers]
    }

    if (picks.length === 0) {
      picks = await Product.findAll({
        where: { isActive: true },
        order: [['featured', 'DESC'], ['stock', 'DESC']],
        limit: 6,
      })
    }

    res.json({
      recommendations: picks.map(normalizeProduct),
      becauseOf: topCategory ? `Because you shopped in ${topCategory}` : null,
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// ------------------------- MY REVIEWS -------------------------

// GET /api/profile/reviews
router.get('/reviews', async (req, res) => {
  try {
    const reviews = await Review.findAll({
      where: { userId: req.user.id },
      include: [{ model: Product, as: 'product', attributes: ['id', 'name', 'image', 'images'] }],
      order: [['createdAt', 'DESC']],
    })
    const mapped = reviews.map((r) => {
      const json = r.toJSON()
      if (json.product) json.product = normalizeProduct(json.product)
      return json
    })
    res.json({ reviews: mapped })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

module.exports = router