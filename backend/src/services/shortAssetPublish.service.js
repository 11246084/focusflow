const path = require('path');
const { existsSync, unlinkSync } = require('fs');
const ShortAsset = require('../models/shortAsset.model');
const ShortScript = require('../models/shortScript.model');
const AppError = require('../utils/appError');
const env = require('../config/env');
const { assertObjectId } = require('../utils/objectId');
const { getCourseByIdOrThrow, assertCanManageCourse } = require('./courseAccess.service');
const {
  buildYouTubeWatchUrl,
  isYouTubeUploadConfigured,
  normalizePrivacyStatus,
  uploadLocalVideo,
} = require('./youtubeUpload.service');
const { recordShortAssetRegeneration } = require('./shortAsset.service');
const { markScriptPublished } = require('./shortScript.service');
const {
  SHORT_ASSET_REVIEW_STATUSES,
  SHORT_ASSET_STATUSES,
  YOUTUBE_AVAILABILITIES,
  YOUTUBE_UPLOAD_STATUSES,
} = require('../constants/enums');

// 短影片上架（施工單 WO-08、規格書 DR-13 / R-08 / 附錄 K）。
//
// 這一層與 shortAsset.service 分開的理由：上架牽涉 YouTube、檔案系統與腳本連結，
// 而 shortAsset.service 是組員負責的審核 / feed 主線。放同一個檔會讓兩邊的改動互相牽動。
//
// **觸發點是成品審核通過，不是教師上傳。** 教師上傳只建立 draft；上傳 YouTube 是
// 不可逆的對外動作，而教師是先上傳才看得到成品，上傳當下還沒看過影片。

// autoUploadVideoToYouTube 綁死 Video model（讀 video.filePath、寫 video.youtubeUpload），
// 對 ShortAsset 不能直接用。真正可複用的原語是 uploadLocalVideo。
function resolveLocalUploadPath(filePath) {
  return path.isAbsolute(filePath || '')
    ? path.resolve(filePath)
    : path.resolve(env.projectRoot, filePath || '');
}

function shortErrorMessage(error) {
  return String(error?.message || error || 'Unknown error').slice(0, 300);
}

function assertUploadConfigured() {
  // 明確 fail-fast，不得靜默略過（規格書附錄 K.3）。靜默略過會讓教師以為已上架。
  if (!isYouTubeUploadConfigured()) {
    throw new AppError(
      'YouTube upload is not configured.',
      503,
      'YOUTUBE_UPLOAD_NOT_CONFIGURED',
    );
  }
}

function assertDisclosureConfirmed(asset) {
  const disclosure = asset.disclosure || {};
  if (!disclosure.aiDisclosureConfirmed || !disclosure.consentConfirmed) {
    throw new AppError(
      'AI disclosure and written consent must be confirmed before publication.',
      400,
      'SHORT_ASSET_DISCLOSURE_REQUIRED',
    );
  }
}

function assertReviewApproved(asset) {
  const generationVersion = Number(asset.generationVersion || 1);
  if (
    asset.reviewStatus !== SHORT_ASSET_REVIEW_STATUSES.APPROVED
    || Number(asset.reviewedGenerationVersion) !== generationVersion
  ) {
    throw new AppError(
      'Short asset must be approved for its current generation before publication.',
      409,
      'SHORT_ASSET_NOT_APPROVED',
    );
  }
}

async function recordUploadFailure(assetId, { error, attemptCount, startedAt }) {
  // 失敗時 status 維持 draft（不寫 status），只記錄原因與可否重試。
  await ShortAsset.findByIdAndUpdate(assetId, {
    $set: {
      'youtubeUpload.status': YOUTUBE_UPLOAD_STATUSES.FAILED,
      'youtubeUpload.error': shortErrorMessage(error),
      'youtubeUpload.attemptCount': attemptCount,
      'youtubeUpload.lastAttemptAt': startedAt,
      'youtubeUpload.failedAt': new Date(),
      'youtubeUpload.uploadedAt': null,
      // 沒標記過的一律視為不安全：可能已送出影片 bytes，自動重試會產生重複影片。
      'youtubeUpload.retrySafe': error?.youtubeRetrySafe === true,
    },
  });
}

/**
 * 把已通過成品審核的短影片上架到 YouTube（規格書附錄 K.1）。
 *
 * 呼叫前必須已通過審核；本函式仍會再檢查一次，因為它也被重試路徑呼叫。
 */
