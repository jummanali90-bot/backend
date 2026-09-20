const { DataTypes } = require('sequelize')
const sequelize = require('../config/database')

const Product = sequelize.define('Product', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },
  category: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  image: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  images: {
    type: DataTypes.TEXT,
    allowNull: true,
    defaultValue: '[]',
  },
  brand: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  subCategory: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  mrp: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
  },
  costPrice: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
  },
  sku: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  weight: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  dimensions: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  color: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  size: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  material: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  highlights: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  warrantyInfo: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  stock: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  lowStockThreshold: {
    type: DataTypes.INTEGER,
    defaultValue: 5,
  },
  featured: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
}, {
  timestamps: true,
})

module.exports = Product
