const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const speakeasy = require('speakeasy')
const { User, LoginHistory } = require('../models')
const { authenticate } = require('../middleware/auth')
const { sendOTP } = require('../utils/email')
const { logActivity } = require('../utils/helpers')
const { tierForPoints, cashbackPercentFor } = require('../utils/rewards')

const router = express.Router()

const generateOTP = () => String(Math.floor(100000 + Math.random() * 900000))

const generateToken = (user) =>
  jwt.sign(
    { id: user.id, email: user.email, role: user.role, isVerified: user.isVerified },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  )

const sanitizeUser = (u) => ({
  id: u.id, name: u.name, email: u.email, phone: u.phone,
  role: u.role, isVerified: u.isVerified, twoFactorEnabled: u.twoFactorEnabled,
  pointsBalance: u.pointsBalance, pointsEarnedCumulative: u.pointsEarnedCumulative,
})

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required.' })
    }

    const existingUser = await User.findOne({ where: { email } })
    if (existingUser) {
      return res.status(409).json({ message: 'Email already registered.' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      phone: phone || null,
      isVerified: true,
    })

    const token = generateToken(user)

    res.status(201).json({
      message: 'Registration successful.',
      token,
      user: sanitizeUser(user),
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' })
    }

    const user = await User.findOne({ where: { email } })
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password.' })
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      await LoginHistory.create({
        userId: user.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'] || null,
        success: false,
      })
      return res.status(401).json({ message: 'Invalid email or password.' })
    }

    if (!user.isActive) {
      await LoginHistory.create({
        userId: user.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'] || null,
        success: false,
      })
      return res.status(403).json({ message: 'Your account has been deactivated. Contact support.' })
    }

    const token = generateToken(user)

    await LoginHistory.create({
      userId: user.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null,
      success: true,
    })

    if (user.role === 'admin') {
      await logActivity(user, 'admin_login', 'user', user.id, { ip: req.ip })
    }

    res.json({
      message: 'Login successful.',
      token,
      user: sanitizeUser(user),
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body

    if (!email || !otp) {
      return res.status(400).json({ message: 'Email and OTP are required.' })
    }

    const user = await User.findOne({ where: { email } })
    if (!user) {
      return res.status(404).json({ message: 'User not found.' })
    }

    if (user.isVerified) {
      return res.status(400).json({ message: 'Account already verified.' })
    }

    if (user.otp !== otp) {
      return res.status(400).json({ message: 'Invalid OTP.' })
    }

    if (new Date() > user.otpExpires) {
      return res.status(400).json({ message: 'OTP has expired. Request a new one.' })
    }

    await user.update({ isVerified: true, otp: null, otpExpires: null })

    res.json({ message: 'Account verified successfully.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// POST /api/auth/send-otp
router.post('/send-otp', async (req, res) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ message: 'Email is required.' })

    const user = await User.findOne({ where: { email } })
    if (!user) {
      return res.status(404).json({ message: 'User not found.' })
    }

    const otp = generateOTP()
    await user.update({ otp, otpExpires: new Date(Date.now() + 10 * 60 * 1000) })

    const emailResult = await sendOTP({ to: email, otp, name: user.name })

    res.json({
      message: emailResult.sent
        ? 'OTP sent to your email.'
        : 'OTP generated — use code from server logs.',
      otp: emailResult.sent ? undefined : otp,
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// POST /api/auth/enable-2fa (admin only)
router.post('/enable-2fa', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id)

    if (user.role !== 'admin') {
      return res.status(403).json({ message: '2FA is only available for admin accounts.' })
    }

    const secret = speakeasy.generateSecret({ name: `MINJUMART Admin (${user.email})` })

    await user.update({ twoFactorSecret: secret.base32 })

    res.json({
      message: '2FA setup initiated. Scan the OTPAUTH URL with your authenticator app.',
      otpauthUrl: secret.otpauth_url,
      secret: secret.base32,
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// POST /api/auth/confirm-2fa
router.post('/confirm-2fa', authenticate, async (req, res) => {
  try {
    const { token } = req.body
    if (!token) return res.status(400).json({ message: '2FA token is required.' })

    const user = await User.findByPk(req.user.id)

    if (!user.twoFactorSecret) {
      return res.status(400).json({ message: '2FA not set up. Call /enable-2fa first.' })
    }

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token,
      window: 1,
    })

    if (!verified) {
      return res.status(400).json({ message: 'Invalid 2FA token. Try again.' })
    }

    await user.update({ twoFactorEnabled: true })

    res.json({ message: '2FA enabled successfully.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// POST /api/auth/disable-2fa
router.post('/disable-2fa', authenticate, async (req, res) => {
  try {
    const { token } = req.body
    const user = await User.findByPk(req.user.id)

    if (!user.twoFactorEnabled) {
      return res.status(400).json({ message: '2FA is not enabled.' })
    }

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token,
      window: 1,
    })

    if (!verified) {
      return res.status(400).json({ message: 'Invalid 2FA token.' })
    }

    await user.update({ twoFactorEnabled: false, twoFactorSecret: null })

    res.json({ message: '2FA disabled successfully.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ['password', 'otp', 'otpExpires', 'twoFactorSecret'] },
    })

    if (!user) return res.status(404).json({ message: 'User not found.' })

    const tier = await tierForPoints(user.pointsEarnedCumulative)
    const cashbackPercent = await cashbackPercentFor(tier)

    res.json({
      user: {
        ...sanitizeUser(user),
        membershipTier: tier,
        cashbackPercent,
      },
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

module.exports = router
module.exports.sanitizeUser = sanitizeUser
