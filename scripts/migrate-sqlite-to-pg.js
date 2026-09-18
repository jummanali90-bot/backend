/*
 * One-time data migration: database.sqlite -> PostgreSQL (via DATABASE_URL).
 *
 * Reads every table raw from SQLite, then upserts each row into the Postgres
 * database using the same Sequelize model definitions, preserving all UUIDs
 * and timestamps so cross-table references stay intact.
 *
 * Usage (from backend/):
 *   $env:DATABASE_URL="postgresql://..." ; node scripts/migrate-sqlite-to-pg.js
 *
 * Run only AFTER the first boot of the deployed backend has created the
 * schema (sequelize.sync()), or let this script sync it itself.
 */
require('dotenv').config()

const path = require('path')
const { Sequelize, QueryTypes, DataTypes } = require('sequelize')

const target = require('../config/database')
const models = require('../models')

const ORDER = [
  'Settings', 'Banners', 'Products', 'Coupons', 'Users',
  'UserAddresses', 'Carts', 'Wishlists', 'PaymentMethods',
  'Orders', 'OrderItems', 'OrderTrackings', 'Reviews', 'LoginHistories',
  'LoyaltyTransactions', 'CouponUsages', 'ReturnRequests', 'ActivityLogs',
]

const bool = (v) => {
  if (v === null || v === undefined) return v
  return [true, 'true', 1, '1', 't'].includes(v)
}

const toDate = (v) => {
  if (!v) return v
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d
}

const castRow = (model, row, counters) => {
  const out = {}
  for (const [key, value] of Object.entries(row)) {
    const attr = model.rawAttributes[key]
    if (!attr) { out[key] = value; continue }
    switch (attr.type.key) {
      case 'BOOLEAN': out[key] = bool(value); break
      case 'DATE': out[key] = toDate(value); break
      case 'JSON':
      case 'JSONB':
        out[key] = typeof value === 'string' ? (() => { try { return JSON.parse(value) } catch { return value } })() : value
        break
      default: out[key] = value
    }
  }
  return out
}

const tableName = (model) => {
  const t = model.getTableName()
  return typeof t === 'object' ? t.tableName : t
}

const modelByTable = {}
for (const model of Object.values(models)) {
  modelByTable[String(tableName(model)).toLowerCase()] = model
}

const run = async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Point it at the target PostgreSQL database and retry.')
    console.error('Example:  $env:DATABASE_URL="postgresql://user:pass@host/db"')
    process.exit(1)
  }

  const sqlite = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, '..', 'database.sqlite'),
    logging: false,
  })

  await target.authenticate()
  await target.sync()
  console.log('Target PostgreSQL schema synced.')

  const sqliteTables = await sqlite.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    { type: QueryTypes.SELECT, raw: true }
  )

  const ranked = [...sqliteTables.map((r) => r.name)].sort((a, b) => {
    const ia = ORDER.indexOf(a)
    const ib = ORDER.indexOf(b)
    const na = ia === -1 ? 999 : ia
    const nb = ib === -1 ? 999 : ib
    return na - nb || a.localeCompare(b)
  })

  const summary = []
  for (const tname of ranked) {
    const model = modelByTable[tname.toLowerCase()]
    if (!model) {
      summary.push({ table: tname, rows: 'SKIPPED (no model)' })
      continue
    }
    const rows = await sqlite.query(`SELECT * FROM "${tname}"`, { type: QueryTypes.SELECT, raw: true })
    let ok = 0
    let failed = 0
    for (const row of rows) {
      try {
        const clean = castRow(model, row, {})
        await model.upsert(clean)
        ok++
      } catch (err) {
        failed++
        console.error(`  [${tname}] row ${row.id || ok} failed:`, err.message)
      }
    }
    summary.push({ table: tname, rows: `${ok}${failed ? ` (${failed} failed)` : ''}` })
  }

  console.log('\n=== MIGRATION SUMMARY ===')
  for (const s of summary) console.log(`  ${s.table.padEnd(22)} ${s.rows}`)

  await sqlite.close()
  await target.close()
  console.log('\nDone. Data copied from database.sqlite to PostgreSQL.')
}

run().catch((err) => {
  console.error('Migration aborted:', err.message)
  process.exit(1)
})