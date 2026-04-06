const express = require('express');
const qaController = require('../controllers/qa.controller');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);
router.post('/ask', qaController.askQuestion);

module.exports = router;
