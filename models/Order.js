const { DataTypes } = require('sequelize')
const sequelize = require('../config/database')

const Order = sequelize.define('Order', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  totalAmount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },
  subtotal: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
  },
  shippingAmount: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
  },
  couponCode: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  couponDiscount: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
  },
  pointsRedeemed: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  pointsEarned: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  pointsReturned: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  status: {
    type: DataTypes.ENUM('pending', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'returned', 'cancelled'),
    defaultValue: 'pending',
  },
  shippingAddress: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  paymentMethod: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  paymentId: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  refundStatus: {
    type: DataTypes.ENUM('none', 'requested', 'processing', 'refunded', 'rejected'),
    defaultValue: 'none',
  },
  refundAmount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
  },
  refundNote: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  timestamps: true,
})

module.exports = Order
