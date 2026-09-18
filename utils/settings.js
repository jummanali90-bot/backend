const { Setting } = require('../models')

const DEFAULT_SETTINGS = {
  storeName: 'MINJUMART',
  storeTagline: 'SK Enterprise',
  announcement: '🎉 Free shipping on orders above ₹4,000 · COD available nationwide · 7-day easy returns',
  freeShippingAbove: '4000',
  shippingFee: '80',
  supportEmail: 'support@minjumart.com',
}

const DEFAULT_LOYALTY = {
  pointsPer100: 1,
  redeemRate: 1,
  maxRedeemPercent: 20,
  tiers: { bronze: 0, silver: 500, gold: 1500, platinum: 3000 },
  cashbackPct: { bronze: 0, silver: 0.5, gold: 1, platinum: 2 },
  earnMultiplier: { bronze: 1, silver: 1, gold: 2, platinum: 3 },
}

async function getSettings() {
  const rows = await Setting.findAll()
  const settings = { ...DEFAULT_SETTINGS }
  for (const r of rows) settings[r.key] = r.value
  return settings
}

async function getJSON(key, fallback = null) {
  const row = await Setting.findOne({ where: { key } })
  if (!row) return fallback
  try {
    return JSON.parse(row.value)
  } catch {
    return fallback
  }
}

async function setJSON(key, value) {
  await Setting.upsert({ key, value: JSON.stringify(value) })
}

async function getLoyaltyConfig() {
  return {
    ...DEFAULT_LOYALTY,
    ...(await getJSON('loyaltyConfig', {})),
  }
}

module.exports = { DEFAULT_SETTINGS, DEFAULT_LOYALTY, getSettings, getJSON, setJSON, getLoyaltyConfig }