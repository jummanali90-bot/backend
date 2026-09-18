const express = require('express')
const { Wishlist, Product } = require('../models')
const { authenticate } = require('../middleware/auth')
const { normalizeProduct } = require('../utils/helpers')

const router = express.Router()

router.use(authenticate)

// GET /api/wishlist
router.get('/', async (req, res) => {
  try {
    const rows = await Wishlist.findAll({
      where: { userId: req.user.id },
      include: [{ model: Product, as: 'product' }],
      order: [['createdAt', 'DESC']],
    })
    const items = rows
      .filter((r) => r.product)
      .map((r) => ({ id: r.id, productId: r.productId, addedAt: r.createdAt, product: normalizeProduct(r.product) }))
    res.json({ items, count: items.length })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// POST /api/wishlist
router.post('/', async (req, res) => {
  try {
    const { productId } = req.body
    if (!productId) return res.status(400).json({ message: 'productId is required.' })

    const product = await Product.findOne({ where: { id: productId, isActive: true } })
    if (!product) return res.status(404).json({ message: 'Product not found.' })

    const existing = await Wishlist.findOne({ where: { userId: req.user.id, productId } })
    if (existing) return res.status(409).json({ message: 'Product already in wishlist.' })

    const item = await Wishlist.create({ userId: req.user.id, productId })
    res.status(201).json({ message: 'Added to wishlist.', item })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// DELETE /api/wishlist/:productId
router.delete('/:productId', async (req, res) => {
  try {
    const deleted = await Wishlist.destroy({ where: { userId: req.user.id, productId: req.params.productId } })
    if (!deleted) return res.status(404).json({ message: 'Not in wishlist.' })
    res.json({ message: 'Removed from wishlist.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

module.exports = router