const { Op } = require('sequelize')
const bcrypt = require('bcryptjs')
const {
  User, Order, OrderItem, Review, Setting, Coupon, UserAddress, PaymentMethod, LoyaltyTransaction,
} = require('../models')
const { DEFAULT_SETTINGS } = require('./settings')

const demoCustomers = [
  { email: 'customer@test.com', name: 'Test Customer' },
  { email: 'priya.sharma@example.com', name: 'Priya Sharma' },
  { email: 'rahul.verma@example.com', name: 'Rahul Verma' },
]

const demoOrders = [
  { email: 'customer@test.com', dayOffset: 13, status: 'delivered', paymentMethod: 'Razorpay', paymentId: 'pay_NsX2QkLP1V7w', items: [[0, 1], [1, 1]] },
  { email: 'priya.sharma@example.com', dayOffset: 12, status: 'delivered', paymentMethod: 'COD', items: [[2, 1]] },
  { email: 'rahul.verma@example.com', dayOffset: 11, status: 'delivered', paymentMethod: 'Razorpay', paymentId: 'pay_KdV8SrMB4T0y', items: [[3, 2]] },
  { email: 'customer@test.com', dayOffset: 10, status: 'delivered', paymentMethod: 'COD', items: [[4, 1], [5, 1]] },
  { email: 'priya.sharma@example.com', dayOffset: 9, status: 'delivered', paymentMethod: 'Razorpay', paymentId: 'pay_Mfw3TnHQ2A9x', items: [[0, 1]] },
  { email: 'rahul.verma@example.com', dayOffset: 8, status: 'delivered', paymentMethod: 'COD', items: [[1, 2]] },
  { email: 'customer@test.com', dayOffset: 7, status: 'delivered', paymentMethod: 'Razorpay', paymentId: 'pay_Qw58UbKM6R3p', items: [[2, 1], [3, 1]] },
  { email: 'rahul.verma@example.com', dayOffset: 6, status: 'cancelled', paymentMethod: 'Razorpay', paymentId: 'pay_Cancelled001', items: [[2, 1]] },
  { email: 'priya.sharma@example.com', dayOffset: 5, status: 'shipped', paymentMethod: 'Razorpay', paymentId: 'pay_Zn70RePL3C2d', items: [[5, 1]] },
  { email: 'rahul.verma@example.com', dayOffset: 4, status: 'shipped', paymentMethod: 'COD', items: [[4, 2], [1, 1]] },
  { email: 'customer@test.com', dayOffset: 2, status: 'processing', paymentMethod: 'Razorpay', paymentId: 'pay_Hj41XcVN8K6f', items: [[0, 1]] },
  { email: 'priya.sharma@example.com', dayOffset: 1, status: 'pending', paymentMethod: 'COD', items: [[3, 3]] },
]

const demoReviews = [
  { email: 'customer@test.com', productIndex: 0, rating: 5, title: 'Amazing sound quality', comment: 'Battery easily lasts a week. Noise cancellation works great on flights.' },
  { email: 'customer@test.com', productIndex: 1, rating: 4, title: 'Slim and classy', comment: 'Great fit in any pocket. RFID pocket is a nice touch.' },
  { email: 'customer@test.com', productIndex: 5, rating: 5, title: 'Loud and portable', comment: 'Took it to the beach, survived sand and water. Impressive bass.' },
  { email: 'priya.sharma@example.com', productIndex: 2, rating: 4, title: 'Solid fitness tracker', comment: 'Heart rate and sleep tracking are accurate. Screen could be brighter.' },
  { email: 'priya.sharma@example.com', productIndex: 0, rating: 5, title: 'Best purchase this year', comment: 'Calls are crystal clear thanks to the mic. Super comfortable for long wear.' },
  { email: 'rahul.verma@example.com', productIndex: 3, rating: 4, title: 'Soft fabric', comment: 'Very breathable and the fit is true to size. Wash held up well.' },
  { email: 'rahul.verma@example.com', productIndex: 1, rating: 5, title: 'Worth every rupee', comment: 'Stitching looks premium. Bought a second one as a gift.' },
  { email: 'rahul.verma@example.com', productIndex: 4, rating: 4, title: 'Keeps water cold for a day', comment: 'Lid is leak-proof, perfect for office and gym.' },
]

