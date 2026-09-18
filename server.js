const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const morgan = require('morgan')
const path = require('path')
require('dotenv').config()

const sequelize = require('./config/database')
const { getSettings } = require('./utils/settings')
const authRoutes = require('./routes/auth')
const productRoutes = require('./routes/products')
const cartRoutes = require('./routes/cart')
const orderRoutes = require('./routes/orders')
const wishlistRoutes = require('./routes/wishlist')
const adminRoutes = require('./routes/admin')
const paymentRoutes = require('./routes/payment')
const reviewRoutes = require('./routes/reviews')
const profileRoutes = require('./routes/profile')
const rewardRoutes = require('./routes/rewards')
const returnRoutes = require('./routes/returns')
const bannerRoutes = require('./routes/banners')

require('./models')

const migrate = require('./utils/schemaMigrate')

const app = express()
const PORT = process.env.PORT || 5000

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}))
app.use(cors({ origin: true, credentials: true }))
app.use(morgan('dev'))
app.use(express.json())

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'MINJUMART API', version: '1.0.0' })
})

// Public storefront settings (announcement banner, shipping rules, support email)
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await getSettings()
    res.json({
      settings: {
        storeName: settings.storeName,
        storeTagline: settings.storeTagline,
        announcement: settings.announcement,
        freeShippingAbove: settings.freeShippingAbove,
        shippingFee: settings.shippingFee,
        supportEmail: settings.supportEmail,
      },
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

app.use('/api/auth', authRoutes)
app.use('/api/users', authRoutes)
app.use('/api/products', productRoutes)
app.use('/api/cart', cartRoutes)
app.use('/api/orders', orderRoutes)
app.use('/api/wishlist', wishlistRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/payments', paymentRoutes)
app.use('/api/reviews', reviewRoutes)
app.use('/api/profile', profileRoutes)
app.use('/api/rewards', rewardRoutes)
app.use('/api/coupons', rewardRoutes)
app.use('/api/returns', returnRoutes)
app.use('/api/banners', bannerRoutes)

// Production: serve the built frontend (single-port deploy)
const distDir = path.join(__dirname, '..', 'frontend', 'dist')
app.use(express.static(distDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache')
    } else {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    }
  },
}))
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    res.setHeader('Cache-Control', 'no-cache')
    return res.sendFile(path.join(distDir, 'index.html'))
  }
  next()
})

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ message: 'Internal server error.' })
})

const start = async () => {
  try {
    await sequelize.authenticate()
    console.log('Database connected.')
    await sequelize.sync()
    console.log('Models synced.')
    await migrate()
    console.log('Schema migrations applied.')
  } catch (err) {
    console.warn('Database unavailable, running without persistence:', err.message)
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MINJUMART API running on http://0.0.0.0:${PORT}`)
  })
}

start()
