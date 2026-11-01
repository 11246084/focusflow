const express = require('express');
const env = require('../config/env');
const AppError = require('../utils/appError');
const controller = require('../controllers/recutWorker.controller');
const { uploadSingleVideo } = require('../middleware/upload.middleware');
const router = express.Router();
router.use((req, res, next) => env.shortScriptAutomationEnabled ? next() : next(new AppError('Not found.', 404, 'NOT_FOUND')));
router.use(controller.authenticate);
router.post('/jobs/claim', controller.claim);
router.post('/jobs/:jobId/heartbeat', controller.heartbeat);
router.get('/jobs/:jobId/source', controller.source);
router.post('/jobs/:jobId/failure', controller.failure);
// Check ownership before receiving bytes and again at commit time.
router.post('/jobs/:jobId/result', controller.checkLease, uploadSingleVideo, controller.complete);
module.exports = router;