const daysAgo = (n) => {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000)
  d.setHours(11, 30, 0, 0)
  return d
}

function getActiveProducts() {
  // Lazy require to avoid circular dependency issues with models/index
  return require('../models').Product.findAll({ where: { isActive: true } }).then((ps) => ps)
}

async function seedDemoData({ force = false } = {}) {
  const { Product } = require('../models')
  const marker = await Setting.findOne({ where: { key: 'demo_seeded' } })
  if (!force && marker && marker.value === '1') {
    return { seeded: false, message: 'Demo data already exists. Use force to re-generate.' }
  }

  const hashedPassword = await bcrypt.hash('Pass@123', 10)
  const users = {}
  for (const c of demoCustomers) {
    let user = await User.findOne({ where: { email: c.email } })
    if (!user) {
      user = await User.create({
        name: c.name,
        email: c.email,
        password: hashedPassword,
        role: 'user',
        isVerified: true,
      })
    }
    users[c.email] = user
  }

  const allProducts = await getActiveProducts()
  if (allProducts.length === 0) {
    return { seeded: false, message: 'No active products in catalog to attach sample orders to.' }
  }
  const byIndex = (i) => allProducts[i % allProducts.length]

  let orderNos = 0
  const soldByProduct = {}
  for (const o of demoOrders) {
    const user = users[o.email]
    const subtotal = o.items.reduce((s, [pi, q]) => s + Number(byIndex(pi).price) * q, 0)
    const freeShippingAbove = Number(DEFAULT_SETTINGS.freeShippingAbove || 4000)
    const shipping = subtotal >= freeShippingAbove ? 0 : Number(DEFAULT_SETTINGS.shippingFee || 80)
    const total = Math.round((subtotal + shipping) * 100) / 100
    const createdAt = daysAgo(o.dayOffset)

    const order = await Order.create({
      userId: user.id,
      totalAmount: total,
      status: o.status,
      shippingAddress: `${user.name}, ${o.dayOffset > 7 ? 'Sector 14, Dwarka, New Delhi' : 'MG Road, Bengaluru, Karnataka'}${o.dayOffset > 7 ? ' - 110078' : ' - 560001'}`,
      paymentMethod: o.paymentMethod,
      paymentId: o.paymentId || null,
      refundStatus: 'none',
      createdAt,
      updatedAt: createdAt,
    })

    for (const [pi, q] of o.items) {
      const p = byIndex(pi)
      await OrderItem.create({ orderId: order.id, productId: p.id, quantity: q, price: p.price })
      if (o.status !== 'cancelled') {
        soldByProduct[p.id] = (soldByProduct[p.id] || 0) + q
      }
    }
    orderNos += 1
  }

  for (const [pid, qty] of Object.entries(soldByProduct)) {
    const p = await Product.findByPk(pid)
    if (p) await p.update({ stock: Math.max(0, p.stock - qty) })
  }

  let reviewNos = 0
  for (const r of demoReviews) {
    const user = users[r.email]
    try {
      await Review.create({
        productId: byIndex(r.productIndex).id,
        userId: user.id,
        rating: r.rating,
        title: r.title,
        comment: r.comment,
        isApproved: true,
      })
      reviewNos += 1
    } catch (e) {
      if (!e.name || e.name !== 'SequelizeUniqueConstraintError') throw e
    }
  }

  await Setting.upsert({ key: 'demo_seeded', value: '1' })
  return { seeded: true, orders: orderNos, reviews: reviewNos }
}

module.exports = { seedDemoData, demoCustomers }