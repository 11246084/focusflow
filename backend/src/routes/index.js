const express = require('express');
const authRoutes = require('./auth.routes');
const courseRoutes = require('./course.routes');
const videoRoutes = require('./video.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/courses', courseRoutes);
router.use('/', videoRoutes);

module.exports = router;
