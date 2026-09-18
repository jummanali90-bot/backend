const { DataTypes } = require('sequelize')
const sequelize = require('../config/database')

const CouponUsage = sequelize.define('CouponUsage', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  couponId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  orderId: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  amountSaved: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
  },
}, {
  timestamps: true,
})

module.exports = CouponUsage