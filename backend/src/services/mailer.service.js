const nodemailer = require('nodemailer');
const env = require('../config/env');

// Thin SMTP wrapper (Gmail app password in production). Mail is optional:
// callers check isMailConfigured() and degrade instead of failing startup.

let transport = null;
let transportOverride = null;

function isMailConfigured() {
  return Boolean(transportOverride || (env.smtpUser && env.smtpPass));
}

function getTransport() {
  if (transportOverride) return transportOverride;
  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: { user: env.smtpUser, pass: env.smtpPass },
    });
  }
  return transport;
}

async function sendMail({ to, subject, text }) {
  return getTransport().sendMail({
    from: env.mailFrom || `FocusFlow <${env.smtpUser}>`,
    to,
    subject,
    text,
  });
}

// Tests inject a fake transport so no real mail is sent.
function setTransportForTests(fakeTransport) {
  transportOverride = fakeTransport;
}

module.exports = {
  isMailConfigured,
  sendMail,
  setTransportForTests,
};
