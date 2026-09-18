const { DataTypes } = require('sequelize')
const sequelize = require('../config/database')

const ReturnRequest = sequelize.define('ReturnRequest', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  orderId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  items: {
    type: DataTypes.TEXT,
    allowNull: false,
    defaultValue: '[]',
  },
  action: {
    type: DataTypes.ENUM('refund', 'return', 'exchange'),
    allowNull: false,
    defaultValue: 'return',
  },
  reason: {
    type: DataTypes.ENUM('damaged', 'wrong_item', 'not_as_described', 'size_fit', 'other'),
    allowNull: false,
  },
  comment: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  photos: {
    type: DataTypes.TEXT,
    allowNull: true,
    defaultValue: '[]',
  },
  status: {
    type: DataTypes.ENUM('requested', 'approved', 'rejected'),
    defaultValue: 'requested',
  },
  adminNote: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  refundAmount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
  },
  resolvedAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  timestamps: true,
})

module.exports = ReturnRequest