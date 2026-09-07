const express = require('express');
const {
  getReviewShortAsset,
  listReviewShortAssets,
  reviewShortAsset,
} = require('../controllers/shorts.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorizeRoles } = require('../middleware/role.middleware');
const { USER_ROLES } = require('../constants/enums');

const router = express.Router();

router.use(authenticate, authorizeRoles(USER_ROLES.TEACHER, USER_ROLES.ADMIN));
router.get('/', listReviewShortAssets);
router.get('/:shortAssetId', getReviewShortAsset);
router.post('/:shortAssetId/review', reviewShortAsset);

module.exports = router;
