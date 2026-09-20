const User = require('./User')
const Product = require('./Product')
const Image = require('./Image')
const Cart = require('./Cart')
const Order = require('./Order')
const OrderItem = require('./OrderItem')
const OrderTracking = require('./OrderTracking')
const Review = require('./Review')
const LoginHistory = require('./LoginHistory')
const ActivityLog = require('./ActivityLog')
const Setting = require('./Setting')
const Wishlist = require('./Wishlist')
const UserAddress = require('./UserAddress')
const PaymentMethod = require('./PaymentMethod')
const LoyaltyTransaction = require('./LoyaltyTransaction')
const Coupon = require('./Coupon')
const CouponUsage = require('./CouponUsage')
const ReturnRequest = require('./ReturnRequest')
const Banner = require('./Banner')

User.hasMany(Cart, { foreignKey: 'userId', as: 'cartItems' })
Cart.belongsTo(User, { foreignKey: 'userId' })

User.hasMany(Order, { foreignKey: 'userId', as: 'orders' })
Order.belongsTo(User, { foreignKey: 'userId', as: 'user' })

Order.hasMany(OrderItem, { foreignKey: 'orderId', as: 'items' })
OrderItem.belongsTo(Order, { foreignKey: 'orderId' })

OrderItem.belongsTo(Product, { foreignKey: 'productId', as: 'product' })

Order.hasMany(OrderTracking, { foreignKey: 'orderId', as: 'tracking' })
OrderTracking.belongsTo(Order, { foreignKey: 'orderId' })

Product.hasMany(Review, { foreignKey: 'productId', as: 'reviews' })
Review.belongsTo(Product, { foreignKey: 'productId', as: 'product' })
User.hasMany(Review, { foreignKey: 'userId', as: 'reviews' })
Review.belongsTo(User, { foreignKey: 'userId', as: 'user' })

User.hasMany(LoginHistory, { foreignKey: 'userId', as: 'loginHistory' })
LoginHistory.belongsTo(User, { foreignKey: 'userId' })

User.hasMany(Wishlist, { foreignKey: 'userId', as: 'wishlistItems' })
Wishlist.belongsTo(User, { foreignKey: 'userId' })
Wishlist.belongsTo(Product, { foreignKey: 'productId', as: 'product' })

User.hasMany(UserAddress, { foreignKey: 'userId', as: 'addresses' })
UserAddress.belongsTo(User, { foreignKey: 'userId' })

User.hasMany(PaymentMethod, { foreignKey: 'userId', as: 'paymentMethods' })
PaymentMethod.belongsTo(User, { foreignKey: 'userId' })

User.hasMany(LoyaltyTransaction, { foreignKey: 'userId', as: 'loyaltyTransactions' })
LoyaltyTransaction.belongsTo(User, { foreignKey: 'userId' })
LoyaltyTransaction.belongsTo(Order, { foreignKey: 'orderId', as: 'order' })

Coupon.hasMany(CouponUsage, { foreignKey: 'couponId', as: 'usages' })
CouponUsage.belongsTo(Coupon, { foreignKey: 'couponId', as: 'coupon' })
CouponUsage.belongsTo(User, { foreignKey: 'userId' })
CouponUsage.belongsTo(Order, { foreignKey: 'orderId', as: 'order' })

User.hasMany(ReturnRequest, { foreignKey: 'userId', as: 'returnRequests' })
ReturnRequest.belongsTo(User, { foreignKey: 'userId', as: 'user' })
ReturnRequest.belongsTo(Order, { foreignKey: 'orderId', as: 'order' })

module.exports = {
  User, Product, Cart, Order, OrderItem, OrderTracking, Review, LoginHistory, ActivityLog, Setting,
  Wishlist, UserAddress, PaymentMethod, LoyaltyTransaction, Coupon, CouponUsage, ReturnRequest, Banner,
  Image,
}