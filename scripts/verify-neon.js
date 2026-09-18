require('dotenv').config()
const { QueryTypes } = require('sequelize')
const s = require('../config/database')

;(async () => {
  await s.authenticate()
  const q = 'SELECT (SELECT COUNT(*) FROM "Products") products, (SELECT COUNT(*) FROM "Users") users, (SELECT COUNT(*) FROM "Orders") orders, (SELECT COUNT(*) FROM "Settings") settings'
  const [r] = await s.query(q, { type: QueryTypes.SELECT })
  console.log('counts:', JSON.stringify(r))
  const u = await s.query('SELECT email, role, "isActive" FROM "Users" ORDER BY email', { type: QueryTypes.SELECT })
  console.log('users:', JSON.stringify(u))
  await s.close()
})().catch((e) => { console.error('ERR', e.message); process.exit(1) })