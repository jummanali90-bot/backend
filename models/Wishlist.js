const { DataTypes } = require('sequelize')
const sequelize = require('../config/database')

const Wishlist = sequelize.define('Wishlist', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  productId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
}, {
  timestamps: true,
  indexes: [
    { unique: true, fields: ['userId', 'productId'] },
  ],
})

module.exports = Wishlist