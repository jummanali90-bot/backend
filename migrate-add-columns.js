const { Sequelize, QueryTypes } = require('sequelize')
const models = require('./models')

const s = new Sequelize({ dialect: 'sqlite', storage: 'database.sqlite', logging: false })

async function tableInfo(table) {
  const rows = await s.query(`PRAGMA table_info("${table}")`, { type: QueryTypes.SELECT })
  return rows.map(r => r.name)
}

async function addColumn(table, opts) {
  const cols = await tableInfo(table)
  if (!cols.includes(opts.name)) {
    await s.query(`ALTER TABLE "${table}" ADD COLUMN ${opts.name} ${opts.ddl}`)
    console.log(`+ column ${table}.${opts.name} added`)
  } else {
    console.log(`= column ${table}.${opts.name} exists`)
  }
}

async function main() {
  const table = String(models.OrderItem.tableName || models.OrderItem.getTableName())
  console.log('OrderItem table:', table)
  console.log('tables:', (await s.query("SELECT name FROM sqlite_master WHERE type='table'", { type: QueryTypes.SELECT })).map(r => r.name).join(', '))
  console.log('OrderItem columns before:', (await tableInfo(table)).join(', '))

  await addColumn(table, { name: 'returnedQuantity', ddl: 'INTEGER DEFAULT 0' })
  await addColumn(table, { name: 'refundedAt', ddl: 'DATETIME' })

  const allTables = (await s.query("SELECT name FROM sqlite_master WHERE type='table'", { type: QueryTypes.SELECT })).map(r => r.name)
  console.log('Banner table exists:', allTables.includes('Banners'), '(Banners)')

  console.log('OrderItem columns after:', (await tableInfo(table)).join(', '))
  await s.close()
}

main().catch(e => { console.error('MIGRATION FAILED:', e.message); process.exit(1) })