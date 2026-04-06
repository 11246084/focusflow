const express = require('express');
const authRoutes = require('./auth.routes');
const courseRoutes = require('./course.routes');
const qaRoutes = require('./qa.routes');
const lineRoutes = require('./line.routes');
const videoRoutes = require('./video.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/courses', courseRoutes);
router.use('/qa', qaRoutes);
router.use('/line', lineRoutes);
router.use('/', videoRoutes);

module.exports = router;
