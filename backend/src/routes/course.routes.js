const express = require('express');
const courseController = require('../controllers/course.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorizeRoles } = require('../middleware/role.middleware');
const { USER_ROLES } = require('../constants/enums');

const router = express.Router();

router.use(authenticate);

router.post('/', authorizeRoles(USER_ROLES.TEACHER, USER_ROLES.ADMIN), courseController.createCourse);
router.get('/', courseController.listCourses);
router.get('/:courseId', courseController.getCourseById);
router.patch('/:courseId', authorizeRoles(USER_ROLES.TEACHER, USER_ROLES.ADMIN), courseController.updateCourse);
router.delete('/:courseId', authorizeRoles(USER_ROLES.TEACHER, USER_ROLES.ADMIN), courseController.deleteCourse);
router.post('/:courseId/videos/:videoId/watched', courseController.markVideoWatched);

module.exports = router;
