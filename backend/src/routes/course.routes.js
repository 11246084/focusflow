const express = require('express');
const courseController = require('../controllers/course.controller');
const faqController = require('../controllers/faq.controller');
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
router.get('/:courseId/faqs', faqController.listCourseFaqs);
router.delete('/:courseId/faqs', authorizeRoles(USER_ROLES.TEACHER, USER_ROLES.ADMIN), faqController.clearCourseFaqs);

module.exports = router;
