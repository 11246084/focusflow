const express = require('express');
const lineSignature = require('../middleware/lineSignature.middleware');
const lineController = require('../controllers/line.controller');

const router = express.Router();

router.post('/webhook', lineSignature, lineController.handleWebhook);

module.exports = router;
