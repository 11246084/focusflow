const crypto = require('crypto');

const lineSignature = (req, res, next) => {
  const signature = req.headers['x-line-signature'];

  if (!signature) {
    return res.status(401).json({ message: 'Missing LINE signature' });
  }

  const secret = process.env.LINE_CHANNEL_SECRET;
  const body = req.body; // raw buffer

  const hash = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64');

  if (hash !== signature) {
    return res.status(401).json({ message: 'Invalid LINE signature' });
  }

  // 把 raw buffer 轉成 JS 物件，後面的 controller 才能用
  try {
    req.body = JSON.parse(body.toString('utf8'));
  } catch (e) {
    return res.status(400).json({ message: 'Invalid JSON body' });
  }

  next();
};

module.exports = lineSignature;
