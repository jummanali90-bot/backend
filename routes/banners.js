const express = require('express')
const { Banner } = require('../models')

const router = express.Router()

// Public: active banners for the storefront
router.get('/', async (req, res) => {
  try {
    const banners = await Banner.findAll({
      where: { isActive: true },
      order: [
        ['sortOrder', 'ASC'],
        ['createdAt', 'DESC'],
      ],
    })
    res.json({
      banners: banners.map((b) => ({
        id: b.id,
        title: b.title,
        subtitle: b.subtitle,
        cta: b.cta,
        link: b.link,
        image: b.image,
        bg: b.bg,
        text: b.text,
        position: b.position,
        sortOrder: b.sortOrder,
      })),
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

module.exports = router