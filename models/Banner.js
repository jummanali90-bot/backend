const { DataTypes } = require('sequelize')
const sequelize = require('../config/database')

const Banner = sequelize.define('Banner', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  subtitle: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  cta: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'Shop Now',
  },
  link: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: '/products',
  },
  image: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  bg: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'linear-gradient(120deg, #1B2A4A, #2C3E6B)',
  },
  text: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: '#fff',
  },
  position: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'home',
  },
  sortOrder: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
}, {
  timestamps: true,
})

module.exports = Banner