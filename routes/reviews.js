const express = require('express')
const { Review, Order, OrderItem, Product } = require('../models')
const { authenticate } = require('../middleware/auth')
const { Op } = require('sequelize')

const router = express.Router()

router.use(authenticate)

const purchasedProduct = async (userId, productId) => {
  return OrderItem.findOne({
    where: { productId },
    include: [
      {
        model: Order,
        where: { userId, status: { [Op.ne]: 'cancelled' } },
      },
    ],
  })
}

// GET /api/reviews/can-review/:productId
router.get('/can-review/:productId', async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.productId)
    if (!product) return res.status(404).json({ message: 'Product not found.' })

    const purchased = await purchasedProduct(req.user.id, req.params.productId)
    const existing = await Review.findOne({
      where: { productId: req.params.productId, userId: req.user.id },
    })

    res.json({ canReview: !!purchased && !existing, alreadyReviewed: !!existing })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// POST /api/reviews
router.post('/', async (req, res) => {
  try {
    const { productId, rating, title, comment, images } = req.body

    if (!productId || !rating) {
      return res.status(400).json({ message: 'Product ID and rating are required.' })
    }

    const product = await Product.findByPk(productId)
    if (!product) return res.status(404).json({ message: 'Product not found.' })

    const numRating = Number(rating)
    if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
      return res.status(400).json({ message: 'Rating must be a whole number from 1 to 5.' })
    }

    const photos = Array.isArray(images) ? images.filter((i) => typeof i === 'string' && i.trim()) : []
    if (photos.length > 3) return res.status(400).json({ message: 'Maximum 3 photos per review.' })
    for (const photo of photos) {
      if (photo.length > 1000000) {
        return res.status(400).json({ message: 'Each photo must be under 1MB. Use a compressed image.' })
      }
    }

    const purchased = await purchasedProduct(req.user.id, productId)
    if (!purchased) {
      return res.status(403).json({ message: 'You can only review products you have purchased.' })
    }

    const existing = await Review.findOne({ where: { productId, userId: req.user.id } })
    if (existing) {
      return res.status(409).json({ message: 'You already reviewed this product.' })
    }

    const review = await Review.create({
      productId,
      userId: req.user.id,
      rating: numRating,
      title: title || null,
      comment: comment || null,
      images: JSON.stringify(photos),
    })

    res.status(201).json({ message: 'Review submitted.', review: { ...review.toJSON(), images: photos } })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// GET /api/reviews/my
router.get('/my', async (req, res) => {
  try {
    const my = await Review.findAll({
      where: { userId: req.user.id },
      include: [{ model: Product, as: 'product', attributes: ['id', 'name', 'image', 'images'] }],
      order: [['createdAt', 'DESC']],
    })
    res.json({ reviews: my })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

module.exports = router