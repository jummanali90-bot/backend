const express = require('express')
const { Order, OrderItem, OrderTracking, Cart, Product, User, Coupon, CouponUsage } = require('../models')
const { authenticate } = require('../middleware/auth')
const { normalizeProduct } = require('../utils/helpers')
const { getOrderSummary } = require('../utils/pricing')
const { pointsForOrder, tierForPoints, creditPoints, debitPoints } = require('../utils/rewards')
const { getSettings } = require('../utils/settings')

const router = express.Router()

router.use(authenticate)

const recordTracking = async (orderId, status, note) => {
  await OrderTracking.create({ orderId, status, note: note || null })
}

// GET /api/orders/summary?couponCode=&usePoints=
router.get('/summary', async (req, res) => {
  try {
    const summary = await getOrderSummary(req.user.id, {
      couponCode: req.query.couponCode,
      usePoints: req.query.usePoints === 'true',
    })
    res.json({ summary })
  } catch (err) {
    const status = err.statusCode || 500
    res.status(status).json({ message: err.message, error: err.message })
  }
})

// POST /api/orders/checkout
router.post('/checkout', async (req, res) => {
  try {
    const cartItems = await Cart.findAll({ where: { userId: req.user.id } })
    if (cartItems.length === 0) {
      return res.status(400).json({ message: 'Cart is empty.' })
    }

    const { shippingAddress, paymentMethod, paymentId, couponCode, usePoints } = req.body

    if (!shippingAddress || !paymentMethod) {
      return res.status(400).json({ message: 'Shipping address and payment method are required.' })
    }

    const summary = await getOrderSummary(req.user.id, {
      couponCode: couponCode || null,
      usePoints: !!usePoints,
    })

    const user = await User.findByPk(req.user.id)
    const tier = await tierForPoints(user.pointsEarnedCumulative)
    const pointsEarned = await pointsForOrder(summary.subtotal, tier)

    const order = await Order.create({
      userId: req.user.id,
      subtotal: summary.subtotal,
      shippingAmount: summary.shippingAmount,
      couponCode: summary.coupon ? summary.coupon.code : null,
      couponDiscount: summary.couponDiscount,
      pointsRedeemed: summary.pointsRedeemed,
      pointsEarned,
      totalAmount: summary.payable,
      shippingAddress,
      paymentMethod,
      paymentId: paymentId || null,
    })

    for (const item of summary.items) {
      await OrderItem.create({
        orderId: order.id,
        productId: item.product.id,
        quantity: item.quantity,
        price: item.product.price,
      })
    }

    for (const item of cartItems) {
      const product = await Product.findByPk(item.productId)
      if (product) await product.update({ stock: Math.max(0, product.stock - item.quantity) })
    }

    await Cart.destroy({ where: { userId: req.user.id } })
    await recordTracking(order.id, 'pending', 'Order placed successfully.')

    // Rewards ledger
    if (summary.pointsRedeemed > 0) {
      await debitPoints(user, summary.pointsRedeemed, 'REDEEM', order.id, `Redeemed on order ${order.id}`)
    }
    if (pointsEarned > 0) {
      await creditPoints(user, pointsEarned, 'PURCHASE', order.id, `Reward points for order ${order.id}`)
    }

    // Coupon ledger
    if (summary.coupon) {
      await summary.coupon.update({ usedCount: Number(summary.coupon.usedCount) + 1 })
      await CouponUsage.create({
        couponId: summary.coupon.id,
        userId: req.user.id,
        orderId: order.id,
        amountSaved: summary.couponDiscount,
      })
    }

    const fullOrder = await Order.findByPk(order.id, {
      include: [
        { model: OrderItem, as: 'items' },
        { model: OrderTracking, as: 'tracking', order: [['createdAt', 'ASC']] },
      ],
    })

    res.status(201).json({
      message: 'Order placed successfully.',
      order: fullOrder,
      rewards: { pointsEarned, pointsRedeemed: summary.pointsRedeemed },
    })
  } catch (err) {
    const status = err.statusCode || 500
    res.status(status).json({ message: err.message, error: err.message })
  }
})

