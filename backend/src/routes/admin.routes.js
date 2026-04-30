const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { authorizeRoles } = require('../middleware/role.middleware');
const { USER_ROLES } = require('../constants/enums');
const adminController = require('../controllers/admin.controller');

const router = express.Router();

router.use(authenticate, authorizeRoles(USER_ROLES.ADMIN));

router.get('/stats', adminController.getStats);
router.get('/users', adminController.listUsers);
router.patch('/users/:userId', adminController.updateUser);
router.get('/videos', adminController.listVideos);
router.delete('/videos/:videoId', adminController.deleteVideo);
router.get('/events', adminController.getRecentEvents);
router.get('/event-stats', adminController.getEventStats);

module.exports = router;
