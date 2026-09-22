const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { uploadFeedbackAttachments } = require('../middleware/feedbackUpload.middleware');
const feedbackController = require('../controllers/feedback.controller');

const router = express.Router();

router.use('/feedback', authenticate);

router.post('/feedback', uploadFeedbackAttachments, feedbackController.createFeedback);
router.get('/feedback/:feedbackId/attachments/:attachmentId', feedbackController.getAttachment);

module.exports = router;
