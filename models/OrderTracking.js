const { DataTypes } = require('sequelize')
const sequelize = require('../config/database')

const OrderTracking = sequelize.define('OrderTracking', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  orderId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('pending', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'returned', 'cancelled'),
    allowNull: false,
  },
  note: {
    type: DataTypes.STRING,
    allowNull: true,
  },
}, {
  timestamps: true,
})

module.exports = OrderTracking