const { Op } = require('sequelize')
const {
  User, Product, Order, OrderItem, OrderTracking, Review, LoginHistory, ActivityLog, Setting,
  Wishlist, UserAddress, PaymentMethod, LoyaltyTransaction, ReturnRequest, CouponUsage, Cart,
} = require('../models')

/**
 * Wipe all transactional data so the portal can be rebuilt from scratch.
 * Keeps: admin account, product catalog/coupons/settings (and their stock,
 * which is restored to pre-sale levels).
 *
 * Deletes: orders, order items, tracking, returns, customer reviews, carts,
 * wishlists, loyalty/points, coupon usages, login history, addresses, payment
 * methods, and every customer (non-admin) account.
 */
async function resetTransactions() {
  const result = {}

  // 1. Restore product stock before deleting order history (mirrors the
  //    deduction made at checkout and during demo seeding).
  const items = await OrderItem.findAll({ include: [{ model: Order, attributes: ['status'] }] })
  const soldByProduct = {}
  for (const it of items) {
    if (it.Order && it.Order.status !== 'cancelled') {
      soldByProduct[it.productId] = (soldByProduct[it.productId] || 0) + Number(it.quantity)
    }
  }
  const soldIds = Object.keys(soldByProduct)
  if (soldIds.length > 0) {
    const products = await Product.findAll({ where: { id: { [Op.in]: soldIds } } })
    for (const p of products) {
      await p.update({ stock: Math.max(0, Number(p.stock || 0) + soldByProduct[p.id]) })
    }
    result.stockRestored = soldIds.length
  }

  // 2. Delete child/dependent transactional records first.
  result.returnRequests = await ReturnRequest.destroy({ where: {} })
  result.tracking = await OrderTracking.destroy({ where: {} })
  result.orderItems = await OrderItem.destroy({ where: {} })
  result.reviews = await Review.destroy({ where: {} })
  result.loyaltyTransactions = await LoyaltyTransaction.destroy({ where: {} })
  result.couponUsages = await CouponUsage.destroy({ where: {} })
  result.carts = await Cart.destroy({ where: {} })
  result.wishlists = await Wishlist.destroy({ where: {} })

  // 3. Orders now have no dependencies left.
  result.orders = await Order.destroy({ where: {} })

  // 4. Remove every customer account and their personal records. The admin
  //    account (role 'admin') is kept.
  const customers = await User.findAll({ where: { role: 'user' } })
  const ids = customers.map((u) => u.id)
  if (ids.length > 0) {
    result.loginHistory = await LoginHistory.destroy({ where: { userId: { [Op.in]: ids } } })
    result.userAddresses = await UserAddress.destroy({ where: { userId: { [Op.in]: ids } } })
    result.paymentMethods = await PaymentMethod.destroy({ where: { userId: { [Op.in]: ids } } })
    result.customers = await User.destroy({ where: { id: { [Op.in]: ids } } })
  }

  // 5. Reset seed markers so "Generate demo data" can re-create fresh samples,
  //    and clear stale admin activity log for the demo work.
  await Setting.destroy({ where: { key: { [Op.in]: ['demo_seeded', 'upgrade_seeded'] } } })
  result.settingsReset = ['demo_seeded', 'upgrade_seeded']

  return result
}

module.exports = { resetTransactions }