async function publishShortAsset({ assetId, fetchImpl = global.fetch } = {}) {
  assertObjectId(assetId, 'short asset');
  const asset = await ShortAsset.findById(assetId).lean();
  if (!asset) throw new AppError('Short asset not found.', 404, 'SHORT_ASSET_NOT_FOUND');

  if (asset.youtubeVideoId) {
    throw new AppError(
      'This short asset is already uploaded to YouTube.',
      409,
      'YOUTUBE_UPLOAD_ALREADY_COMPLETED',
    );
  }
  assertReviewApproved(asset);
  assertDisclosureConfirmed(asset);
  assertUploadConfigured();

  const attemptCount = Number(asset.youtubeUpload?.attemptCount || 0) + 1;
  if (attemptCount > env.youtubeUploadMaxAttempts) {
    throw new AppError(
      'YouTube upload retry limit reached for this short asset.',
      409,
      'YOUTUBE_UPLOAD_RETRY_LIMIT_REACHED',
    );
  }

  const startedAt = new Date();
  const filePath = resolveLocalUploadPath(asset.filePath);
  if (!asset.filePath || !existsSync(filePath)) {
    const error = new AppError(
      'Local short video file is missing; cannot upload to YouTube.',
      409,
      'SHORT_ASSET_SOURCE_FILE_MISSING',
    );
    // 檔案不在就重試幾次也不會出現，標成不可重試，讓教師知道要重新上傳。
    error.youtubeRetrySafe = false;
    await recordUploadFailure(assetId, { error, attemptCount, startedAt });
    throw error;
  }

  await ShortAsset.findByIdAndUpdate(assetId, {
    $set: {
      'youtubeUpload.status': YOUTUBE_UPLOAD_STATUSES.UPLOADING,
      'youtubeUpload.error': null,
      'youtubeUpload.attemptCount': attemptCount,
      'youtubeUpload.lastAttemptAt': startedAt,
      'youtubeUpload.failedAt': null,
      'youtubeUpload.retrySafe': false,
    },
  });

  let uploadResult;
  try {
    uploadResult = await uploadLocalVideo({
      filePath,
      title: asset.title,
      description: asset.description || '',
      fetchImpl,
    });
  } catch (error) {
    await recordUploadFailure(assetId, { error, attemptCount, startedAt });
    throw error;
  }

  const uploadedAt = new Date();
  const published = await ShortAsset.findByIdAndUpdate(
    assetId,
    {
      $set: {
        youtubeVideoId: uploadResult.youtubeVideoId,
        youtubeUrl: uploadResult.videoUrl || buildYouTubeWatchUrl(uploadResult.youtubeVideoId),
        status: SHORT_ASSET_STATUSES.PUBLISHED,
        publishedAt: uploadedAt,
        youtubeAvailability: YOUTUBE_AVAILABILITIES.PLAYABLE,
        youtubePrivacyStatus: normalizePrivacyStatus(uploadResult.privacyStatus),
        lastCheckedAt: uploadedAt,
        'youtubeUpload.status': YOUTUBE_UPLOAD_STATUSES.UPLOADED,
        'youtubeUpload.error': null,
        'youtubeUpload.uploadedAt': uploadedAt,
        'youtubeUpload.failedAt': null,
        'youtubeUpload.retrySafe': false,
      },
    },
    { new: true },
  );

  // 影片已在 YouTube 上，這裡失敗只是腳本標籤沒更新，不能讓上架回錯誤。
  if (asset.sourceScriptId) {
    try {
      await markScriptPublished({ scriptId: asset.sourceScriptId });
    } catch (error) {
      console.error('[shortAsset] failed to mark script as published', {
        assetId: String(assetId),
        scriptId: String(asset.sourceScriptId),
        message: error.message,
      });
    }
  }

  return published;
}

async function recordSkippedPublish(assetId, message) {
  // 略過不能不留痕跡（規格書 K.3「不得靜默略過」）。沒有這筆紀錄，資產會停在
  // 「審核已通過、上傳狀態空白」，重試路徑因為找不到失敗紀錄而拒絕，教師沒有任何出路。
  const error = new AppError(message, 503, 'YOUTUBE_UPLOAD_NOT_CONFIGURED');
  error.youtubeRetrySafe = true;
  await recordUploadFailure(assetId, {
    error,
    attemptCount: 0,
    startedAt: new Date(),
  });
  return null;
}

/**
 * 成品審核通過後排程上架。由 shortAsset.service 的 reviewShortAsset 呼叫。
 *
 * 不擋審核回應：上架要傳整支影片到 YouTube，同步做會讓審核請求逾時；
 * 失敗也已寫進 youtubeUpload，教師看得到原因並可重試。
 */
