const { getLoyaltyConfig } = require('./settings')
const { LoyaltyTransaction } = require('../models')

const TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum']

async function tierForPoints(cumulativePoints) {
  const config = await getLoyaltyConfig()
  const tiers = config.tiers || { bronze: 0, silver: 500, gold: 1500, platinum: 3000 }
  let tier = 'bronze'
  for (const t of TIER_ORDER) {
    if (Number(tiers[t] || 0) <= Number(cumulativePoints || 0)) tier = t
  }
  return tier
}

async function cashbackPercentFor(tier) {
  const config = await getLoyaltyConfig()
  return Number((config.cashbackPct || {})[tier] || 0)
}

async function earnMultiplierFor(tier) {
  const config = await getLoyaltyConfig()
  return Number((config.earnMultiplier || {})[tier] || 1)
}

async function pointsForOrder(subtotal, tier) {
  const config = await getLoyaltyConfig()
  const multiplier = await earnMultiplierFor(tier)
  const per100 = Number(config.pointsPer100 || 1)
  return Math.floor((Number(subtotal) / 100) * per100 * multiplier)
}

async function pointsForOrder(subtotal, tier) {
  const config = await getLoyaltyConfig()
  const multiplier = await earnMultiplierFor(tier)
  const per100 = Number(config.pointsPer100 || 1)
  return Math.floor((Number(subtotal) / 100) * per100 * multiplier)
}

async function creditPoints(user, points, reason, orderId, description) {
  const balanceAfter = Number(user.pointsBalance || 0) + Number(points)
  await user.update({
    pointsBalance: balanceAfter,
    pointsEarnedCumulative: Number(user.pointsEarnedCumulative || 0) + Number(points),
  })
  await LoyaltyTransaction.create({
    userId: user.id,
    points: Number(points),
    reason,
    orderId: orderId || null,
    description,
    balanceAfter,
  })
}

async function debitPoints(user, points, reason, orderId, description) {
  const balanceAfter = Math.max(0, Number(user.pointsBalance || 0) - Number(points))
  await user.update({ pointsBalance: balanceAfter })
  await LoyaltyTransaction.create({
    userId: user.id,
    points: -Number(points),
    reason,
    orderId: orderId || null,
    description,
    balanceAfter,
  })
}

module.exports = {
  TIER_ORDER, tierForPoints, cashbackPercentFor, earnMultiplierFor, pointsForOrder, creditPoints, debitPoints,
}