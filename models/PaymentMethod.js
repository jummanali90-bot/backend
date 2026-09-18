const { DataTypes } = require('sequelize')
const sequelize = require('../config/database')

const PaymentMethod = sequelize.define('PaymentMethod', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  type: {
    type: DataTypes.ENUM('card', 'upi', 'netbanking'),
    allowNull: false,
  },
  nickname: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  cardBrand: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  last4: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  expMonth: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  expYear: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  upiId: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  bankName: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  isDefault: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
}, {
  timestamps: true,
})

module.exports = PaymentMethod