const nodemailer = require('nodemailer')

let transporter = null

function getTransporter() {
  if (transporter) return transporter

  const host = process.env.SMTP_HOST
  const port = parseInt(process.env.SMTP_PORT || '587', 10)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  if (!host || !user || !pass) {
    console.warn('[EMAIL] SMTP not configured — emails will be logged only. Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env')
    return null
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  })

  return transporter
}

async function sendOTP({ to, otp, name }) {
  const transport = getTransporter()
  const subject = 'Your MINJUMART Verification Code'
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
      <div style="background: linear-gradient(135deg, #1B2A4A 0%, #2C3E6B 100%); padding: 28px 24px; text-align: center;">
        <h1 style="color: #C8A951; font-size: 24px; margin: 0;">MINJUMART</h1>
        <p style="color: #aaa; font-size: 12px; margin: 4px 0 0; letter-spacing: 2px;">SK ENTERPRISE</p>
      </div>
      <div style="padding: 32px 24px; text-align: center;">
        <h2 style="color: #1B2A4A; font-size: 18px; margin: 0 0 8px;">Email Verification</h2>
        <p style="color: #666; font-size: 14px; margin: 0 0 24px;">Hi ${name || 'there'}, use the code below to verify your account.</p>
        <div style="background: #f5f5f5; border-radius: 8px; padding: 16px; margin: 0 0 24px;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1B2A4A; font-family: monospace;">${otp}</span>
        </div>
        <p style="color: #999; font-size: 12px; margin: 0;">This code expires in 10 minutes.</p>
        <p style="color: #999; font-size: 12px; margin: 8px 0 0;">If you didn't request this, please ignore this email.</p>
      </div>
    </div>
  `
  const text = `Your MINJUMART verification code is: ${otp}\n\nThis code expires in 10 minutes.\nIf you didn't request this, please ignore.`

  if (!transport) {
    console.log(`[EMAIL-DEV] OTP for ${to}: ${otp}`)
    return { sent: false, reason: 'SMTP not configured', otp }
  }

  try {
    await transport.sendMail({
      from: process.env.EMAIL_FROM || `"MINJUMART" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text,
      html,
    })
    console.log(`[EMAIL] OTP sent to ${to}`)
    return { sent: true }
  } catch (err) {
    console.error(`[EMAIL] Failed to send to ${to}:`, err.message)
    console.log(`[EMAIL-FALLBACK] OTP for ${to}: ${otp}`)
    return { sent: false, reason: err.message, otp }
  }
}

module.exports = { sendOTP }