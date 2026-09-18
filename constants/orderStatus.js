// Canonical order & refund lifecycle — single source of truth for statuses.
// Delivery chain: pending → processing → shipped → out_for_delivery → delivered.
// Post-delivery resolution: returned (refund stages live on the order/items).
// cancelled is a terminal state reached only by a real cancellation.

const ORDER_FLOW = [
  'pending',
  'processing',
  'shipped',
  'out_for_delivery',
  'delivered',
  'returned',
]

const REFUND_FLOW = [
  'none',
  'requested',
  'processing',
  'refunded',
  'rejected',
]

module.exports = { ORDER_FLOW, REFUND_FLOW }