const { DataTypes } = require('sequelize')
const sequelize = require('../config/database')

const LoyaltyTransaction = sequelize.define('LoyaltyTransaction', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  points: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  reason: {
    type: DataTypes.ENUM('PURCHASE', 'REDEEM', 'REFUND', 'BONUS', 'ADJUST'),
    allowNull: false,
  },
  orderId: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  balanceAfter: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
}, {
  timestamps: true,
})

module.exports = LoyaltyTransaction