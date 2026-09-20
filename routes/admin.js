const express = require('express')
const { Op, Sequelize } = require('sequelize')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const {
  User, Order, OrderItem, OrderTracking, Product, Review, LoginHistory, ActivityLog, Setting,
  Coupon, CouponUsage, ReturnRequest, LoyaltyTransaction, Banner,
} = require('../models')
const { authenticate, adminOnly, require2FA } = require('../middleware/auth')
const { parseImages, parseHighlights, normalizeProduct, logActivity } = require('../utils/helpers')
const { DEFAULT_SETTINGS, getSettings, getJSON, setJSON, getLoyaltyConfig } = require('../utils/settings')
const { creditPoints, debitPoints, tierForPoints, cashbackPercentFor } = require('../utils/rewards')
const { seedDemoData } = require('../utils/demoData')
const { ORDER_FLOW, REFUND_FLOW } = require('../constants/orderStatus')

const router = express.Router()

router.use(authenticate, adminOnly, require2FA)

// ------------------------- IMAGE UPLOADS -------------------------

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads')
const productUploadsDir = path.join(UPLOADS_DIR, 'products')
fs.mkdirSync(productUploadsDir, { recursive: true })

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, productUploadsDir),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase()
    const base = path
      .basename(file.originalname, path.extname(file.originalname))
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'img'
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${base}${ext}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => {
    // Some devices/browsers report generic mime types (e.g. application/octet-stream)
    // for photos picked from a gallery, so structure the check on the real bytes too.
    const mime = (file.mimetype || '').toLowerCase()
    const ext = path.extname(file.originalname || '').toLowerCase()
    const looksImage = /^image\/|image/i.test(mime) || /^\.(jpe?g|png|webp|gif|avif|bmp|heic|heif)$/i.test(ext)
    if (looksImage) cb(null, true)
    else cb(new Error('Only image files are allowed (JPEG, PNG, WebP, GIF, HEIC, AVIF).'))
  },
})

// Sniff the real format from the leading bytes so mislabeled device photos still pass.
const sniffImageType = (buf) => {
  if (!buf || buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif'
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp'
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
    return buf.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null
  }
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    const brand = buf.toString('ascii', 8, 12)
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
    if (/^(heic|heix|mif1|msf1|heif|heim)$/.test(brand)) return 'image/heic'
  }
  return null
}

// POST /api/admin/uploads — one or more files under the "images" field
router.post('/uploads', (req, res) => {
  upload.array('images', 8)(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message || 'Upload failed. Please try again.' })
    const files = req.files || []
    if (!files.length) return res.status(400).json({ message: 'No image selected.' })

    const kept = []
    const rejected = []
    for (const f of files) {
      let type = null
      try {
        type = sniffImageType(fs.readFileSync(f.path))
      } catch {
        type = null
      }
      if (type) {
        kept.push(f)
      } else {
        rejected.push(f.originalname || 'file')
        try { fs.unlinkSync(f.path) } catch { /* best effort cleanup */ }
      }
    }

    if (!kept.length) {
      return res.status(400).json({
        message: rejected.length ? `"${rejected[0]}" is not a valid image file.` : 'No valid image files were uploaded.',
      })
    }

    if (rejected.length) {
      console.warn('Rejected non-image uploads:', rejected.join(', '))
    }

    res.status(201).json({
      message: `${kept.length} image${kept.length > 1 ? 's' : ''} uploaded.`,
      urls: kept.map((f) => `/uploads/products/${f.filename}`),
    })
  })
})

// DELETE /api/admin/uploads — remove uploaded files from disk
router.delete('/uploads', (req, res) => {
  const raw = Array.isArray(req.body.urls) ? req.body.urls : req.body.url ? [req.body.url] : []
  const removed = []
  for (const url of raw) {
    if (typeof url !== 'string' || !url.includes('/uploads/products/')) continue
    const name = url.split('/uploads/products/')[1]
    if (!name || !/^[A-Za-z0-9._-]+$/.test(name)) continue
    const full = path.join(productUploadsDir, name)
    if (full.startsWith(productUploadsDir) && fs.existsSync(full)) {
      try {
        fs.unlinkSync(full)
        removed.push(url)
      } catch { /* ignore per-file failures */ }
    }
  }
  res.json({ message: `${removed.length} image${removed.length === 1 ? '' : 's'} deleted.`, removed })
})

const safeFindUser = async (id) => {
  try {
    return await User.findByPk(id)
  } catch {
    return null
  }
}

const orderWithDetails = {
  include: [
    {
      model: OrderItem,
      as: 'items',
      include: [{ model: Product, as: 'product', attributes: ['id', 'name', 'image', 'images'] }],
    },
    { model: OrderTracking, as: 'tracking', order: [['createdAt', 'ASC']] },
    { model: User, as: 'user', attributes: ['id', 'name', 'email', 'phone'] },
  ],
}

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    const [userCount, orderCount, productCount, lowStockCount, pendingCount, revenueAgg] = await Promise.all([
      User.count(),
      Order.count(),
      Product.count(),
      Product.count({ where: { stock: { [Op.lte]: Sequelize.col('lowStockThreshold') }, isActive: true } }),
      Order.count({ where: { status: { [Op.in]: ['pending', 'processing'] } } }),
      Order.findAll({ where: { status: { [Op.ne]: 'cancelled' } }, attributes: ['totalAmount'] }),
    ])

    const revenue = revenueAgg.reduce((s, o) => s + Number(o.totalAmount || 0), 0)
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const newUsers = await User.count({ where: { createdAt: { [Op.gte]: since } } })

    res.json({
      stats: {
        userCount, orderCount, productCount, lowStockCount, pendingCount,
        revenue: Math.round(revenue * 100) / 100, newUsers,
      },
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: ['password', 'otp', 'otpExpires', 'twoFactorSecret'] },
      include: [{ model: Order, as: 'orders', attributes: ['totalAmount', 'status'] }],
      order: [['createdAt', 'DESC']],
    })

    const mapped = []
    for (const u of users) {
      const orders = u.orders || []
      const tier = await tierForPoints(u.pointsEarnedCumulative)
      const cashbackPercent = await cashbackPercentFor(tier)
      mapped.push({
        ...u.toJSON(),
        orders: undefined,
        orderCount: orders.length,
        totalSpent: Math.round(orders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + Number(o.totalAmount || 0), 0) * 100) / 100,
        membershipTier: tier,
        cashbackPercent,
      })
    }

    res.json({ users: mapped })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// GET /api/admin/users/:id/login-history
