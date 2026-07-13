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

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/courses', courseRoutes);
router.use('/qa', qaRoutes);
router.use('/line', lineRoutes);
router.use('/internal', internalVideoRoutes);
router.use('/stats', statsRoutes);
router.use('/admin', adminRoutes);
router.use('/youtube', youtubeRoutes);
router.use('/', videoRoutes);

module.exports = router;
