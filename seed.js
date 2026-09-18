const bcrypt = require('bcryptjs')
const sequelize = require('./config/database')
const { Op } = require('sequelize')
const {
  User, Product, Order, OrderItem, Review, Setting,
  Coupon, CouponUsage, Wishlist, UserAddress, PaymentMethod, LoyaltyTransaction,
} = require('./models')
const { DEFAULT_SETTINGS, DEFAULT_LOYALTY, setJSON, getJSON } = require('./utils/settings')

const products = [
  {
    name: 'Premium Wireless Headphones',
    description: 'High-quality noise-cancelling headphones with 40hr battery life. Over-ear design with plush memory-foam cushions and a built-in mic for crystal-clear calls.',
    price: 2499.00,
    costPrice: 1750.00,
    category: 'Electronics',
    brand: 'MinjuAudio',
    stock: 25,
    lowStockThreshold: 8,
    featured: true,
    isActive: true,
  },
  {
    name: 'Classic Leather Wallet',
    description: 'Genuine leather bifold wallet with RFID protection. 8 card slots, 2 hidden pockets, and a slim profile that fits any pocket.',
    price: 899.00,
    costPrice: 520.00,
    category: 'Accessories',
    brand: 'MinjuLux',
    stock: 50,
    lowStockThreshold: 10,
    isActive: true,
  },
  {
    name: 'Smart Fitness Watch',
    description: 'Track your workouts, heart rate, and sleep with style. IP68 water resistance, 10-day battery, and smart notifications for calls and messages.',
    price: 3499.00,
    costPrice: 2400.00,
    category: 'Electronics',
    brand: 'MinjuFit',
    stock: 15,
    lowStockThreshold: 6,
    featured: true,
    isActive: true,
  },
  {
    name: 'Organic Cotton T-Shirt',
    description: 'Soft, breathable, and sustainably sourced everyday wear. Pre-shrunk 100% organic cotton with reinforced stitching.',
    price: 599.00,
    costPrice: 310.00,
    category: 'Fashion',
    brand: 'MinjuWear',
    stock: 100,
    lowStockThreshold: 20,
    isActive: true,
  },
  {
    name: 'Stainless Steel Water Bottle',
    description: 'Double-wall insulated, keeps drinks cold for 24hrs and hot for 12hrs. BPA-free, leak-proof lid with 750ml capacity.',
    price: 749.00,
    costPrice: 400.00,
    category: 'Lifestyle',
    brand: 'MinjuLiving',
    stock: 60,
    lowStockThreshold: 15,
    isActive: true,
  },
  {
    name: 'Portable Bluetooth Speaker',
    description: 'Compact waterproof speaker with 360-degree sound and 20-hour playtime. Pairs in seconds and survives splashes, rain and sand.',
    price: 1999.00,
    costPrice: 1300.00,
    category: 'Electronics',
    brand: 'MinjuAudio',
    stock: 30,
    lowStockThreshold: 8,
    isActive: true,
  },
]

// Demo catalog for Analytics/Reports: { email, name, dayOffset, status, items: [[productIndex, qty], ...], payment }
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

const seedBase = async () => {
  const productCount = await Product.count()
  if (productCount === 0) {
    await Product.bulkCreate(products)
    console.log(`Seeded ${products.length} products.`)
  } else {
    console.log(`Database already has ${productCount} products. Skipping.`)
  }

  const admin = await User.findOne({ where: { email: 'admin@minjumart.com' } })
  if (!admin) {
    const hashedPassword = await bcrypt.hash('Admin@123', 10)
    await User.create({
      name: 'Admin',
      email: 'admin@minjumart.com',
      password: hashedPassword,
      role: 'admin',
      isVerified: true,
    })
    console.log('Admin user created: admin@minjumart.com / Admin@123')
  } else {
    console.log('Admin user already exists. Skipping.')
  }
}

