const express = require('express')
const { Cart, Product } = require('../models')
const { authenticate } = require('../middleware/auth')
const { normalizeProduct } = require('../utils/helpers')

const router = express.Router()

router.use(authenticate)

// GET /api/cart
router.get('/', async (req, res) => {
  try {
    const cartItems = await Cart.findAll({ where: { userId: req.user.id } })

    const enriched = []
    for (const item of cartItems) {
      const product = await Product.findByPk(item.productId)
      const stock = product ? product.stock : 0
      let quantity = item.quantity
      if (product && quantity > stock) quantity = Math.max(0, stock)
      enriched.push({
        ...item.toJSON(),
        quantity,
        product: product ? normalizeProduct(product) : null,
      })
    }

    res.json({ cartItems: enriched })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// POST /api/cart
router.post('/', async (req, res) => {
  try {
    const { productId, quantity } = req.body

    const product = await Product.findOne({ where: { id: productId, isActive: true } })
    if (!product) {
      return res.status(404).json({ message: 'Product not found.' })
    }

    let cartItem = await Cart.findOne({ where: { userId: req.user.id, productId } })

    const nextQty = (cartItem ? cartItem.quantity : 0) + (quantity || 1)
    if (nextQty > product.stock) {
      return res.status(400).json({ message: `Only ${product.stock} units available in stock.` })
    }

    if (cartItem) {
      await cartItem.update({ quantity: nextQty })
    } else {
      cartItem = await Cart.create({ userId: req.user.id, productId, quantity: quantity || 1 })
    }

    res.json({ message: 'Item added to cart.', cartItem })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// PUT /api/cart/:id
router.put('/:id', async (req, res) => {
  try {
    const cartItem = await Cart.findByPk(req.params.id)
    if (!cartItem || cartItem.userId !== req.user.id) {
      return res.status(404).json({ message: 'Cart item not found.' })
    }
    await cartItem.update({ quantity: req.body.quantity })
    res.json({ message: 'Cart updated.', cartItem })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// DELETE /api/cart/:id
router.delete('/:id', async (req, res) => {
  try {
    const cartItem = await Cart.findByPk(req.params.id)
    if (!cartItem || cartItem.userId !== req.user.id) {
      return res.status(404).json({ message: 'Cart item not found.' })
    }
    await cartItem.destroy()
    res.json({ message: 'Item removed from cart.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

module.exports = router