const { Sequelize } = require('sequelize')
const path = require('path')

if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  throw new Error('FATAL: DATABASE_URL is required in production. Set it in your hosting platform environment (Render: minjumart-api > Environment > DATABASE_URL).')
}

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
