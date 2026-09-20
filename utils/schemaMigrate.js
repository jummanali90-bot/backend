const { QueryTypes } = require('sequelize')
const sequelize = require('../config/database')

// SQLite cannot add columns via sequelize.sync() once a table exists, so we
// bring the schema up to date manually. Runs idempotently on server start.
// PostgreSQL gets its schema from sequelize.sync() and needs no manual fixes.
const migrate = async () => {
  if (sequelize.getDialect() !== 'sqlite') return

  const tables = await sequelize.query("SELECT name FROM sqlite_master WHERE type='table'", { type: QueryTypes.SELECT })

  if (tables.some((t) => t.name === 'Products')) {
    const cols = await sequelize.query('PRAGMA table_info(Products)', { type: QueryTypes.SELECT })
    const addColumn = async (name, def) => {
      if (!cols.some((c) => c.name === name)) {
        await sequelize.query(`ALTER TABLE Products ADD COLUMN ${name} ${def}`)
        console.log(`Migration: added Products.${name}`)
      }
    }
    await addColumn('subCategory', 'TEXT')
    await addColumn('mrp', 'DECIMAL(10,2)')
    await addColumn('sku', 'TEXT')
    await addColumn('weight', 'TEXT')
    await addColumn('dimensions', 'TEXT')
    await addColumn('color', 'TEXT')
    await addColumn('size', 'TEXT')
    await addColumn('material', 'TEXT')
    await addColumn('highlights', 'TEXT')
    await addColumn('warrantyInfo', 'TEXT')
  }

  if (tables.some((t) => t.name === 'OrderItems')) {
    const cols = await sequelize.query('PRAGMA table_info(OrderItems)', { type: QueryTypes.SELECT })
    if (!cols.some((c) => c.name === 'refundStatus')) {
      await sequelize.query(`ALTER TABLE OrderItems ADD COLUMN refundStatus TEXT DEFAULT 'none'`)
      console.log('Migration: added OrderItems.refundStatus')
    }

    // Backfill items that were returned+refunded under the old flow.
    // Old flow stamped refundedAt on approval and immediately marked the order
    // refunded, so those rows map to 'refunded'. Returned-but-not-stamped rows
    // are treated as still in processing.
    await sequelize.query(
      `UPDATE OrderItems SET refundStatus = 'refunded'
       WHERE refundedAt IS NOT NULL AND returnedQuantity > 0
       AND (refundStatus IS NULL OR refundStatus = 'none')`
    )
    await sequelize.query(
      `UPDATE OrderItems SET refundStatus = 'processing'
       WHERE refundedAt IS NULL AND returnedQuantity > 0
       AND (refundStatus IS NULL OR refundStatus = 'none')`
    )
  }
}

module.exports = migrate