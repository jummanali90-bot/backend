const { Sequelize } = require('sequelize')
const path = require('path')
const pgParse = require('pg-connection-string').parse

const rawURL = (process.env.DATABASE_URL || '').trim().replace(/^"|"$/g, '')
const databaseURL = rawURL.replace(/^'|'$/g, '')

if (process.env.NODE_ENV === 'production' && !databaseURL) {
  throw new Error('FATAL: DATABASE_URL is required in production. Set it in your hosting platform environment (Render: minjumart-api > Environment > DATABASE_URL).')
}

const sequelize = databaseURL
  ? (() => {
      const c = pgParse(databaseURL)
      return new Sequelize(c.database, c.user, c.password, {
        host: c.host,
        port: c.port || 5432,
        dialect: 'postgres',
        dialectOptions: {
          ssl: { require: true, rejectUnauthorized: false },
          ...(c.ssl && typeof c.ssl === 'object' ? {} : {}),
        },
        logging: false,
      })
    })()
  : new Sequelize({
      dialect: 'sqlite',
      storage: path.join(__dirname, '..', 'database.sqlite'),
      logging: false,
    })

module.exports = sequelize