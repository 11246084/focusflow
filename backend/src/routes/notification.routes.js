const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const notificationController = require('../controllers/notification.controller');

const router = express.Router();

router.use(authenticate);

router.get('/', notificationController.listNotifications);
router.post('/read-all', notificationController.markAllNotificationsRead);
router.patch('/:notificationId/read', notificationController.markNotificationRead);

module.exports = router;
