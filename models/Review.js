const { DataTypes } = require('sequelize')
const sequelize = require('../config/database')

const Review = sequelize.define('Review', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  productId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  rating: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1, max: 5 },
  },
  title: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  comment: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  isApproved: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  images: {
    type: DataTypes.TEXT,
    allowNull: true,
    defaultValue: '[]',
  },
}, {
  timestamps: true,
  indexes: [
    { unique: true, fields: ['productId', 'userId'] },
  ],
})

module.exports = Review