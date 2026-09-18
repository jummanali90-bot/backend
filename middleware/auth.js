const jwt = require('jsonwebtoken')
const speakeasy = require('speakeasy')

const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ message: 'Access denied. No token provided.' })

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = decoded
    next()
  } catch (err) {
    res.status(401).json({ message: 'Invalid or expired token.' })
  }
}

const requireVerified = (req, res, next) => {
  if (!req.user.isVerified) {
    return res.status(403).json({ message: 'Email verification required.' })
  }
  next()
}

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required.' })
  }
  next()
}

const require2FA = async (req, res, next) => {
  const { User } = require('../models')
  const user = await User.findByPk(req.user.id)

  if (!user) return res.status(404).json({ message: 'User not found.' })

  if (user.twoFactorEnabled) {
    const token = req.headers['x-2fa-token']
    if (!token) {
      return res.status(403).json({ message: '2FA token required. Send x-2fa-token header.' })
    }

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token,
      window: 1,
    })

    if (!verified) {
      return res.status(403).json({ message: 'Invalid 2FA token.' })
    }
  }

  next()
}

module.exports = { authenticate, requireVerified, adminOnly, require2FA }
