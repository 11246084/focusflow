const express = require('express');
const controller = require('../controllers/conversation.controller');
const { authenticate } = require('../middleware/auth.middleware');
const router = express.Router();
router.use(authenticate);
router.post('/', controller.createConversation);
router.get('/:conversationId/messages', controller.listMessages);
router.post('/:conversationId/messages', controller.sendMessage);
module.exports = router;
