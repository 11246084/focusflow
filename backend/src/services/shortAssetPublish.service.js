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
  setVideoPrivacy,
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
// **兩個時間點要分開看（DR-21，2026-09-10）：**
//
// - 教師上傳成品 → 立刻以 unlisted 傳到 YouTube。教師要先看得到影片才審得動，而 private
//   影片連教師都看不到（他不是頻道擁有者，也嵌不進審核頁），unlisted 是唯一可預覽的狀態。
// - 成品審核通過 → 才把資產標成 published 進學生牆。
//
// 也就是「對學生公開」的閘門在 FocusFlow 這端（listStudentShorts 只撈 published），
// 不在 YouTube 的隱私設定。審核未過的影片雖然已經在 YouTube 上，但只有拿到連結才看得到，
// 而連結只有系統與教師手上有。被退回時會盡力把影片轉 private。

// 短影片一律以 unlisted 上架，不吃 YOUTUBE_UPLOAD_PRIVACY。
// public 會讓非修課者從搜尋與頻道頁看到；private 則無法用 iframe 嵌入，學生端播不了。
// 兩端都不可行，這個值就不是部署可調的設定，寫死才不會因為某台機器的 .env 而外流。
const SHORT_ASSET_PRIVACY_STATUS = 'unlisted';

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

// 進學生牆的條件。上傳 YouTube 不再檢查這個（DR-21），只有「標成 published」要檢查。
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
 * 把教師上傳的成品傳到 YouTube（unlisted），供教師預覽與後續上架（DR-21）。
 *
 * 這一步不看審核狀態——審核發生在它之後。真正對學生公開的是
 * publishApprovedShortAsset()。若上傳完成時審核已經通過（審核比上傳早結束），
 * 這裡會補上那一步，否則資產會停在「已審核通過但沒進學生牆」。
 */