// GET /api/orders
router.get('/', async (req, res) => {
  try {
    const orders = await Order.findAll({
      where: { userId: req.user.id },
      include: [{ model: OrderItem, as: 'items', include: [{ model: Product, as: 'product', attributes: ['id', 'name', 'image', 'images'] }] }],
      order: [['createdAt', 'DESC']],
    })
    res.json({ orders })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// GET /api/orders/:id
router.get('/:id', async (req, res) => {
  try {
    if (req.params.id === 'summary') return
    const order = await Order.findOne({
      where: { id: req.params.id, userId: req.user.id },
      include: [
        { model: OrderItem, as: 'items', include: [{ model: Product, as: 'product', attributes: ['id', 'name', 'image', 'images'] }] },
        { model: OrderTracking, as: 'tracking', order: [['createdAt', 'ASC']] },
      ],
    })
    if (!order) return res.status(404).json({ message: 'Order not found.' })
    res.json({ order })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// POST /api/orders/:id/cancel
router.post('/:id/cancel', async (req, res) => {
  try {
    const order = await Order.findOne({
      where: { id: req.params.id, userId: req.user.id },
      include: [{ model: OrderItem, as: 'items' }],
    })
    if (!order) return res.status(404).json({ message: 'Order not found.' })

    if (!['pending', 'processing'].includes(order.status)) {
      return res.status(400).json({ message: 'This order can no longer be cancelled.' })
    }

    await order.update({ status: 'cancelled', refundStatus: 'refunded', refundAmount: Number(order.totalAmount) })
    await recordTracking(order.id, 'cancelled', 'Order cancelled by customer.')

    // Restore stock
    for (const item of order.items) {
      const product = await Product.findByPk(item.productId)
      if (product) await product.update({ stock: Number(product.stock || 0) + item.quantity })
    }

    // Recover earned points
    const user = await User.findByPk(order.userId)
    if (Number(order.pointsEarned || 0) > 0 && user) {
      await debitPoints(user, order.pointsEarned, 'ADJUST', order.id, `Points reversed for cancelled order ${order.id}`)
      await order.update({ pointsEarned: 0 })
    }

    // Return redeemed points
    if (Number(order.pointsRedeemed || 0) > 0 && user && !order.pointsReturned) {
      await creditPoints(user, order.pointsRedeemed, 'REFUND', order.id, `Points returned for cancelled order ${order.id}`)
      await order.update({ pointsReturned: true, pointsRedeemed: 0 })
    }

    // Release coupon usage count
    if (order.couponCode) {
      const coupon = await Coupon.findOne({ where: { code: order.couponCode } })
      if (coupon) await coupon.update({ usedCount: Math.max(0, Number(coupon.usedCount || 0) - 1) })
    }

    const fullOrder = await Order.findByPk(order.id, {
      include: [
        { model: OrderItem, as: 'items', include: [{ model: Product, as: 'product', attributes: ['id', 'name', 'image', 'images'] }] },
        { model: OrderTracking, as: 'tracking', order: [['createdAt', 'ASC']] },
      ],
    })
    res.json({ message: 'Order cancelled and refunded.', order: fullOrder })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// GET /api/orders/:id/invoice
router.get('/:id/invoice', async (req, res) => {
  try {
    const order = await Order.findOne({
      where: { id: req.params.id, userId: req.user.id },
      include: [
        { model: OrderItem, as: 'items', include: [{ model: Product, as: 'product', attributes: ['id', 'name', 'image', 'images'] }] },
        { model: OrderTracking, as: 'tracking', order: [['createdAt', 'ASC']] },
      ],
    })
    if (!order) return res.status(404).json({ message: 'Order not found.' })

    const settings = await getSettings()

    res.json({
      invoice: {
        store: {
          name: settings.storeName,
          tagline: settings.storeTagline,
          supportEmail: settings.supportEmail,
        },
        order,
        items: order.items.map((it) => ({
          ...it.toJSON(),
          product: it.product ? normalizeProduct(it.product) : null,
        })),
        totals: {
          subtotal: Number(order.subtotal ?? order.totalAmount),
          shippingAmount: Number(order.shippingAmount || 0),
          couponDiscount: Number(order.couponDiscount || 0),
          pointsRedeemed: Number(order.pointsRedeemed || 0),
          payable: Number(order.totalAmount),
        },
      },
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

module.exports = router