const seedDemoData = async () => {
  const marker = await Setting.findOne({ where: { key: 'demo_seeded' } })
  if (marker && marker.value === '1') {
    console.log('Demo orders/reviews already seeded. Skipping.')
    return
  }

  // Clean up earlier ad-hoc test artifacts
  const testProducts = await Product.findAll({ where: { name: { [Op.like]: 'Test%' } } })
  const testIds = testProducts.map((p) => p.id)
  if (testIds.length) {
    await OrderItem.destroy({ where: { productId: { [Op.in]: testIds } } })
    await Product.destroy({ where: { id: { [Op.in]: testIds } } })
    const orphanIds = []
    for (const o of await Order.findAll()) {
      const cnt = await OrderItem.count({ where: { orderId: o.id } })
      if (cnt === 0) orphanIds.push(o.id)
    }
    if (orphanIds.length) await Order.destroy({ where: { id: { [Op.in]: orphanIds } } })
    console.log(`Removed ${testIds.length} ad-hoc test product(s).`)
  }

  // Demo customers
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

  // Demo orders + order items
  const allProducts = await Product.findAll({ where: { isActive: true } })
  const byIndex = (i) => allProducts[i]
  const soldByProduct = {}

  let orderNos = 0
  for (const o of demoOrders) {
    const user = users[o.email]
    const subtotal = o.items.reduce((s, [pi, q]) => s + Number(byIndex(pi).price) * q, 0)
    const freeShippingAbove = Number(DEFAULT_SETTINGS.freeShippingAbove || 4000)
    const shipping = subtotal >= freeShippingAbove ? 0 : Number(DEFAULT_SETTINGS.shippingFee || 0)
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

  // Adjust stock to reflect sales
  for (const [pid, qty] of Object.entries(soldByProduct)) {
    const p = await Product.findByPk(pid)
    if (p) await p.update({ stock: Math.max(0, p.stock - qty) })
  }

  // Reviews for delivered purchases
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

  // Ensure default settings keys exist without clobbering admin-saved values
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const existing = await Setting.findOne({ where: { key } })
    if (!existing) await Setting.create({ key, value })
  }

  await Setting.upsert({ key: 'demo_seeded', value: '1' })
  console.log(`Seeded demo data: ${orderNos} orders, ${reviewNos} reviews, ${Object.keys(soldByProduct).length} products restocked-sold.`)
}

const seedCoupons = [
  {
    code: 'WELCOME50',
    title: 'Welcome Bonus',
    description: 'Flat ₹50 off on your first order above ₹500.',
    discountType: 'fixed',
    discountValue: 50,
    minOrderAmount: 500,
    isActive: true,
    isFeatured: false,
  },
  {
    code: 'SAVE10',
    title: 'Save 10%',
    description: '10% off up to ₹200 on orders above ₹999.',
    discountType: 'percent',
    discountValue: 10,
    minOrderAmount: 999,
    maxDiscount: 200,
    isActive: true,
    isFeatured: true,
  },
  {
    code: 'MINJUMART20',
    title: 'Mega Deal',
    description: '20% off up to ₹300 on orders above ₹2,499.',
    discountType: 'percent',
    discountValue: 20,
    minOrderAmount: 2499,
    maxDiscount: 300,
    isActive: true,
    isFeatured: true,
  },
  {
    code: 'FASHION15',
    title: 'Fashion Fest',
    description: '15% off up to ₹150 on orders above ₹999.',
    discountType: 'percent',
    discountValue: 15,
    minOrderAmount: 999,
    maxDiscount: 150,
    isActive: true,
    isFeatured: false,
  },
]

