/*
 * One-off: bring an already-deployed PostgreSQL schema up to date with the
 * models, WITHOUT a code redeploy. Runs the same idempotent column additions
 * as utils/schemaMigrate.js against whatever DB DATABASE_URL points at.
 *
 * Usage (from backend/):
 *   $env:DATABASE_URL="postgresql://..." ; node scripts/ensure-live-schema.js
 */
require('dotenv').config()

const sequelize = require('../config/database')
const { QueryTypes } = require('sequelize')

const PRODUCT_COLUMNS = [
  ['subCategory', 'VARCHAR(255)'],
  ['mrp', 'DECIMAL(10,2)'],
  ['costPrice', 'DECIMAL(10,2)'],
  ['sku', 'VARCHAR(255)'],
  ['weight', 'VARCHAR(255)'],
  ['dimensions', 'VARCHAR(255)'],
  ['color', 'VARCHAR(255)'],
  ['size', 'VARCHAR(255)'],
  ['material', 'VARCHAR(255)'],
  ['highlights', 'TEXT'],
  ['warrantyInfo', 'TEXT'],
]

const tableExists = async (name) => {
  const rows = await sequelize.query(
    'SELECT 1 AS found FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?',
    { type: QueryTypes.SELECT, replacements: [name] }
  )
  return rows.length > 0
}

const columnExists = async (table, name) => {
  const rows = await sequelize.query(
    'SELECT 1 AS found FROM information_schema.columns WHERE table_name = ? AND column_name = ?',
    { type: QueryTypes.SELECT, replacements: [table, name] }
  )
  return rows.length > 0
}

const run = async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Point it at the live PostgreSQL database and retry.')
    process.exit(1)
  }
  if (sequelize.getDialect() !== 'postgres') {
    console.error(`Unexpected dialect: ${sequelize.getDialect()}. Expected postgres.`)
    process.exit(1)
  }

  await sequelize.authenticate()

  if (await tableExists('Products')) {
    for (const [name, def] of PRODUCT_COLUMNS) {
      if (!(await columnExists('Products', name))) {
        await sequelize.query(`ALTER TABLE "Products" ADD COLUMN "${name}" ${def}`)
        console.log(`Ensured Products.${name}`)
      }
    }
  } else {
    console.log('Products table not found (nothing to do).')
  }

  if (await tableExists('OrderItems')) {
    if (!(await columnExists('OrderItems', 'refundStatus'))) {
      await sequelize.query(`ALTER TABLE "OrderItems" ADD COLUMN "refundStatus" TEXT DEFAULT 'none'`)
      console.log('Ensured OrderItems.refundStatus')
    }
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
    console.log('Backfilled OrderItems.refundStatus')
  }

  await sequelize.close()
  console.log('Live schema ensured.')
}

run().catch((err) => {
  console.error('Failed:', err.message)
  process.exit(1)
})