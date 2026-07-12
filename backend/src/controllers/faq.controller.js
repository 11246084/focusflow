const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const faqCacheService = require('../services/faqCache.service');

const listCourseFaqs = asyncHandler(async (req, res) => {
  const faqs = await faqCacheService.listCourseFaqs({
    user: req.user,
    courseId: req.params.courseId,
    limit: req.query.limit,
  });

  return sendSuccess(res, {
    message: 'Course FAQs retrieved.',
    data: faqs,
    meta: { total: faqs.length },
  });
});

const clearCourseFaqs = asyncHandler(async (req, res) => {
  const result = await faqCacheService.clearCourseFaqs({
    user: req.user,
    courseId: req.params.courseId,
  });

  return sendSuccess(res, {
    message: 'Course FAQ cache cleared.',
    data: result,
  });
});

module.exports = {
  listCourseFaqs,
  clearCourseFaqs,
};
