const express = require('express')
const { Op } = require('sequelize')
const { Product, Review, User } = require('../models')
const { normalizeProduct } = require('../utils/helpers')

const router = express.Router()

router.get('/', async (req, res) => {
  try {
    const { category, search } = req.query
    const where = { isActive: true }

    if (category) where.category = { [Op.eq]: category }
    if (search) {
      where[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { description: { [Op.like]: `%${search}%` } },
        { brand: { [Op.like]: `%${search}%` } },
      ]
    }

    const products = await Product.findAll({ where, order: [['createdAt', 'DESC']] })
    res.json({ products: products.map(normalizeProduct) })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findOne({
      where: { id: req.params.id, isActive: true },
    })
    if (!product) return res.status(404).json({ message: 'Product not found.' })

    const reviews = await Review.findAll({
      where: { productId: product.id, isApproved: true },
      include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
      order: [['createdAt', 'DESC']],
    })

    const ratingAvg = reviews.length
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : 0

    res.json({
      product: normalizeProduct(product),
      reviews: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        comment: r.comment,
        createdAt: r.createdAt,
        images: JSON.parse(r.images || '[]'),
        user: r.user ? { id: r.user.id, name: r.user.name } : null,
      })),
      rating: { average: Math.round(ratingAvg * 10) / 10, count: reviews.length },
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

module.exports = router