router.get('/users/:id/login-history', async (req, res) => {
  try {
    const history = await LoginHistory.findAll({
      where: { userId: req.params.id },
      order: [['createdAt', 'DESC']],
      limit: 50,
    })
    res.json({ history })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// PATCH /api/admin/users/:id
router.patch('/users/:id', async (req, res) => {
  try {
    const { role, isActive } = req.body
    const user = await safeFindUser(req.params.id)
    if (!user) return res.status(404).json({ message: 'User not found.' })

    if (req.params.id === req.user.id && isActive === false) {
      return res.status(400).json({ message: 'You cannot deactivate your own account.' })
    }

    const changes = {}
    if (role !== undefined) {
      if (!['user', 'admin'].includes(role)) return res.status(400).json({ message: 'Invalid role.' })
      changes.role = role
    }
    if (isActive !== undefined) changes.isActive = !!isActive

    await user.update(changes)
    await logActivity(req.user, 'user_update', 'user', user.id, changes)

    const updated = await User.findByPk(user.id, { attributes: { exclude: ['password', 'otp', 'otpExpires', 'twoFactorSecret'] } })
    res.json({ message: 'User updated.', user: updated })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// GET /api/admin/orders
router.get('/orders', async (req, res) => {
  try {
    const { status } = req.query
    const where = status ? { status } : {}
    const orders = await Order.findAll({
      where,
      ...orderWithDetails,
      order: [['createdAt', 'DESC']],
    })
    res.json({ orders })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// GET /api/admin/orders/:id
router.get('/orders/:id', async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id, orderWithDetails)
    if (!order) return res.status(404).json({ message: 'Order not found.' })
    res.json({ order })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// PATCH /api/admin/orders/:id/status
router.patch('/orders/:id/status', async (req, res) => {
  try {
    const { status, note } = req.body
    const valid = [...ORDER_FLOW, 'cancelled']
    if (!valid.includes(status)) {
      return res.status(400).json({ message: 'Invalid status.' })
    }

    const order = await Order.findByPk(req.params.id)
    if (!order) return res.status(404).json({ message: 'Order not found.' })

    await order.update({ status })
    await OrderTracking.create({ orderId: order.id, status, note: note || null })
    await logActivity(req.user, 'order_status', 'order', order.id, { status, note })

    // Refund redeemed points when cancelling
    if (status === 'cancelled' && Number(order.pointsRedeemed || 0) > 0 && !order.pointsReturned) {
      const user = await User.findByPk(order.userId)
      if (user) {
        await creditPoints(user, order.pointsRedeemed, 'REFUND', order.id, `Points returned for cancelled order ${order.id}`)
        await order.update({ pointsReturned: true, pointsRedeemed: 0 })
        await logActivity(req.user, 'points_refund', 'order', order.id, { points: order.pointsRedeemed })
      }
    }

    const fullOrder = await Order.findByPk(order.id, orderWithDetails)
    res.json({ message: 'Order status updated.', order: fullOrder })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// PATCH /api/admin/orders/:id/refund
router.patch('/orders/:id/refund', async (req, res) => {
  try {
    const { refundStatus, amount, note } = req.body
    const valid = REFUND_FLOW
    if (!valid.includes(refundStatus)) {
      return res.status(400).json({ message: 'Invalid refund status.' })
    }

    const order = await Order.findByPk(req.params.id, {
      include: [{ model: OrderItem, as: 'items' }],
    })
    if (!order) return res.status(404).json({ message: 'Order not found.' })

    const changes = { refundStatus }
    if (amount !== undefined && amount !== '') {
      const num = Number(amount)
      if (num < 0) return res.status(400).json({ message: 'Refund amount cannot be negative.' })
      changes.refundAmount = num
    }
    if (note !== undefined) changes.refundNote = note || null

    await order.update(changes)
    await logActivity(req.user, 'order_refund', 'order', order.id, changes)

    const items = order.items || []
    const allReturned = items.length > 0 && items.every((it) => Number(it.returnedQuantity || 0) >= Number(it.quantity))

    // Keep every returned item's refund status in sync with the order refund.
    for (const it of items) {
      if (Number(it.returnedQuantity || 0) > 0 || (it.refundStatus && it.refundStatus !== 'none')) {
        if (refundStatus === 'refunded') {
          await it.update({ refundStatus: 'refunded', refundedAt: new Date() })
        } else {
          await it.update({ refundStatus })
        }
      }
    }

    // A fully returned order is marked 'returned' (never 'cancelled') — only an
    // actual cancellation cancels an order. Partial returns leave the order
    // delivered and the remaining items untouched.
    if (refundStatus === 'refunded' && order.status !== 'cancelled') {
      if (allReturned) {
        await order.update({ status: 'returned' })
        await OrderTracking.create({ orderId: order.id, status: 'returned', note: 'All items returned. Refund completed.' })

        // Reverse points earned on the returned order
        const user = await User.findByPk(order.userId)
        if (user && Number(order.pointsEarned || 0) > 0) {
          await debitPoints(user, order.pointsEarned, 'ADJUST', order.id, `Points reversed after full return of order ${order.id}`)
          await order.update({ pointsEarned: 0 })
        }
      } else {
        await OrderTracking.create({ orderId: order.id, status: order.status, note: 'Partial refund completed — order continues.' })
      }
    }

    const fullOrder = await Order.findByPk(order.id, orderWithDetails)
    res.json({ message: 'Refund updated.', order: fullOrder })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// GET /api/admin/products
router.get('/products', async (req, res) => {
  try {
    const { lowStock, q } = req.query
    const where = {}
    if (lowStock === '1') where.stock = { [Op.lte]: Sequelize.col('lowStockThreshold') }
    if (q) where.name = { [Op.like]: `%${q}%` }

    const products = await Product.findAll({ where, order: [['createdAt', 'DESC']] })
    res.json({
      products: products.map((p) => {
        const norm = normalizeProduct(p)
        norm.lowStock = p.stock <= p.lowStockThreshold
        norm.outOfStock = p.stock <= 0
        return norm
      }),
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

const productFieldsFrom = (body) => {
  const data = {}
  if (body.name !== undefined) data.name = body.name
  if (body.description !== undefined) data.description = body.description
  if (body.price !== undefined) data.price = body.price
  if (body.category !== undefined) data.category = body.category
  if (body.subCategory !== undefined) data.subCategory = body.subCategory || null
  if (body.brand !== undefined) data.brand = body.brand || null
  if (body.mrp !== undefined) data.mrp = body.mrp === '' ? null : body.mrp
  if (body.costPrice !== undefined) data.costPrice = body.costPrice === '' ? null : body.costPrice
  if (body.sku !== undefined) data.sku = body.sku || null
  if (body.weight !== undefined) data.weight = body.weight || null
  if (body.dimensions !== undefined) data.dimensions = body.dimensions || null
  if (body.color !== undefined) data.color = body.color || null
  if (body.size !== undefined) data.size = body.size || null
  if (body.material !== undefined) data.material = body.material || null
  if (body.highlights !== undefined) data.highlights = JSON.stringify(parseHighlights(body.highlights))
  if (body.warrantyInfo !== undefined) data.warrantyInfo = body.warrantyInfo || null
  if (body.stock !== undefined) data.stock = Number(body.stock) || 0
  if (body.lowStockThreshold !== undefined) data.lowStockThreshold = Number(body.lowStockThreshold) || 5
  if (body.featured !== undefined) data.featured = !!body.featured
  if (body.isActive !== undefined) data.isActive = !!body.isActive
  if (body.image !== undefined) data.image = body.image || null
  if (body.images !== undefined) {
    data.images = JSON.stringify(parseImages(body.images))
    if (!data.image && parseImages(body.images).length) data.image = parseImages(body.images)[0]
  }
  return data
}

const requireFields = (body, fields) => {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || String(body[f]).trim() === '')
  if (missing.length) {
    return `The following fields are required: ${missing.join(', ')}.`
  }
  return null
}

// POST /api/admin/products
router.post('/products', async (req, res) => {
  try {
    const required = requireFields(req.body, ['name', 'price', 'stock', 'category'])
    if (required) return res.status(400).json({ message: required })

    const product = await Product.create(productFieldsFrom(req.body))
    await logActivity(req.user, 'product_create', 'product', product.id, { name: product.name, price: product.price })
    res.status(201).json({ message: 'Product created.', product: normalizeProduct(product) })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// PUT /api/admin/products/:id
router.put('/products/:id', async (req, res) => {
  try {
    const required = requireFields(req.body, ['name', 'price', 'stock', 'category'])
    if (required) return res.status(400).json({ message: required })

    const product = await Product.findByPk(req.params.id)
    if (!product) return res.status(404).json({ message: 'Product not found.' })

    await product.update(productFieldsFrom(req.body))
    await logActivity(req.user, 'product_update', 'product', product.id, { name: product.name })
    res.json({ message: 'Product updated.', product: normalizeProduct(product) })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// Remove uploaded image files belonging to a product from disk (no orphans left behind)
const removeProductFiles = (product) => {
  const urls = parseImages(product.images || '[]')
  if (product.image) urls.push(product.image)
  for (const url of urls) {
    if (typeof url !== 'string' || !url.includes('/uploads/products/')) continue
    const name = url.split('/uploads/products/')[1]
    if (!name || !/^[A-Za-z0-9._-]+$/.test(name)) continue
    const full = path.join(productUploadsDir, name)
    if (full.startsWith(productUploadsDir) && fs.existsSync(full)) {
      try {
        fs.unlinkSync(full)
      } catch { /* ignore per-file failures */ }
    }
  }
}

// DELETE /api/admin/products/:id
router.delete('/products/:id', async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id)
    if (!product) return res.status(404).json({ message: 'Product not found.' })

    removeProductFiles(product)
    await product.destroy()
    await logActivity(req.user, 'product_delete', 'product', product.id, { name: product.name })
    res.json({ message: 'Product deleted.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// GET /api/admin/analytics/detailed
router.get('/analytics/detailed', async (req, res) => {
  try {
    const daysParam = parseInt(req.query.days, 10)
    const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : 90
    const now = new Date()
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

    // Fetch all relevant orders in the window
    const orders = await Order.findAll({
      where: { createdAt: { [Op.gte]: startDate } },
      include: [
        { model: OrderItem, as: 'items', include: [{ model: Product, as: 'product', attributes: ['id', 'name', 'costPrice'] }] },
        { model: User, as: 'user', attributes: ['id', 'name', 'email'] },
      ],
      order: [['createdAt', 'ASC']],
    })

    // Fetch all return requests in the window
    const returnRequests = await ReturnRequest.findAll({
      where: { createdAt: { [Op.gte]: startDate } },
      include: [
        { model: Order, as: 'order', attributes: ['id', 'totalAmount', 'refundAmount', 'refundStatus'] },
        { model: User, as: 'user', attributes: ['id', 'name'] },
      ],
      order: [['createdAt', 'ASC']],
    })

    // Build daily map
    const dailyMap = {}
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      dailyMap[d] = {
        date: d,
        sales: 0,
        orders: 0,
        returns: 0,
        returnCount: 0,
        refunds: 0,
        refundCount: 0,
        itemsSold: 0,
        itemsReturned: 0,
      }
    }

    // Process orders for daily sales
    for (const o of orders) {
      const day = o.createdAt.toISOString().slice(0, 10)
      if (!dailyMap[day]) continue
      const isCancelled = o.status === 'cancelled'
      if (!isCancelled) {
        dailyMap[day].sales += Number(o.totalAmount || 0)
        dailyMap[day].orders += 1
      }
      for (const item of o.items || []) {
        const qty = item.quantity
        const returnedQty = Number(item.returnedQuantity || 0)
        const soldQty = qty - returnedQty
        if (!isCancelled) dailyMap[day].itemsSold += soldQty
        if (returnedQty > 0) {
          dailyMap[day].itemsReturned += returnedQty
        }
      }
    }

    // Process refunds from orders with refundStatus
    for (const o of orders) {
      if (o.status === 'cancelled') continue
      const day = o.createdAt.toISOString().slice(0, 10)
      if (!dailyMap[day]) continue
      if (['processing', 'refunded'].includes(o.refundStatus) && Number(o.refundAmount || 0) > 0) {
        dailyMap[day].refunds += Number(o.refundAmount || 0)
        dailyMap[day].refundCount += 1
      }
    }

    // Process return requests for daily returns
    for (const r of returnRequests) {
      const day = r.createdAt.toISOString().slice(0, 10)
      if (!dailyMap[day]) continue
      dailyMap[day].returnCount += 1
      const packed = JSON.parse(r.items || '[]')
      const refundVal = packed.reduce((s, it) => s + Number(it.price || 0) * Number(it.quantity || 1), 0)
      dailyMap[day].returns += refundVal
    }

    // Convert to sorted array
    const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date))

    // Monthly aggregation for the last 3 months
    const monthlyMap = {}
    for (const d of daily) {
      const monthKey = d.date.slice(0, 7) // YYYY-MM
      if (!monthlyMap[monthKey]) {
        monthlyMap[monthKey] = { month: monthKey, sales: 0, returns: 0, refunds: 0, orders: 0, returnCount: 0, refundCount: 0, itemsSold: 0, itemsReturned: 0 }
      }
      monthlyMap[monthKey].sales += d.sales
      monthlyMap[monthKey].returns += d.returns
      monthlyMap[monthKey].refunds += d.refunds
      monthlyMap[monthKey].orders += d.orders
      monthlyMap[monthKey].returnCount += d.returnCount
      monthlyMap[monthKey].refundCount += d.refundCount
      monthlyMap[monthKey].itemsSold += d.itemsSold
      monthlyMap[monthKey].itemsReturned += d.itemsReturned
    }
    const monthly = Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month))

    // Summary stats
    const totalSales = daily.reduce((s, d) => s + d.sales, 0)
    const totalReturns = daily.reduce((s, d) => s + d.returns, 0)
    const totalRefunds = daily.reduce((s, d) => s + d.refunds, 0)
    const totalOrders = daily.reduce((s, d) => s + d.orders, 0)
    const totalItemsSold = daily.reduce((s, d) => s + d.itemsSold, 0)
    const totalItemsReturned = daily.reduce((s, d) => s + d.itemsReturned, 0)
    const totalReturnRequests = daily.reduce((s, d) => s + d.returnCount, 0)
    const totalRefundRequests = daily.reduce((s, d) => s + d.refundCount, 0)

    // Best/worst days
    const nonZeroDays = daily.filter((d) => d.sales > 0)
    const bestDay = nonZeroDays.length ? nonZeroDays.reduce((best, d) => d.sales > best.sales ? d : best) : null
    const worstDay = nonZeroDays.length ? nonZeroDays.reduce((worst, d) => d.sales < worst.sales ? d : worst) : null

    const summary = {
      totalSales: Math.round(totalSales * 100) / 100,
      totalReturns: Math.round(totalReturns * 100) / 100,
      totalRefunds: Math.round(totalRefunds * 100) / 100,
      netRevenue: Math.round((totalSales - totalRefunds) * 100) / 100,
      totalOrders,
      totalItemsSold,
      totalItemsReturned,
      totalReturnRequests,
      totalRefundRequests,
      averageDailySales: daily.length ? Math.round((totalSales / daily.length) * 100) / 100 : 0,
      averageOrderValue: totalOrders ? Math.round((totalSales / totalOrders) * 100) / 100 : 0,
      returnRate: totalItemsSold ? Math.round((totalItemsReturned / totalItemsSold) * 10000) / 100 : 0,
      bestDay: bestDay ? { date: bestDay.date, sales: Math.round(bestDay.sales * 100) / 100 } : null,
      worstDay: worstDay ? { date: worstDay.date, sales: Math.round(worstDay.sales * 100) / 100 } : null,
    }

    res.json({ summary, daily, monthly, days })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// GET /api/admin/analytics/dashboard — unified data for the single-dashboard view
router.get('/analytics/dashboard', async (req, res) => {
  try {
    const daysParam = parseInt(req.query.days, 10)
    const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : 90
    const now = new Date()
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

    // Dashboard overview stats
    const [userCount, orderCount, productCount, lowStockCount, pendingCount] = await Promise.all([
      User.count(),
      Order.count(),
      Product.count(),
      Product.count({ where: { stock: { [Op.lte]: Sequelize.col('lowStockThreshold') }, isActive: true } }),
      Order.count({ where: { status: { [Op.in]: ['pending', 'processing'] } } }),
    ])
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const newUsers = await User.count({ where: { createdAt: { [Op.gte]: since } } })

    // Orders in the window
    const orders = await Order.findAll({
      where: { createdAt: { [Op.gte]: startDate } },
      include: [
        { model: OrderItem, as: 'items', include: [{ model: Product, as: 'product', attributes: ['id', 'name', 'costPrice'] }] },
        { model: User, as: 'user', attributes: ['id', 'name', 'email'] },
      ],
      order: [['createdAt', 'ASC']],
    })

    const returnRequests = await ReturnRequest.findAll({
      where: { createdAt: { [Op.gte]: startDate } },
      include: [{ model: Order, as: 'order', attributes: ['id', 'totalAmount', 'refundAmount', 'refundStatus'] }],
      order: [['createdAt', 'ASC']],
    })

    // Per-product stats across the window
    const productStats = {}
    for (const o of orders) {
      if (o.status === 'cancelled') continue
      for (const item of o.items || []) {
        const soldQty = Number(item.quantity || 0) - Number(item.returnedQuantity || 0)
        if (soldQty <= 0) continue
        productStats[item.productId] = productStats[item.productId] || { productId: item.productId, unitsSold: 0, revenue: 0, profit: 0 }
        productStats[item.productId].unitsSold += soldQty
        productStats[item.productId].revenue += Number(item.price || 0) * soldQty
        const itemCost = Number(item.product?.costPrice || 0) || Number(item.price || 0)
        productStats[item.productId].profit += (Number(item.price || 0) - itemCost) * soldQty
      }
    }

    // Daily buckets
    const dailyMap = {}
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      dailyMap[d] = {
        date: d, sales: 0, orders: 0, returns: 0, returnCount: 0,
        refunds: 0, refundCount: 0, itemsSold: 0, itemsReturned: 0,
      }
    }

    for (const o of orders) {
      const day = o.createdAt.toISOString().slice(0, 10)
      if (!dailyMap[day]) continue
      const isCancelled = o.status === 'cancelled'
      if (!isCancelled) {
        dailyMap[day].sales += Number(o.totalAmount || 0)
        dailyMap[day].orders += 1
      }
      for (const item of o.items || []) {
        const qty = item.quantity
        const returnedQty = Number(item.returnedQuantity || 0)
        if (!isCancelled) dailyMap[day].itemsSold += qty - returnedQty
        if (returnedQty > 0) dailyMap[day].itemsReturned += returnedQty
      }
    }

    for (const o of orders) {
      if (o.status === 'cancelled') continue
      const day = o.createdAt.toISOString().slice(0, 10)
      if (!dailyMap[day]) continue
      if (['processing', 'refunded'].includes(o.refundStatus) && Number(o.refundAmount || 0) > 0) {
        dailyMap[day].refunds += Number(o.refundAmount || 0)
        dailyMap[day].refundCount += 1
      }
    }

    for (const r of returnRequests) {
      const day = r.createdAt.toISOString().slice(0, 10)
      if (!dailyMap[day]) continue
      dailyMap[day].returnCount += 1
      const packed = JSON.parse(r.items || '[]')
      dailyMap[day].returns += packed.reduce((s, it) => s + Number(it.price || 0) * Number(it.quantity || 1), 0)
    }

    const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date))

    // Monthly aggregation
    const monthlyMap = {}
    for (const d of daily) {
      const monthKey = d.date.slice(0, 7)
      monthlyMap[monthKey] = monthlyMap[monthKey] || {
        month: monthKey, sales: 0, returns: 0, refunds: 0, orders: 0,
        returnCount: 0, refundCount: 0, itemsSold: 0, itemsReturned: 0,
      }
      const m = monthlyMap[monthKey]
      m.sales += d.sales; m.returns += d.returns; m.refunds += d.refunds
      m.orders += d.orders; m.returnCount += d.returnCount; m.refundCount += d.refundCount
      m.itemsSold += d.itemsSold; m.itemsReturned += d.itemsReturned
    }
    const monthly = Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month))

    // Totals
    const totalSales = daily.reduce((s, d) => s + d.sales, 0)
    const totalReturns = daily.reduce((s, d) => s + d.returns, 0)
    const totalRefunds = daily.reduce((s, d) => s + d.refunds, 0)
    const totalOrders = daily.reduce((s, d) => s + d.orders, 0)
    const totalItemsSold = daily.reduce((s, d) => s + d.itemsSold, 0)
    const totalItemsReturned = daily.reduce((s, d) => s + d.itemsReturned, 0)
    const totalReturnRequests = daily.reduce((s, d) => s + d.returnCount, 0)
    const totalRefundRequests = daily.reduce((s, d) => s + d.refundCount, 0)

    const nonZeroDays = daily.filter((d) => d.sales > 0)
    const bestDay = nonZeroDays.length ? nonZeroDays.reduce((best, d) => d.sales > best.sales ? d : best) : null
    const worstDay = nonZeroDays.length ? nonZeroDays.reduce((worst, d) => d.sales < worst.sales ? d : worst) : null

    const revenueAgg = await Order.findAll({ where: { status: { [Op.ne]: 'cancelled' } }, attributes: ['totalAmount'] })
    const revenue = revenueAgg.reduce((s, o) => s + Number(o.totalAmount || 0), 0)

    const summary = {
      totalSales: Math.round(totalSales * 100) / 100,
      totalReturns: Math.round(totalReturns * 100) / 100,
      totalRefunds: Math.round(totalRefunds * 100) / 100,
      netRevenue: Math.round((totalSales - totalRefunds) * 100) / 100,
      totalOrders,
      totalItemsSold,
      totalItemsReturned,
      totalReturnRequests,
      totalRefundRequests,
      averageDailySales: daily.length ? Math.round((totalSales / daily.length) * 100) / 100 : 0,
      averageOrderValue: totalOrders ? Math.round((totalSales / totalOrders) * 100) / 100 : 0,
      returnRate: totalItemsSold ? Math.round((totalItemsReturned / totalItemsSold) * 10000) / 100 : 0,
      bestDay: bestDay ? { date: bestDay.date, sales: Math.round(bestDay.sales * 100) / 100 } : null,
      worstDay: worstDay ? { date: worstDay.date, sales: Math.round(worstDay.sales * 100) / 100 } : null,
    }

    // Product inventory summary with reorder needs
    const productRows = await Product.findAll({ attributes: ['id', 'name', 'category', 'image', 'price', 'costPrice', 'stock', 'lowStockThreshold', 'isActive'] })
    const products = productRows.map((p) => {
      const st = productStats[p.id] || { unitsSold: 0, revenue: 0, profit: 0 }
      const stock = Number(p.stock) || 0
      const threshold = Number(p.lowStockThreshold) || 5
      const status = stock <= 0 ? 'out' : stock <= threshold ? 'low' : 'ok'
      const reorderQty = status === 'ok' ? 0 : Math.max(threshold * 3 - stock, 5)
      return {
        productId: p.id,
        name: p.name,
        category: p.category,
        image: p.image,
        price: Number(p.price) || 0,
        costPrice: Number(p.costPrice) || 0,
        unitsSold: st.unitsSold,
        revenue: Math.round(st.revenue * 100) / 100,
        profit: Math.round(st.profit * 100) / 100,
        stock,
        lowStockThreshold: threshold,
        isActive: !!p.isActive,
        status,
        reorderQty,
      }
    })
    const lowStockProducts = products.filter((p) => p.status !== 'ok').sort((a, b) => {
      if (a.status === b.status) return a.stock - b.stock
      return a.status === 'out' ? -1 : 1
    })

    // Top customers
    const customerStats = {}
    for (const o of orders) {
      if (o.status === 'cancelled' || !o.user) continue
      customerStats[o.user.id] = customerStats[o.user.id] || { userId: o.user.id, name: o.user.name, email: o.user.email, orders: 0, spent: 0 }
      customerStats[o.user.id].orders += 1
      customerStats[o.user.id].spent += Number(o.totalAmount || 0)
    }
    const topCustomers = Object.values(customerStats).sort((a, b) => b.spent - a.spent).slice(0, 6)

    const stats = {
      userCount, orderCount, productCount, lowStockCount, pendingCount,
      revenue: Math.round(revenue * 100) / 100,
      newUsers,
    }

    // ------------------------- TODAY'S SALE -------------------------
    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)
    const todayKey = dayStart.toISOString().slice(0, 10)

    const todaysOrders = await Order.findAll({
      where: { createdAt: { [Op.gte]: dayStart } },
      include: [{ model: OrderItem, as: 'items' }],
    })
    const todaysReturns = await ReturnRequest.count({ where: { createdAt: { [Op.gte]: dayStart } } })
    const todaysNewProducts = await Product.count({ where: { createdAt: { [Op.gte]: dayStart } } })
    const todaysRefunds = await Order.findAll({
      where: {
        updatedAt: { [Op.gte]: dayStart },
        refundStatus: { [Op.in]: ['processing', 'refunded'] },
      },
      attributes: ['id', 'refundAmount'],
    })

    let todaysSales = 0
    let todaysProductsSold = 0
    let todaysItemsReturned = 0
    const hourly = {}
    for (let h = 0; h < 24; h++) hourly[h] = { hour: h, sales: 0, orders: 0, returns: 0, refunds: 0, productsSold: 0 }

    for (const o of todaysOrders) {
      if (o.status === 'cancelled') continue
      const hour = o.createdAt.getHours()
      todaysSales += Number(o.totalAmount || 0)
      hourly[hour].sales += Number(o.totalAmount || 0)
      hourly[hour].orders += 1
      for (const item of o.items || []) {
        const soldQty = Number(item.quantity || 0) - Number(item.returnedQuantity || 0)
        todaysProductsSold += soldQty
        hourly[hour].productsSold += soldQty
        if (Number(item.returnedQuantity || 0) > 0) todaysItemsReturned += Number(item.returnedQuantity || 0)
      }
    }

    // Refunds processed today (matches against the refund order rows by their update time)
    for (const r of todaysRefunds) {
      const hour = r.updatedAt.getHours()
      hourly[hour].refunds += Number(r.refundAmount || 0)
    }

    const todaysRefundsAmount = todaysRefunds.reduce((s, r) => s + Number(r.refundAmount || 0), 0)
    const today = {
      date: todayKey,
      sales: Math.round(todaysSales * 100) / 100,
      productsSold: todaysProductsSold,
      revenue: Math.round((todaysSales - todaysRefundsAmount) * 100) / 100,
      returnsInitiated: todaysReturns,
      itemsReturned: todaysItemsReturned,
      refundsProcessed: todaysRefunds.length,
      refundsAmount: Math.round(todaysRefundsAmount * 100) / 100,
      newProducts: todaysNewProducts,
      orders: todaysOrders.filter((o) => o.status !== 'cancelled').length,
      hourly: Object.values(hourly),
    }

    res.json({ today, stats, summary, daily, monthly, products, lowStockProducts, topCustomers, days })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// GET /api/admin/analytics
router.get('/analytics', async (req, res) => {
  try {
    const orders = await Order.findAll({
      where: { status: { [Op.ne]: 'cancelled' } },
      include: [{ model: OrderItem, as: 'items' }, { model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
      order: [['createdAt', 'ASC']],
    })

    const products = await Product.findAll({ attributes: ['id', 'name', 'costPrice'] })
    const costById = Object.fromEntries(products.map((p) => [p.id, Number(p.costPrice) || 0]))
    const nameById = Object.fromEntries(products.map((p) => [p.id, p.name]))

    const revenue = orders.reduce((s, o) => s + Number(o.totalAmount || 0), 0)
    let cost = 0
    let itemsSold = 0
    const productStats = {}
    const customerStats = {}
    const daily = {}

    for (const o of orders) {
      const day = o.createdAt.toISOString().slice(0, 10)
      daily[day] = daily[day] || { date: day, orders: 0, revenue: 0 }
      daily[day].orders += 1
      daily[day].revenue += Number(o.totalAmount || 0)

      for (const item of o.items || []) {
        const qty = item.quantity
        const returnedQty = Number(item.returnedQuantity || 0)
        const soldQty = qty - returnedQty
        itemsSold += soldQty
        cost += costById[item.productId] ? costById[item.productId] * soldQty : 0
        productStats[item.productId] = productStats[item.productId] || {
          productId: item.productId, name: nameById[item.productId] || 'Deleted product', unitsSold: 0, revenue: 0, profit: 0, returned: 0,
        }
        productStats[item.productId].unitsSold += soldQty
        productStats[item.productId].returned += returnedQty
        productStats[item.productId].revenue += Number(item.price || 0) * soldQty
        productStats[item.productId].profit += (Number(item.price || 0) - (costById[item.productId] || 0)) * soldQty
      }

      if (o.user) {
        customerStats[o.user.id] = customerStats[o.user.id] || {
          userId: o.user.id, name: o.user.name, email: o.user.email, orders: 0, spent: 0,
        }
        customerStats[o.user.id].orders += 1
        customerStats[o.user.id].spent += Number(o.totalAmount || 0)
      }
    }

    const last14 = []
    const today = new Date()
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      last14.push(daily[d] || { date: d, orders: 0, revenue: 0 })
    }

    const topProducts = Object.values(productStats).sort((a, b) => b.revenue - a.revenue).slice(0, 8)
    const topCustomers = Object.values(customerStats).sort((a, b) => b.spent - a.spent).slice(0, 8)

    const profit = revenue - cost

    // Refund / return statistics
    const refundAgg = await Order.findAll({
      where: { refundStatus: { [Op.in]: ['processing', 'refunded'] } },
      attributes: ['refundAmount', 'refundStatus'],
    })
    const refundedAmount = refundAgg.reduce((s, o) => s + Number(o.refundAmount || 0), 0)
    const refundedCount = refundAgg.length
    const returnRequests = await ReturnRequest.findAll({ attributes: ['status'] })
    const returnCount = returnRequests.length
    const openReturns = returnRequests.filter((r) => r.status === 'requested').length

    const summary = {
      revenue: Math.round(revenue * 100) / 100,
      profit: Math.round(profit * 100) / 100,
      cost: Math.round(cost * 100) / 100,
      orders: orders.length,
      itemsSold,
      averageOrderValue: orders.length ? Math.round((revenue / orders.length) * 100) / 100 : 0,
      customers: Object.keys(customerStats).length,
      refundedAmount: Math.round(refundedAmount * 100) / 100,
      refundCount: refundedCount,
      netRevenue: Math.round((revenue - refundedAmount) * 100) / 100,
      returnCount,
      openReturns,
    }

    res.json({ summary, dailySales: last14, topProducts, topCustomers })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// GET /api/admin/activity
router.get('/activity', async (req, res) => {
  try {
    const logs = await ActivityLog.findAll({ order: [['createdAt', 'DESC']], limit: 200 })
    res.json({ logs })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// GET /api/admin/reviews
router.get('/reviews', async (req, res) => {
  try {
    const { status } = req.query
    const where = {}
    if (status === 'pending') where.isApproved = false
    else if (status === 'approved') where.isApproved = true

    const reviews = await Review.findAll({
      where,
      include: [
        { model: Product, as: 'product', attributes: ['id', 'name', 'image'] },
        { model: User, as: 'user', attributes: ['id', 'name', 'email'] },
      ],
      order: [['createdAt', 'DESC']],
    })
    res.json({ reviews: reviews.map((r) => ({ ...r.toJSON(), images: JSON.parse(r.images || '[]') })) })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// PATCH /api/admin/reviews/:id
router.patch('/reviews/:id', async (req, res) => {
  try {
    const { isApproved } = req.body
    const review = await Review.findByPk(req.params.id)
    if (!review) return res.status(404).json({ message: 'Review not found.' })

    await review.update({ isApproved: !!isApproved })
    await logActivity(req.user, 'review_moderation', 'review', review.id, { isApproved: !!isApproved })
    res.json({ message: 'Review updated.', review })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// DELETE /api/admin/reviews/:id
router.delete('/reviews/:id', async (req, res) => {
  try {
    const review = await Review.findByPk(req.params.id)
    if (!review) return res.status(404).json({ message: 'Review not found.' })

    await review.destroy()
    await logActivity(req.user, 'review_delete', 'review', review.id, {})
    res.json({ message: 'Review deleted.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// GET /api/admin/settings
router.get('/settings', async (req, res) => {
  try {
    const settings = await getSettings()
    res.json({ settings })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// PUT /api/admin/settings
router.put('/settings', async (req, res) => {
  try {
    const allowedKeys = Object.keys(DEFAULT_SETTINGS)
    for (const key of allowedKeys) {
      if (req.body[key] === undefined) continue
      const value = String(req.body[key])
      const [row] = await Setting.findOrCreate({ where: { key }, defaults: { key, value } })
      await row.update({ value })
    }
    await logActivity(req.user, 'settings_update', 'settings', null, { keys: Object.keys(req.body).filter((k) => allowedKeys.includes(k)) })
    res.json({ message: 'Settings saved.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// GET /api/admin/settings/loyalty
router.get('/settings/loyalty', async (req, res) => {
  try {
    res.json({ loyalty: await getLoyaltyConfig() })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// PUT /api/admin/settings/loyalty
router.put('/settings/loyalty', async (req, res) => {
  try {
    const current = await getLoyaltyConfig()
    const merged = Object.assign({}, current, req.body)
    await setJSON('loyaltyConfig', merged)
    await logActivity(req.user, 'loyalty_config', 'settings', null, { loyalty: merged })
    res.json({ message: 'Loyalty configuration saved.', loyalty: merged })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// ------------------------- COUPONS -------------------------

const couponFrom = (body) => {
  const data = {}
  if (body.code !== undefined) data.code = String(body.code).trim().toUpperCase()
  if (body.title !== undefined) data.title = body.title
  if (body.description !== undefined) data.description = body.description || null
  if (body.discountType !== undefined) {
    if (!['percent', 'fixed'].includes(body.discountType)) throw new Error('discountType must be percent or fixed.')
    data.discountType = body.discountType
  }
  if (body.discountValue !== undefined) data.discountValue = Number(body.discountValue) || 0
  if (body.minOrderAmount !== undefined) data.minOrderAmount = Number(body.minOrderAmount) || 0
  if (body.maxDiscount !== undefined) data.maxDiscount = body.maxDiscount === '' ? null : Number(body.maxDiscount)
  if (body.usageLimit !== undefined) data.usageLimit = body.usageLimit === '' ? null : Number(body.usageLimit) || 0
  if (body.validFrom !== undefined) data.validFrom = body.validFrom ? new Date(body.validFrom) : null
  if (body.validUntil !== undefined) data.validUntil = body.validUntil ? new Date(body.validUntil) : null
  if (body.isActive !== undefined) data.isActive = !!body.isActive
  if (body.isFeatured !== undefined) data.isFeatured = !!body.isFeatured
  return data
}

// GET /api/admin/coupons
router.get('/coupons', async (req, res) => {
  try {
    const coupons = await Coupon.findAll({
      include: [{ model: CouponUsage, as: 'usages', attributes: [] }],
      attributes: { include: [[Sequelize.fn('COUNT', Sequelize.col('usages.id')), 'actualUsage']] },
      group: ['Coupon.id'],
      order: [['createdAt', 'DESC']],
    })
    res.json({ coupons: coupons.map((c) => ({ ...c.toJSON(), usedCount: Number(c.get('actualUsage')) })) })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// POST /api/admin/coupons
router.post('/coupons', async (req, res) => {
  try {
    const data = couponFrom(req.body)
    if (!data.code || !data.title || data.discountValue === undefined) {
      return res.status(400).json({ message: 'Code, title and discount value are required.' })
    }
    const coupon = await Coupon.create(data)
    await logActivity(req.user, 'coupon_create', 'coupon', coupon.id, { code: coupon.code })
    res.status(201).json({ message: 'Coupon created.', coupon })
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ message: 'Coupon code already exists.' })
    }
    res.status(500).json({ message: err.message, error: err.message })
  }
})

// PATCH /api/admin/coupons/:id
router.patch('/coupons/:id', async (req, res) => {
  try {
    const coupon = await Coupon.findByPk(req.params.id)
    if (!coupon) return res.status(404).json({ message: 'Coupon not found.' })
    await coupon.update(couponFrom(req.body))
    await logActivity(req.user, 'coupon_update', 'coupon', coupon.id, { code: coupon.code })
    res.json({ message: 'Coupon updated.', coupon })
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ message: 'Coupon code already exists.' })
    }
    res.status(500).json({ message: err.message, error: err.message })
  }
})

// DELETE /api/admin/coupons/:id
router.delete('/coupons/:id', async (req, res) => {
  try {
    const coupon = await Coupon.findByPk(req.params.id)
    if (!coupon) return res.status(404).json({ message: 'Coupon not found.' })
    await coupon.destroy()
    await logActivity(req.user, 'coupon_delete', 'coupon', coupon.id, { code: coupon.code })
    res.json({ message: 'Coupon deleted.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// ------------------------- RETURNS -------------------------

// GET /api/admin/returns
router.get('/returns', async (req, res) => {
  try {
    const returns = await ReturnRequest.findAll({
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'email'] },
        {
          model: Order,
          as: 'order',
          attributes: ['id', 'totalAmount', 'status', 'createdAt', 'refundStatus', 'refundAmount'],
          include: [{ model: OrderItem, as: 'items', include: [{ model: Product, as: 'product', attributes: ['id', 'name', 'image', 'images'] }] }],
        },
      ],
      order: [['createdAt', 'DESC']],
    })
    const mapped = returns.map((r) => {
      const json = r.toJSON()
      const raw = JSON.parse(r.items || '[]')
      const orderItems = (json.order?.items || [])
      const items = raw.map((it) => {
        const oi = orderItems.find((x) => String(x.id) === String(it.orderItemId))
        return {
          ...it,
          product: oi?.product || null,
          refundStatus: oi?.refundStatus || 'none',
          returnedQuantity: Number(oi?.returnedQuantity || 0),
          refundedAt: oi?.refundedAt || null,
        }
      })
      return { ...json, items, photos: JSON.parse(r.photos || '[]') }
    })
    res.json({ returns: mapped })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// PATCH /api/admin/returns/:id
router.patch('/returns/:id', async (req, res) => {
  try {
    const { status, adminNote, refundAmount } = req.body
    if (!['requested', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status.' })
    }

    const request = await ReturnRequest.findByPk(req.params.id)
    if (!request) return res.status(404).json({ message: 'Return request not found.' })

    const changes = { status }
    if (adminNote !== undefined) changes.adminNote = adminNote || null
    if (status !== 'requested') changes.resolvedAt = new Date()

    const order = await Order.findByPk(request.orderId, {
      include: [{ model: OrderItem, as: 'items' }],
    })

    let packed = []
    try { packed = JSON.parse(request.items || '[]') } catch {}
    const computedRefund = packed.reduce((s, it) => s + Number(it.price || 0) * Number(it.quantity || 1), 0)

    if (status === 'approved') {
      // Per-item: mark the returned order items as returned. Refund enters
      // 'processing' — the refund is completed later via the order refund panel,
      // giving the customer a visible Requested → Processing → Completed flow.
      const orderItemIds = packed.map((it) => String(it.orderItemId))
      const orderItems = (order?.items || []).filter((it) => orderItemIds.includes(String(it.id)))
      for (const item of orderItems) {
        const packedItem = packed.find((p) => String(p.orderItemId) === String(item.id))
        const qty = packedItem ? Number(packedItem.quantity || item.quantity) : item.quantity
        await item.update({ returnedQuantity: qty, refundStatus: 'processing', refundedAt: null })
      }

      const refundForThis = refundAmount !== undefined && refundAmount !== '' ? Number(refundAmount) : computedRefund
      if (refundForThis < 0) return res.status(400).json({ message: 'Refund amount cannot be negative.' })
      changes.refundAmount = refundForThis

      if (order) {
        const allReturned = (order.items || []).length > 0 &&
          (order.items || []).every((it) => Number(it.returnedQuantity || 0) >= Number(it.quantity))

        await order.update({
          refundStatus: 'processing',
          refundAmount: Math.round((Number(order.refundAmount || 0) + refundForThis) * 100) / 100,
          refundNote: adminNote || order.refundNote,
        })

        if (allReturned) {
          await order.update({ status: 'returned' })
          await OrderTracking.create({ orderId: order.id, status: 'returned', note: 'All items returned. Refund processing started.' })
        } else {
          await OrderTracking.create({ orderId: order.id, status: order.status, note: 'Return approved (partial) — refund processing started.' })
        }

        // Reverse reward points proportional to the returned portion
        const user = await User.findByPk(order.userId)
        if (user && Number(order.pointsEarned || 0) > 0 && Number(order.totalAmount || 0) > 0) {
          const fraction = Math.min(1, refundForThis / Number(order.totalAmount))
          const pointsToReverse = Math.round(Number(order.pointsEarned) * fraction)
          if (pointsToReverse > 0) {
            await debitPoints(user, pointsToReverse, 'ADJUST', order.id, `Points reversed for returned items on order ${order.id}`)
          }
        }
      }
      await logActivity(req.user, 'return_approved', 'return', request.id, { refund: refundForThis, items: orderItemIds })
    } else if (status === 'rejected') {
      // Per-item: mark the returned items as rejected so the customer sees it
      // on the specific product.
      const orderItemIds = packed.map((it) => String(it.orderItemId))
      const orderItems = (order?.items || []).filter((it) => orderItemIds.includes(String(it.id)))
      for (const item of orderItems) {
        if (Number(item.returnedQuantity || 0) > 0) continue
        await item.update({ refundStatus: 'rejected' })
      }
      if (order) {
        const stillPending = await ReturnRequest.count({
          where: { orderId: order.id, status: { [Op.in]: ['requested', 'approved'] } },
        })
        if (stillPending === 0) await order.update({ refundStatus: 'none' })
      }
      await logActivity(req.user, 'return_rejected', 'return', request.id, { adminNote: adminNote || null })
    }

    await request.update(changes)

    res.json({ message: 'Return request updated.', request: { ...request.toJSON(), items: packed } })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// ------------------------- USER POINTS -------------------------

// PATCH /api/admin/users/:id/points
router.patch('/users/:id/points', async (req, res) => {
  try {
    const { points, reason, description } = req.body
    const delta = Number(points)
    if (!Number.isInteger(delta) || delta === 0) {
      return res.status(400).json({ message: 'Points must be a non-zero integer.' })
    }

    const user = await safeFindUser(req.params.id)
    if (!user) return res.status(404).json({ message: 'User not found.' })

    const note = description || `Manual adjustment by admin`
    if (delta > 0) {
      await creditPoints(user, delta, reason === 'BONUS' ? 'BONUS' : 'ADJUST', null, note)
    } else {
      await debitPoints(user, Math.abs(delta), 'ADJUST', null, note)
    }

    await logActivity(req.user, 'points_adjust', 'user', user.id, { points: delta, reason, description })

    const fresh = await User.findByPk(user.id)
    const tier = await tierForPoints(fresh.pointsEarnedCumulative)
    const cashbackPercent = await cashbackPercentFor(tier)
    res.json({
      message: 'Points adjusted.',
      user: {
        id: fresh.id,
        name: fresh.name,
        email: fresh.email,
        pointsBalance: fresh.pointsBalance,
        pointsEarnedCumulative: fresh.pointsEarnedCumulative,
        membershipTier: tier,
        cashbackPercent,
      },
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// GET /api/admin/users/:id/points-log
router.get('/users/:id/points-log', async (req, res) => {
  try {
    const log = await LoyaltyTransaction.findAll({
      where: { userId: req.params.id },
      order: [['createdAt', 'DESC']],
      limit: 50,
    })
    res.json({ log })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// ------------------------- BANNERS & PROMOTIONS -------------------------

const bannerFrom = (body) => {
  const data = {}
  if (body.title !== undefined) data.title = String(body.title).trim()
  if (body.subtitle !== undefined) data.subtitle = body.subtitle || null
  if (body.cta !== undefined) data.cta = String(body.cta).trim() || 'Shop Now'
  if (body.link !== undefined) data.link = String(body.link).trim() || '/products'
  if (body.image !== undefined) data.image = body.image || null
  if (body.bg !== undefined) data.bg = String(body.bg).trim() || 'linear-gradient(120deg, #1B2A4A, #2C3E6B)'
  if (body.text !== undefined) data.text = String(body.text).trim() || '#fff'
  if (body.position !== undefined) data.position = body.position || 'home'
  if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder) || 0
  if (body.isActive !== undefined) data.isActive = !!body.isActive
  return data
}

// GET /api/admin/banners
router.get('/banners', async (req, res) => {
  try {
    const banners = await Banner.findAll({ order: [['sortOrder', 'ASC'], ['createdAt', 'DESC']] })
    res.json({ banners })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// POST /api/admin/banners
router.post('/banners', async (req, res) => {
  try {
    const data = bannerFrom(req.body)
    if (!data.title) return res.status(400).json({ message: 'Banner title is required.' })
    const banner = await Banner.create(data)
    await logActivity(req.user, 'banner_create', 'banner', banner.id, { title: banner.title })
    res.status(201).json({ message: 'Banner created.', banner })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// PUT /api/admin/banners/:id
router.put('/banners/:id', async (req, res) => {
  try {
    const banner = await Banner.findByPk(req.params.id)
    if (!banner) return res.status(404).json({ message: 'Banner not found.' })
    await banner.update(bannerFrom(req.body))
    await logActivity(req.user, 'banner_update', 'banner', banner.id, { title: banner.title })
    res.json({ message: 'Banner updated.', banner })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// DELETE /api/admin/banners/:id
router.delete('/banners/:id', async (req, res) => {
  try {
    const banner = await Banner.findByPk(req.params.id)
    if (!banner) return res.status(404).json({ message: 'Banner not found.' })
    await banner.destroy()
    await logActivity(req.user, 'banner_delete', 'banner', banner.id, { title: banner.title })
    res.json({ message: 'Banner deleted.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// ------------------------- DEMO DATA -------------------------

// POST /api/admin/reset-data — wipe all transactional data (orders, returns, reviews,
// loyalty, customer accounts) and restore product stock, so the portal can be re-seeded
// or rebuilt from scratch. Admin, catalog, coupons and settings are kept.
router.post('/reset-data', async (req, res) => {
  try {
    const { resetTransactions } = require('../utils/resetData')
    const result = await resetTransactions()
    await logActivity(req.user, 'data_reset', 'settings', null, result)
    res.json({
      message: `Reset complete: ${result.orders || 0} orders, ${result.returnRequests || 0} returns, ${result.reviews || 0} reviews, ${result.customers || 0} customer accounts removed.`,
      ...result,
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// POST /api/admin/demo-data — generate realistic sample orders/reviews for reports
router.post('/demo-data', async (req, res) => {
  try {
    const { force } = req.body || {}
    const result = await seedDemoData({ force: !!force })
    await logActivity(req.user, 'demo_data', 'settings', null, { force: !!force })
    res.json({ message: result.seeded ? `Demo data generated: ${result.orders} orders, ${result.reviews} reviews.` : result.message, ...result })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

module.exports = router