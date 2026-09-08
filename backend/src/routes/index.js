const express = require('express');
const authRoutes = require('./auth.routes');
const courseRoutes = require('./course.routes');
const qaRoutes = require('./qa.routes');
const lineRoutes = require('./line.routes');
const videoRoutes = require('./video.routes');
const internalVideoRoutes = require('./internal-video.routes');
const statsRoutes = require('./stats.routes');
const adminRoutes = require('./admin.routes');
const youtubeRoutes = require('./youtube.routes');
const notificationRoutes = require('./notification.routes');
const conversationRoutes = require('./conversation.routes');
const shortsRoutes = require('./shorts.routes');
const shortScriptRoutes = require('./short-script.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/courses', courseRoutes);
router.use('/qa', qaRoutes);
router.use('/line', lineRoutes);
router.use('/internal', internalVideoRoutes);
router.use('/stats', statsRoutes);
router.use('/admin', adminRoutes);
router.use('/youtube', youtubeRoutes);
router.use('/notifications', notificationRoutes);
router.use('/conversations', conversationRoutes);
router.use('/shorts', shortsRoutes);
// 掛在 '/' 之下，路徑同時涵蓋 /courses/:courseId/short-scripts 與 /short-scripts/:scriptId。
// 必須排在 videoRoutes 之前——videoRoutes 也掛 '/'，會先吃掉未匹配的路徑。
router.use('/', shortScriptRoutes);
router.use('/', videoRoutes);

module.exports = router;
