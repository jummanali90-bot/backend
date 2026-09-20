const { QueryTypes } = require('sequelize')
const sequelize = require('../config/database')

// Columns added to the Product/OrderItem models after their tables were first
// created. sequelize.sync() only creates missing *tables* — it never adds
// columns to an existing one on either dialect, so we bring the schema up to
// date manually here. SQLite guards with PRAGMA (no IF NOT EXISTS); Postgres
// guards with ADD COLUMN IF NOT EXISTS. Both run idempotently on server start.
const PRODUCT_COLUMNS = [
  ['subCategory', 'TEXT'],
  ['mrp', 'DECIMAL(10,2)'],
  ['costPrice', 'DECIMAL(10,2)'],
  ['sku', 'TEXT'],
  ['weight', 'TEXT'],
  ['dimensions', 'TEXT'],
  ['color', 'TEXT'],
  ['size', 'TEXT'],
  ['material', 'TEXT'],
  ['highlights', 'TEXT'],
  ['warrantyInfo', 'TEXT'],
]

const migrate = async () => {
  const dialect = sequelize.getDialect()

  if (dialect === 'postgres') {
    const hasTable = async (name) => {
      const rows = await sequelize.query(
        'SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?',
        { type: QueryTypes.SELECT, replacements: [name] }
      )
      return rows.length > 0
    }
    const addColumnIfMissing = async (table, name, def) => {
      const rows = await sequelize.query(
        "SELECT 1 FROM information_schema.columns WHERE table_name = ? AND column_name = ?",
        { type: QueryTypes.SELECT, replacements: [table, name] }
      )
      if (rows.length === 0) {
        await sequelize.query(`ALTER TABLE "${table}" ADD COLUMN "${name}" ${def}`)
        console.log(`Migration: added ${table}.${name} (postgres).`)
      }
    }

    if (await hasTable('Products')) {
      for (const [name, def] of PRODUCT_COLUMNS) {
        await addColumnIfMissing('Products', name, def)
      }
      console.log('Migration: ensured Products columns (postgres).')
    }

    if (await hasTable('OrderItems')) {
      await addColumnIfMissing('OrderItems', 'refundStatus', `TEXT DEFAULT 'none'`)
      console.log('Migration: ensured OrderItems.refundStatus (postgres).')
      await backfillOrderItemRefundStatus()
    }

    return
  }

  if (dialect !== 'sqlite') return

  const tables = await sequelize.query("SELECT name FROM sqlite_master WHERE type='table'", { type: QueryTypes.SELECT })

  if (tables.some((t) => t.name === 'Products')) {
    const cols = await sequelize.query('PRAGMA table_info(Products)', { type: QueryTypes.SELECT })
    const addColumn = async (name, def) => {
      if (!cols.some((c) => c.name === name)) {
        await sequelize.query(`ALTER TABLE Products ADD COLUMN ${name} ${def}`)
        console.log(`Migration: added Products.${name}`)
      }
    }
    for (const [name, def] of PRODUCT_COLUMNS) await addColumn(name, def)
  }

  if (tables.some((t) => t.name === 'OrderItems')) {
    const cols = await sequelize.query('PRAGMA table_info(OrderItems)', { type: QueryTypes.SELECT })
    if (!cols.some((c) => c.name === 'refundStatus')) {
      await sequelize.query(`ALTER TABLE OrderItems ADD COLUMN refundStatus TEXT DEFAULT 'none'`)
      console.log('Migration: added OrderItems.refundStatus')
    }

    await backfillOrderItemRefundStatus()
  }
}

const backfillOrderItemRefundStatus = async () => {
  // Backfill items that were returned+refunded under the old flow.
  // Old flow stamped refundedAt on approval and immediately marked the order
  // refunded, so those rows map to 'refunded'. Returned-but-not-stamped rows
  // are treated as still in processing.
  await sequelize.query(
    `UPDATE "OrderItems" SET "refundStatus" = 'refunded'
     WHERE "refundedAt" IS NOT NULL AND "returnedQuantity" > 0
     AND ("refundStatus" IS NULL OR "refundStatus" = 'none')`
  )
  await sequelize.query(
    `UPDATE "OrderItems" SET "refundStatus" = 'processing'
     WHERE "refundedAt" IS NULL AND "returnedQuantity" > 0
     AND ("refundStatus" IS NULL OR "refundStatus" = 'none')`
  )
}

module.exports = migrate