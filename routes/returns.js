const express = require('express')
const { Op } = require('sequelize')
const { ReturnRequest, Order, OrderItem, Product } = require('../models')
const { authenticate } = require('../middleware/auth')

const router = express.Router()

router.use(authenticate)

// GET /api/returns
router.get('/', async (req, res) => {
  try {
    const returns = await ReturnRequest.findAll({
      where: { userId: req.user.id },
      include: [{
        model: Order,
        as: 'order',
        attributes: ['id', 'totalAmount', 'status', 'createdAt', 'refundStatus'],
        include: [{ model: OrderItem, as: 'items', include: [{ model: Product, as: 'product', attributes: ['id', 'name', 'image', 'images'] }] }],
      }],
      order: [['createdAt', 'DESC']],
    })
    const mapped = returns.map((r) => {
      const json = r.toJSON()
      const raw = JSON.parse(r.items || '[]')
      const orderItems = (json.order?.items || [])
      json.items = raw.map((it) => {
        const oi = orderItems.find((x) => String(x.id) === String(it.orderItemId))
        return {
          ...it,
          product: oi?.product || null,
          refundStatus: oi?.refundStatus || 'none',
          returnedQuantity: Number(oi?.returnedQuantity || 0),
          refundedAt: oi?.refundedAt || null,
        }
      })
      json.photos = JSON.parse(r.photos || '[]')
      return json
    })
    res.json({ returns: mapped })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// POST /api/returns
router.post('/', async (req, res) => {
  try {
    const { orderId, itemIds, action, reason, comment, photos } = req.body

    if (!orderId) return res.status(400).json({ message: 'orderId is required.' })
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ message: 'Select at least one item to return.' })
    }
    if (!['refund', 'return', 'exchange'].includes(action)) {
      return res.status(400).json({ message: 'action must be refund, return or exchange.' })
    }
    if (!reason) return res.status(400).json({ message: 'Please select a reason.' })

    const order = await Order.findOne({
      where: { id: orderId, userId: req.user.id },
      include: [{ model: OrderItem, as: 'items' }],
    })
    if (!order) return res.status(404).json({ message: 'Order not found.' })

    if (order.status !== 'delivered') {
      return res.status(400).json({ message: 'Returns are available for delivered orders only.' })
    }

    // Items already covered by an active (requested/approved) or completed return are excluded,
    // so customers can return the remaining items in a separate request (partial returns).
    const activeRequests = await ReturnRequest.findAll({
      where: { orderId, status: { [Op.in]: ['requested', 'approved', 'rejected'] } },
    })
    const previouslyReturnedIds = new Set()
    for (const r of activeRequests) {
      let arr = []
      try { arr = JSON.parse(r.items || '[]') } catch {}
      for (const it of arr) previouslyReturnedIds.add(String(it.orderItemId))
    }
    for (const it of order.items) {
      if (it.returnedQuantity >= it.quantity) previouslyReturnedIds.add(String(it.id))
    }

    const selected = itemIds.map((x) => String(x))
    const items = order.items.filter((it) => selected.includes(String(it.id)) && !previouslyReturnedIds.has(String(it.id)))
    if (items.length === 0) {
      return res.status(400).json({ message: 'The selected items are already covered by a return request.' })
    }

    const photosArr = Array.isArray(photos) ? photos.filter(Boolean) : []
    if (photosArr.length > 4) return res.status(400).json({ message: 'Maximum 4 photos allowed.' })

    const packed = items.map((it) => ({
      orderItemId: it.id,
      productId: it.productId,
      quantity: it.quantity,
      price: Number(it.price),
    }))

    const request = await ReturnRequest.create({
      userId: req.user.id,
      orderId: order.id,
      items: JSON.stringify(packed),
      action,
      reason,
      comment: comment || null,
      photos: JSON.stringify(photosArr),
    })

    if (order.refundStatus === 'none') await order.update({ refundStatus: 'requested' })

    // Per-item lifecycle: refund requested for the returned items
    for (const it of items) {
      await it.update({ refundStatus: 'requested' })
    }

    res.status(201).json({ message: 'Return request submitted.', request: { ...request.toJSON(), items: packed } })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// GET /api/returns/eligible/:orderId
router.get('/eligible/:orderId', async (req, res) => {
  try {
    const order = await Order.findOne({
      where: { id: req.params.orderId, userId: req.user.id },
      include: [{ model: OrderItem, as: 'items', include: [{ model: Product, as: 'product', attributes: ['id', 'name', 'image', 'images'] }] }],
    })
    if (!order) return res.status(404).json({ message: 'Order not found.' })

    const activeRequests = await ReturnRequest.findAll({
      where: { orderId: order.id, status: { [Op.in]: ['requested', 'approved'] } },
    })
    const alreadyRequestedIds = new Set()
    for (const r of activeRequests) {
      let arr = []
      try { arr = JSON.parse(r.items || '[]') } catch {}
      for (const it of arr) alreadyRequestedIds.add(String(it.orderItemId))
    }

    const eligibleItems = (order.items || [])
      .filter((it) => !alreadyRequestedIds.has(String(it.id)) && Number(it.returnedQuantity || 0) < Number(it.quantity))
      .map((it) => ({
        id: it.id,
        productId: it.productId,
        product: it.product ? it.product.toJSON() : null,
        quantity: it.quantity,
        price: Number(it.price),
        estimatedRefund: Number(it.price) * it.quantity,
      }))

    res.json({
      eligible: order.status === 'delivered' && eligibleItems.length > 0,
      alreadyRequested: alreadyRequestedIds.size > 0,
      orderStatus: order.status,
      returnWindow: 30,
      items: eligibleItems,
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

module.exports = router