const demoAddresses = [
  { email: 'customer@test.com', type: 'home', name: 'Test Customer', phone: '+919876543210', line1: 'A-404, Silver Oak Apartments', line2: 'Sector 14', city: 'New Delhi', state: 'Delhi', pincode: '110078' },
  { email: 'priya.sharma@example.com', type: 'home', name: 'Priya Sharma', phone: '+919812345678', line1: 'Flat 21, Green Valley Residency', line2: 'HSR Layout', city: 'Bengaluru', state: 'Karnataka', pincode: '560102' },
  { email: 'rahul.verma@example.com', type: 'work', name: 'Rahul Verma', phone: '+919812345679', line1: 'Office 5B, Tech Tower', line2: 'MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
]

const demoPayments = [
  { email: 'customer@test.com', type: 'card', nickname: 'My Visa', cardNumber: '4242424242424242', cardBrand: 'Visa' },
  { email: 'priya.sharma@example.com', type: 'upi', nickname: 'My UPI', upiId: 'priya@okhdfcbank' },
  { email: 'rahul.verma@example.com', type: 'card', nickname: 'Office Card', cardNumber: '5454545454545454', cardBrand: 'Mastercard' },
]

const seedUpgrade = async () => {
  const marker = await Setting.findOne({ where: { key: 'upgrade_seeded' } })
  if (marker && marker.value === '1') {
    console.log('Account upgrade seed already applied. Skipping.')
    return
  }

  // Loyalty configuration (cashback tiers, redemption rules)
  await setJSON('loyaltyConfig', DEFAULT_LOYALTY)

  // Sample coupons
  let couponCount = 0
  for (const c of seedCoupons) {
    const existing = await Coupon.findOne({ where: { code: c.code } })
    if (!existing) {
      await Coupon.create(c)
      couponCount += 1
    }
  }
  console.log(`Seeded ${couponCount} new coupon(s).`)

  // Demo account data: addresses, payment methods, wishlist, reward points
  let pointsTotal = 0
  for (const d of demoAddresses) {
    const user = await User.findOne({ where: { email: d.email } })
    if (!user) { console.warn(`Skipping addresses for ${d.email} — user not found.`); continue }
    const existingAddress = await UserAddress.findOne({ where: { userId: user.id } })
    if (!existingAddress) {
      await UserAddress.create({
        userId: user.id, type: d.type, name: d.name, phone: d.phone,
        line1: d.line1, line2: d.line2 || null, city: d.city, state: d.state, pincode: d.pincode,
        isDefault: true,
      })
    }
  }

  for (const p of demoPayments) {
    const user = await User.findOne({ where: { email: p.email } })
    if (!user) continue
    const existing = await PaymentMethod.findOne({ where: { userId: user.id } })
    if (!existing) {
      if (p.type === 'card') {
        await PaymentMethod.create({
          userId: user.id, type: 'card', nickname: p.nickname, cardBrand: p.cardBrand,
          last4: p.cardNumber.slice(-4), expMonth: 12, expYear: 2029, isDefault: true,
        })
      } else if (p.type === 'upi') {
        await PaymentMethod.create({ userId: user.id, type: 'upi', nickname: p.nickname, upiId: p.upiId, isDefault: true })
      }
    }
  }

  // Reward points derived from historical non-cancelled spend
  const allUsers = await User.findAll({ where: { role: 'user' } })
  for (const user of allUsers) {
    const orders = await Order.findAll({ where: { userId: user.id, status: { [Op.ne]: 'cancelled' } } })
    const spend = orders.reduce((s, o) => s + Number(o.totalAmount || 0), 0)
    const earned = Math.floor(spend / 100)
    if (earned > 0 && user.pointsEarnedCumulative === 0 && user.pointsBalance === 0) {
      const bonus = user.email === 'customer@test.com' ? 200 : 100
      const current = await user.update({
        pointsBalance: earned + bonus,
        pointsEarnedCumulative: earned,
      })
      await LoyaltyTransaction.create({
        userId: user.id,
        points: bonus,
        reason: 'BONUS',
        description: 'Demo signup bonus',
        balanceAfter: current.pointsBalance,
      })
      await LoyaltyTransaction.create({
        userId: user.id,
        points: earned,
        reason: 'PURCHASE',
        description: 'Reward points from order history',
        balanceAfter: current.pointsBalance,
      })
      pointsTotal += earned + bonus
      console.log(`Rewards seeded for ${user.email}: +${earned} pts (balance ${current.pointsBalance}).`)
    }
  }

  await Setting.upsert({ key: 'upgrade_seeded', value: '1' })
  console.log(`Upgrade seed complete: ${couponCount} coupons, ${pointsTotal} points credited.`)
}

const seed = async () => {
  try {
    await sequelize.authenticate()
    await sequelize.sync({ alter: true })
    await seedBase()
    await seedDemoData()
    await seedUpgrade()
  } catch (err) {
    console.error('Seed failed:', err)
  } finally {
    await sequelize.close()
  }
}

seed()