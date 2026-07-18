const express = require('express');
const { getShorts } = require('../controllers/youtube.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorizeRoles } = require('../middleware/role.middleware');
const { USER_ROLES } = require('../constants/enums');

const router = express.Router();

router.get('/shorts', authenticate, authorizeRoles(USER_ROLES.STUDENT), getShorts);

module.exports = router;
