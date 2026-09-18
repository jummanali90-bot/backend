const { Sequelize } = require('sequelize')
const path = require('path')

const databaseURL = process.env.DATABASE_URL

const sequelize = databaseURL
  ? new Sequelize(databaseURL, {
      dialectOptions: {
        ssl: { require: true, rejectUnauthorized: false },
      },
      logging: false,
    })
  : new Sequelize({
      dialect: 'sqlite',
      storage: path.join(__dirname, '..', 'database.sqlite'),
      logging: false,
    })

module.exports = sequelize
