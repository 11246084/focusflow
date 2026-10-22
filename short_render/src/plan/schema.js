'use strict';

const {
  SCHEMA_VERSION, LAYOUTS, SUBTITLE_MAX_LENGTH, LIMITS, CUT_MODES, SUBTITLE_LEVELS, STAMP_TONES,
} = require('./constants');
const { describeComponent } = require('./components');
const { findSimplifiedCharacters } = require('./text');

function issue(code, path, message) {
  return { code, path, message };
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isAnchor(value) {
  return value
    && typeof value === 'object'
    && isText(value.text)
    && (value.nth === undefined || (Number.isInteger(value.nth) && value.nth >= 1))
    && (value.offset === undefined || Number.isFinite(value.offset));
}

function checkAnchor(errors, anchor, path) {
  if (!isAnchor(anchor)) {
    errors.push(issue('ANCHOR_INVALID', path, 'anchor must be { text, nth?>=1, offset? } with non-empty text'));
  }
}

/**
 * 結構檢查（V0/V4/V8）：只看 plan 本身，不需要證據、不需要對齊結果。
 * 回傳的是問題清單，不拋例外——呼叫端要一次看到所有問題，才能整批退回重生。
 */
function validateStructure(plan) {
  const errors = [];

  if (!plan || typeof plan !== 'object') {
    return [issue('PLAN_INVALID', '$', 'plan must be an object')];
  }
  if (plan.schemaVersion !== SCHEMA_VERSION) {
    errors.push(issue('SCHEMA_VERSION', 'schemaVersion', `schemaVersion must be "${SCHEMA_VERSION}"`));
  }
  if (!LAYOUTS.includes(plan.layout)) {
    errors.push(issue('LAYOUT_INVALID', 'layout', `layout must be one of ${LAYOUTS.join('|')}`));
  }

  const canvas = plan.canvas || {};
  if (canvas.width !== 720 || canvas.height !== 1280 || canvas.fps !== 30) {
    errors.push(issue('CANVAS_INVALID', 'canvas', 'canvas must be 720x1280 @30fps (the only layout tested so far)'));
  }

  const region = plan.source?.teacherRegion;
  if (!isText(plan.source?.videoId)) {
    errors.push(issue('SOURCE_INVALID', 'source.videoId', 'source.videoId is required'));
  }
  if (!region || !['x', 'y', 'w', 'h'].every((key) => Number.isFinite(region[key]) && region[key] >= 0)
    || region.w < 64 || region.h < 64) {
    errors.push(issue('SOURCE_INVALID', 'source.teacherRegion', 'teacherRegion must be { x, y, w>=64, h>=64 } in source pixels'));
  }

  if (!isText(plan.title?.text) || !isText(plan.title?.tag)) {
    errors.push(issue('TITLE_INVALID', 'title', 'title.tag and title.text are required'));
  } else if ([...plan.title.text].length > 16) {
    errors.push(issue('TITLE_TOO_LONG', 'title.text', 'title.text must fit on one line (max 16 characters)'));
  }

  // ── clips ────────────────────────────────────────────────
  const clipIds = new Set();
  if (!Array.isArray(plan.clips) || plan.clips.length < 1 || plan.clips.length > LIMITS.maxClips) {
    errors.push(issue('CLIPS_INVALID', 'clips', `clips must be an array of 1-${LIMITS.maxClips} items`));
  } else {
    plan.clips.forEach((clip, index) => {
      const path = `clips[${index}]`;
      if (!isText(clip?.id) || clipIds.has(clip.id)) {
        errors.push(issue('CLIP_ID', `${path}.id`, 'clip id must be unique and non-empty'));
      } else {
        clipIds.add(clip.id);
      }
      if (!Array.isArray(clip?.chunkIds) || clip.chunkIds.length < 1 || !clip.chunkIds.every(isText)) {
        errors.push(issue('CLIP_CHUNKS', `${path}.chunkIds`, 'chunkIds must be a non-empty array of strings'));
      }
      checkAnchor(errors, clip?.from, `${path}.from`);
      checkAnchor(errors, clip?.to, `${path}.to`);
      if (clip?.cut !== undefined && !CUT_MODES.includes(clip.cut)) {
        errors.push(issue('CLIP_CUT', `${path}.cut`, `cut must be one of ${CUT_MODES.join('|')}`));
      }
    });
  }

  // ── subtitles ────────────────────────────────────────────
  if (!Array.isArray(plan.subtitles) || plan.subtitles.length < 1) {
    errors.push(issue('SUBTITLES_INVALID', 'subtitles', 'subtitles must be a non-empty array'));
  } else {
    plan.subtitles.forEach((subtitle, index) => {
      const path = `subtitles[${index}]`;
      if (!clipIds.has(subtitle?.clip)) {
        errors.push(issue('SUBTITLE_CLIP', `${path}.clip`, 'subtitle.clip must reference an existing clip id'));
      }
      checkAnchor(errors, subtitle?.from, `${path}.from`);
      if (subtitle?.level !== undefined && !SUBTITLE_LEVELS.includes(subtitle.level)) {
        errors.push(issue('SUBTITLE_LEVEL', `${path}.level`, `level must be one of ${SUBTITLE_LEVELS.join('|')}`));
      }
      if (!Array.isArray(subtitle?.runs) || subtitle.runs.length < 1 || !subtitle.runs.every((run) => isText(run?.t))) {
        errors.push(issue('SUBTITLE_RUNS', `${path}.runs`, 'runs must be a non-empty array of { t, hl? }'));
        return;
      }
      const text = subtitle.runs.map((run) => run.t).join('');
      if ([...text.trim()].length > SUBTITLE_MAX_LENGTH) {
        errors.push(issue('SUBTITLE_TOO_LONG', `${path}.runs`, `subtitle is ${[...text.trim()].length} characters, limit ${SUBTITLE_MAX_LENGTH}`));
      }
      const simplified = findSimplifiedCharacters(text);
      if (simplified.length) {
        errors.push(issue('SUBTITLE_SIMPLIFIED', `${path}.runs`, `subtitle contains simplified characters: ${simplified.join('')}`));
      }
    });
  }

  // ── scenes ───────────────────────────────────────────────
  const sceneIds = new Set();
  const clipOrder = Array.isArray(plan.clips) ? plan.clips.map((clip) => clip?.id) : [];
  if (!Array.isArray(plan.scenes) || plan.scenes.length < 1 || plan.scenes.length > LIMITS.maxScenes) {
    errors.push(issue('SCENES_INVALID', 'scenes', `scenes must be an array of 1-${LIMITS.maxScenes} items`));
  } else {
    let lastClipIndex = -1;
    plan.scenes.forEach((scene, index) => {
      const path = `scenes[${index}]`;
      if (!isText(scene?.id) || sceneIds.has(scene.id)) {
        errors.push(issue('SCENE_ID', `${path}.id`, 'scene id must be unique and non-empty'));
      } else {
        sceneIds.add(scene.id);
      }

      const described = describeComponent(scene?.component, scene?.params);
      for (const message of described.errors) {
        errors.push(issue('COMPONENT_PARAMS', `${path}.${scene?.component || 'component'}`, message));
      }

      if (!Array.isArray(scene?.clips) || scene.clips.length < 1 || !scene.clips.every((id) => clipIds.has(id))) {
        errors.push(issue('SCENE_CLIPS', `${path}.clips`, 'scene.clips must be a non-empty array of existing clip ids'));
      } else {
        const positions = scene.clips.map((id) => clipOrder.indexOf(id));
        const contiguous = positions.every((position, i) => i === 0 || position === positions[i - 1] + 1);
        if (!contiguous || positions[0] <= lastClipIndex) {
          errors.push(issue('SCENE_ORDER', `${path}.clips`, 'scenes must cover contiguous clips in plan order without overlapping the previous scene'));
        }
        lastClipIndex = positions[positions.length - 1];
      }

      if (!Array.isArray(scene?.basedOn) || scene.basedOn.length < 1 || !scene.basedOn.every(isText)) {
        errors.push(issue('SCENE_BASED_ON', `${path}.basedOn`, 'basedOn must be a non-empty array of chunk ids'));
      }

      const knownCues = new Set(described.cues);
      for (const [name, cue] of Object.entries(scene?.cues || {})) {
        if (!knownCues.has(name)) {
          errors.push(issue('CUE_UNKNOWN', `${path}.cues.${name}`, `component "${scene.component}" has no cue "${name}"`));
          continue;
        }
        checkAnchor(errors, cue, `${path}.cues.${name}`);
        if (cue?.clip !== undefined && !(scene.clips || []).includes(cue.clip)) {
          errors.push(issue('CUE_CLIP', `${path}.cues.${name}.clip`, 'cue.clip must be one of the scene clips'));
        }
      }

      if (scene?.stamp !== undefined) {
        if (!isText(scene.stamp?.text) || [...scene.stamp.text].length > 6) {
          errors.push(issue('STAMP_INVALID', `${path}.stamp.text`, 'stamp.text is required (max 6 characters)'));
        }
        if (scene.stamp?.tone !== undefined && !STAMP_TONES.includes(scene.stamp.tone)) {
          errors.push(issue('STAMP_INVALID', `${path}.stamp.tone`, `tone must be one of ${STAMP_TONES.join('|')}`));
        }
      }
    });
  }

  // ── endCard / derived ────────────────────────────────────
  const endCard = plan.endCard;
  if (!isText(endCard?.line1)) {
    errors.push(issue('END_CARD', 'endCard.line1', 'endCard.line1 is required'));
  }
  if (endCard?.seconds !== undefined
    && !(Number.isFinite(endCard.seconds) && endCard.seconds >= LIMITS.endCardSeconds.min && endCard.seconds <= LIMITS.endCardSeconds.max)) {
    errors.push(issue('END_CARD', 'endCard.seconds', `endCard.seconds must be ${LIMITS.endCardSeconds.min}-${LIMITS.endCardSeconds.max}`));
  }

  for (const [index, item] of (plan.derived || []).entries()) {
    const path = `derived[${index}]`;
    if (!isText(item?.expr) || !/^[\d+\-*/().\s]+$/.test(item.expr)) {
      errors.push(issue('DERIVED_INVALID', `${path}.expr`, 'expr may only contain digits and + - * / ( ) .'));
    }
    if (!Number.isFinite(item?.value)) {
      errors.push(issue('DERIVED_INVALID', `${path}.value`, 'value must be a number'));
    }
    if (item?.shows !== undefined && !(Array.isArray(item.shows) && item.shows.every(isText))) {
      errors.push(issue('DERIVED_INVALID', `${path}.shows`, 'shows must be an array of strings'));
    }
  }

  return errors;
}

module.exports = { validateStructure, issue };