function schedulePublishOnApproval(asset) {
  // 只處理由本功能上傳的資產（有 filePath）。組員的 clip pipeline 建立的資產
  // 沒有本機檔案，本路徑上架不了，也不該在它們身上寫失敗紀錄。
  if (!asset?._id || !asset.filePath || asset.youtubeVideoId) return null;

  // feature flag 關閉時不得對外發布任何東西，但要讓教師知道為什麼沒上架。
  if (!env.shortScriptAutomationEnabled) {
    return recordSkippedPublish(
      asset._id,
      'Short script automation is disabled; enable SHORT_SCRIPT_AUTOMATION_ENABLED and retry.',
    );
  }
  if (!isYouTubeUploadConfigured()) {
    return recordSkippedPublish(asset._id, 'YouTube upload is not configured.');
  }

  return publishShortAsset({ assetId: asset._id }).catch((error) => {
    if (process.env.NODE_ENV !== 'test') {
      console.error(`[shortAsset] publish failed for ${asset._id}.`, error);
    }
    return null;
  });
}

/**
 * 教師手動重試上架（施工單 WO-08）。
 */
async function retryShortAssetUpload({ user, assetId, fetchImpl = global.fetch } = {}) {
  assertObjectId(assetId, 'short asset');
  const asset = await ShortAsset.findById(assetId).lean();
  if (!asset) throw new AppError('Short asset not found.', 404, 'SHORT_ASSET_NOT_FOUND');

  const course = await getCourseByIdOrThrow(asset.courseId);
  await assertCanManageCourse(user, course);

  if (asset.youtubeVideoId) {
    throw new AppError(
      'This short asset is already uploaded to YouTube.',
      409,
      'YOUTUBE_UPLOAD_ALREADY_COMPLETED',
    );
  }
  if (asset.youtubeUpload?.status !== YOUTUBE_UPLOAD_STATUSES.FAILED) {
    throw new AppError(
      'Only failed uploads can be retried.',
      409,
      'YOUTUBE_UPLOAD_RETRY_NOT_ALLOWED',
    );
  }
  if (asset.youtubeUpload?.retrySafe !== true) {
    // 可能已送出影片 bytes。自動重試會在 YouTube 留下重複影片，必須先人工確認 Studio。
    throw new AppError(
      'The previous attempt may have sent video bytes; check YouTube Studio before retrying.',
      409,
      'YOUTUBE_UPLOAD_RETRY_UNSAFE',
    );
  }

  return publishShortAsset({ assetId, fetchImpl });
}

function toTeacherAsset(asset) {
  return {
    id: String(asset._id),
    courseId: String(asset.courseId),
    title: asset.title,
    description: asset.description || '',
    status: asset.status,
    reviewStatus: asset.reviewStatus || SHORT_ASSET_REVIEW_STATUSES.PENDING,
    generationVersion: Number(asset.generationVersion || 1),
    reviewedGenerationVersion: asset.reviewedGenerationVersion ?? null,
    sourceScriptId: asset.sourceScriptId ? String(asset.sourceScriptId) : null,
    sourceVersionNo: asset.sourceVersionNo ?? null,
    youtubeVideoId: asset.youtubeVideoId || null,
    youtubeUrl: asset.youtubeUrl || null,
    publishedAt: asset.publishedAt || null,
    disclosure: {
      aiDisclosureConfirmed: Boolean(asset.disclosure?.aiDisclosureConfirmed),
      consentConfirmed: Boolean(asset.disclosure?.consentConfirmed),
      confirmedAt: asset.disclosure?.confirmedAt || null,
    },
    upload: {
      status: asset.youtubeUpload?.status || null,
      error: asset.youtubeUpload?.error || null,
      attemptCount: Number(asset.youtubeUpload?.attemptCount || 0),
      retrySafe: Boolean(asset.youtubeUpload?.retrySafe),
    },
    createdAt: asset.createdAt || null,
  };
}

async function listCourseShortAssets({ user, courseId } = {}) {
  assertObjectId(courseId, 'course');
  const course = await getCourseByIdOrThrow(courseId);
  await assertCanManageCourse(user, course);

  const assets = await ShortAsset.find({ courseId }).lean();
  return assets
    .slice()
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
    .map(toTeacherAsset);
}

function parseBooleanFlag(value) {
  // multipart 的欄位一律是字串，字串 'false' 不能當成真值。
  if (typeof value === 'boolean') return value;
  return String(value ?? '').trim().toLowerCase() === 'true';
}

function cleanupUploadedFile(file) {
  try {
    if (file?.path && existsSync(file.path)) unlinkSync(file.path);
  } catch {
    // Best-effort cleanup after validation fails.
  }
}

/**
 * 教師依腳本產出影片後上傳，建立 ShortAsset（draft）。**不上架**。
 *
 * 記錄 sourceScriptId / sourceVersionNo（規格書 DR-20），成品被退回時才找得回腳本。
 */
