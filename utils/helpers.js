const { ActivityLog } = require('../models')

const parseImages = (raw) => {
  if (Array.isArray(raw)) return raw.filter(Boolean)
  try {
    const arr = JSON.parse(raw || '[]')
    return Array.isArray(arr) ? arr.filter(Boolean) : []
  } catch {
    return []
  }
}

const normalizeProduct = (p) => {
  const json = {
    ...p.toJSON(),
    images: parseImages(p.images),
  }
  if (!json.image && json.images.length) json.image = json.images[0]
  return json
}

const logActivity = async (actor, action, entity, entityId, details) => {
  try {
    await ActivityLog.create({
      adminId: actor?.id || null,
      adminEmail: actor?.email || null,
      action,
      entity: entity || null,
      entityId: entityId != null ? String(entityId) : null,
      details: details ? JSON.stringify(details) : null,
    })
  } catch {
    // Activity logging must never break the main flow.
  }
}

module.exports = { parseImages, normalizeProduct, logActivity }