async function uploadShortAssetToYouTube({ assetId, fetchImpl = global.fetch } = {}) {
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
      privacyStatus: SHORT_ASSET_PRIVACY_STATUS,
      fetchImpl,
    });
  } catch (error) {
    await recordUploadFailure(assetId, { error, attemptCount, startedAt });
    throw error;
  }

  const uploadedAt = new Date();
  // 只寫 YouTube 相關欄位：status 仍是 draft，publishedAt 仍是空的，
  // 學生牆的查詢條件（status=published + publishedAt）因此不會撈到未審核的影片。
  const uploaded = await ShortAsset.findByIdAndUpdate(
    assetId,
    {
      $set: {
        youtubeVideoId: uploadResult.youtubeVideoId,
        youtubeUrl: uploadResult.videoUrl || buildYouTubeWatchUrl(uploadResult.youtubeVideoId),
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

  // 審核比上傳早結束時，上架動作在這裡補做，否則資產會卡在「已通過但沒進學生牆」。
  if (
    uploaded.reviewStatus === SHORT_ASSET_REVIEW_STATUSES.APPROVED
    && Number(uploaded.reviewedGenerationVersion) === Number(uploaded.generationVersion || 1)
  ) {
    return markShortAssetPublished(uploaded);
  }

  return uploaded;
}

/**
 * 把已上傳且審核通過的成品標成 published，這一步才是對學生公開（DR-21）。
 *
 * 影片本身在教師上傳當下就已經在 YouTube 上（unlisted），所以這裡不碰 YouTube，
 * 只改 FocusFlow 這端的可見性。
 */
async function markShortAssetPublished(asset) {
  const publishedAt = new Date();
  const published = await ShortAsset.findByIdAndUpdate(
    asset._id,
    {
      $set: {
        status: SHORT_ASSET_STATUSES.PUBLISHED,
        publishedAt,
      },
    },
    { new: true },
  );

  // 影片已經對學生可見，這裡失敗只是腳本標籤沒更新，不能讓上架回錯誤。
  if (asset.sourceScriptId) {
    try {
      await markScriptPublished({ scriptId: asset.sourceScriptId });
    } catch (error) {
      console.error('[shortAsset] failed to mark script as published', {
        assetId: String(asset._id),
        scriptId: String(asset.sourceScriptId),
        message: error.message,
      });
    }
  }

  return published;
}

/**
 * 成品審核通過後把它放進學生牆。由 shortAsset.service 的 reviewShortAsset 呼叫。
 *
 * 影片還沒上傳完（或上傳失敗）時什麼都不做：資產維持 draft，等上傳成功時
 * uploadShortAssetToYouTube() 會看到審核已通過而補上這一步。
 */
async function publishApprovedShortAsset(asset) {
  if (!asset?._id || !asset.filePath) return null;
  assertReviewApproved(asset);
  assertDisclosureConfirmed(asset);
  if (!asset.youtubeVideoId) return null;
  if (asset.status === SHORT_ASSET_STATUSES.PUBLISHED) return null;

  return markShortAssetPublished(asset);
}

async function recordSkippedUpload(assetId, message) {
  // 略過不能不留痕跡（規格書 K.3「不得靜默略過」）。沒有這筆紀錄，資產會停在
  // 「已上傳、YouTube 狀態空白」，重試路徑因為找不到失敗紀錄而拒絕，教師沒有任何出路。
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
 * 教師上傳成品後排程 YouTube 上傳（DR-21）。由 createAssetFromScript 呼叫。
 *
 * 不擋上傳回應：傳整支影片到 YouTube 要時間，同步做會讓上傳請求逾時；
 * 失敗已寫進 youtubeUpload，教師看得到原因並可重試。
 */
function scheduleUploadOnCreate(asset) {
  // 只處理由本功能上傳的資產（有 filePath）。組員的 clip pipeline 建立的資產
  // 沒有本機檔案，本路徑傳不了，也不該在它們身上寫失敗紀錄。
  if (!asset?._id || !asset.filePath || asset.youtubeVideoId) return null;

  // feature flag 關閉時不得把任何東西送上 YouTube，但要讓教師知道為什麼沒有預覽。
  if (!env.shortScriptAutomationEnabled) {
    return recordSkippedUpload(
      asset._id,
      'Short script automation is disabled; enable SHORT_SCRIPT_AUTOMATION_ENABLED and retry.',
    );
  }
  if (!isYouTubeUploadConfigured()) {
    return recordSkippedUpload(asset._id, 'YouTube upload is not configured.');
  }

  return uploadShortAssetToYouTube({ assetId: asset._id }).catch((error) => {
    if (process.env.NODE_ENV !== 'test') {
      console.error(`[shortAsset] YouTube upload failed for ${asset._id}.`, error);
    }
    return null;
  });
}

/**
 * 成品被退回時盡力把 YouTube 上那支影片轉 private（DR-21）。
 *
 * 退回的影片還在頻道上，unlisted 代表拿到連結就看得到，所以要收掉。
 * 轉 private 需要 youtube.force-ssl scope，失敗只記 log——審核結果已經寫進資料庫，
 * 這裡拋錯只會讓一次成立的審核看起來失敗（與 notifyScriptOfRejection 同樣的理由）。
 */
async function privatizeRejectedShortAsset(asset, { fetchImpl = global.fetch } = {}) {
  if (!asset?.youtubeVideoId || !asset.filePath) return null;

  try {
    await setVideoPrivacy({
      youtubeVideoId: asset.youtubeVideoId,
      privacyStatus: 'private',
      fetchImpl,
    });
    return ShortAsset.findByIdAndUpdate(
      asset._id,
      {
        $set: {
          youtubePrivacyStatus: 'private',
          youtubeAvailability: YOUTUBE_AVAILABILITIES.UNAVAILABLE,
          lastCheckedAt: new Date(),
        },
      },
      { new: true },
    );
  } catch (error) {
    console.error('[shortAsset] failed to privatize rejected short asset', {
      assetId: String(asset._id),
      youtubeVideoId: asset.youtubeVideoId,
      message: error.message,
    });
    return null;
  }
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

  return uploadShortAssetToYouTube({ assetId, fetchImpl });
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
    privacyStatus: asset.youtubePrivacyStatus || null,
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

    // 同一份腳本已有「還沒進學生牆」的資產（通常是被退回的那支）→ 換代，不另建。
    // 2026-09-09 決議走組員的 generationVersion 模型：同一支影片的多次重拍是同一個資產的
    // 不同代，審核歷史留在同一筆上。另建新資產會讓退回的那支永遠停在 draft 佔著列表。
    // 已進學生牆的不換代——那支影片學生已經看得到，重拍是另一支影片。
    //
    // 判準是 status 而不是 youtubeVideoId：DR-21 之後影片在教師上傳當下就傳上 YouTube，
    // 被退回的資產同樣有 youtubeVideoId，用它判斷會讓每次重拍都另建資產。
    const existingAssets = await ShortAsset.find({ sourceScriptId: script._id }).lean();
    const pending = existingAssets.find(
      (asset) => asset.status !== SHORT_ASSET_STATUSES.PUBLISHED
        && asset.status !== SHORT_ASSET_STATUSES.ARCHIVED,
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
      const nextGeneration = {
        ...regenerated,
        youtubeUpload: {
          status: null, error: null, attemptCount: 0, retrySafe: false,
        },
      };
      // 上一代的 YouTube 影片留在頻道上（退回時已轉 private），新一代要傳一支新的。
      scheduleUploadOnCreate({ ...nextGeneration, youtubeVideoId: null, filePath: file.path });
      return nextGeneration;
    }

    const created = await ShortAsset.create({
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

    // 教師要先看得到影片才審得動，所以上傳當下就把它送上 YouTube（unlisted）。
    // 不 await：整支影片傳完要時間，同步做會讓上傳請求逾時。
    scheduleUploadOnCreate(created);
    return created;
  } catch (error) {
    // 驗證失敗時 multer 已把檔案寫到磁碟，不清掉會累積孤兒檔案。
    cleanupUploadedFile(file);
    throw error;
  }
}

module.exports = {
  createAssetFromScript,
  listCourseShortAssets,
  privatizeRejectedShortAsset,
  publishApprovedShortAsset,
  retryShortAssetUpload,
  scheduleUploadOnCreate,
  uploadShortAssetToYouTube,
  toTeacherAsset,
};
