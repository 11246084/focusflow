const express = require('express');
const { getShorts } = require('../controllers/youtube.controller');

const router = express.Router();

router.get('/shorts', getShorts);

module.exports = router;
