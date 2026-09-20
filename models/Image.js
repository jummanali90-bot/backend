const { DataTypes } = require('sequelize')
const sequelize = require('../config/database')

const Image = sequelize.define('Image', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  mimeType: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  fileName: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  size: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  bytes: {
    type: DataTypes.BLOB,
    allowNull: false,
  },
  productId: {
    type: DataTypes.UUID,
    allowNull: true,
  },
}, {
  timestamps: true,
})

module.exports = Image