async function createAssetFromScript({
  user, scriptId, file, title, description, versionNo,
  aiDisclosureConfirmed, consentConfirmed,
} = {}) {
  try {
    assertObjectId(scriptId, 'short script');
    if (!file?.path) {
      throw new AppError('A short video file is required.', 400, 'VALIDATION_ERROR');
    }

    const script = await ShortScript.findById(scriptId).lean();
    if (!script) throw new AppError('Short script not found.', 404, 'SHORT_SCRIPT_NOT_FOUND');

    const course = await getCourseByIdOrThrow(script.courseId);
    await assertCanManageCourse(user, course);

    const versions = script.versions || [];
    if (!versions.length) {
      throw new AppError(
        'The script has no generated version to film from.',
        409,
        'SHORT_SCRIPT_STATE_INVALID',
      );
    }

    // 沒指定版本就用最新一版；指定了就必須真的存在，不得默默改用別版——
    // 回饋會寫回這個版本，記錯版本等於把意見套到教師沒看過的腳本上（DR-20）。
    const targetVersion = versionNo
      ? versions.find((version) => version.versionNo === Number(versionNo))
      : versions[versions.length - 1];
    if (!targetVersion) {
      throw new AppError('The requested script version does not exist.', 400, 'VALIDATION_ERROR');
    }

    const confirmedAi = parseBooleanFlag(aiDisclosureConfirmed);
    const confirmedConsent = parseBooleanFlag(consentConfirmed);
    if (!confirmedAi || !confirmedConsent) {
      throw new AppError(
        'AI disclosure and written consent must be confirmed before uploading.',
        400,
        'SHORT_ASSET_DISCLOSURE_REQUIRED',
      );
    }

    const resolvedTitle = String(title || script.topic || '').trim();
    if (!resolvedTitle) {
      throw new AppError('Title is required.', 400, 'VALIDATION_ERROR');
    }

    const disclosure = {
      aiDisclosureConfirmed: true,
      consentConfirmed: true,
      confirmedBy: user.id,
      confirmedAt: new Date(),
    };

    // 同一份腳本已有「還沒上架」的資產（通常是被退回的那支）→ 換代，不另建。
    // 2026-09-09 決議走組員的 generationVersion 模型：同一支影片的多次重拍是同一個資產的
    // 不同代，審核歷史留在同一筆上。另建新資產會讓退回的那支永遠停在 draft 佔著列表。
    // 已上架的不換代——那支影片已經在 YouTube 上，重拍是另一支影片。
    const existingAssets = await ShortAsset.find({ sourceScriptId: script._id }).lean();
    const pending = existingAssets.find(
      (asset) => !asset.youtubeVideoId && asset.status !== SHORT_ASSET_STATUSES.ARCHIVED,
    );
    if (pending) {
      const regenerated = await recordShortAssetRegeneration(pending._id, {
        filePath: file.path,
        sourceVersionNo: targetVersion.versionNo,
        title: resolvedTitle,
        description: String(description || '').trim(),
        disclosure,
        youtubeVideoId: null,
      });
      // 上一代的上傳紀錄屬於上一支影片，換代後要歸零，否則重試判斷會看到舊的失敗。
      await ShortAsset.findByIdAndUpdate(pending._id, {
        $set: {
          youtubeUpload: {
            status: null, error: null, attemptCount: 0, lastAttemptAt: null, uploadedAt: null, failedAt: null, retrySafe: false,
          },
        },
      });
      if (pending.filePath && pending.filePath !== file.path) {
        cleanupUploadedFile({ path: resolveLocalUploadPath(pending.filePath) });
      }
      return { ...regenerated, youtubeUpload: { status: null, error: null, attemptCount: 0, retrySafe: false } };
    }

    return await ShortAsset.create({
      courseId: script.courseId,
      sourceScriptId: script._id,
      sourceVersionNo: targetVersion.versionNo,
      filePath: file.path,
      title: resolvedTitle,
      description: String(description || '').trim(),
      status: SHORT_ASSET_STATUSES.DRAFT,
      reviewStatus: SHORT_ASSET_REVIEW_STATUSES.PENDING,
      generationVersion: 1,
      disclosure,
    });
  } catch (error) {
    // 驗證失敗時 multer 已把檔案寫到磁碟，不清掉會累積孤兒檔案。
    cleanupUploadedFile(file);
    throw error;
  }
}

module.exports = {
  createAssetFromScript,
  listCourseShortAssets,
  publishShortAsset,
  retryShortAssetUpload,
  schedulePublishOnApproval,
  toTeacherAsset,
};
