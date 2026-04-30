const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { authorizeRoles } = require('../middleware/role.middleware');
const { USER_ROLES } = require('../constants/enums');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { getTeacherDashboardStats, getStudentDashboardStats } = require('../services/teacherStats.service');

const router = express.Router();

router.get(
  '/teacher',
  authenticate,
  authorizeRoles(USER_ROLES.TEACHER, USER_ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const stats = await getTeacherDashboardStats(req.user);
    return sendSuccess(res, { data: stats });
  }),
);

module.exports = router;
