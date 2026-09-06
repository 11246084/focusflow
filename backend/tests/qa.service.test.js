const assert = require('node:assert/strict');
const { beforeEach, describe, it } = require('node:test');
const { askQuestion } = require('../src/services/qa.service');
const env = require('../src/config/env');
const VideoSegment = require('../src/models/videoSegment.model');
const logger = require('../src/utils/logger');
const {
  ids,
  newObjectId,
  resetStore,
  store,
} = require('./helpers/backendTestHarness');

const originalFetch = global.fetch;

function resetQaEnv() {
  env.qaQueryEmbeddingProvider = 'mock';
  env.qaVectorSearchMode = 'memory';
  env.qaAnswerProvider = 'template';
  env.qaAtlasVectorIndexName = '';
  env.qaAtlasFilterMode = 'bridge_course_or_video';
  env.qaLeafAdjacentContextEnabled = false;
  env.videoSegmentVideoVectorIndexName = 'video_embedding_index';
  env.qaEstimatedTokensPerAsk = 1000;
  env.qaMonthlyTokenBudget = 0;
  env.qaUserMonthlyTokenQuota = 0;
  env.geminiApiKey = '';
  env.openaiApiKey = '';
  env.qaActiveLeafEmbeddingContractJson = '';
  env.qaActiveParentEmbeddingContractJson = '';
}

function grantStudentCourseAccess(courseId) {
  store.enrollments.push({
    _id: newObjectId(),
    studentId: ids.student,
    courseId,
    status: 'active',
    enrolledAt: '2026-04-13T08:00:00.000Z',
  });
}

describe('qa service', () => {
  beforeEach(() => {
    resetStore();
    resetQaEnv();
    global.fetch = originalFetch;
  });

  it('uses in-memory ranking to return the best segment first and exposes runtime diagnostics', async () => {
    store.videoSegments.push({
      _id: 'segment-three-id',
      segmentId: 'segment-three',
      courseId: ids.publishedCourse,
      videoId: ids.publishedVideo,
      startSec: 60,
      endSec: 85,
      text: 'This segment mentions JWT once.',
      embedding: [],
    });

    const result = await askQuestion({
      user: {
        id: ids.student,
        role: 'student',
      },
      courseId: ids.publishedCourse,
      question: 'Tell me about JWT authentication and role based access control.',
      source: 'service-test',
    });

    assert.equal(result.matches[0].segmentId, ids.segmentOne);
    assert.equal(result.matches.length, 3);
    assert.equal(result.citations.length, 1);
    assert.equal(result.citations[0].citationId, 'C1');
    assert.equal(result.citations[0].timestamp.label, '0:12');
    assert.equal(result.answerStatus.status, 'answered');
    assert.equal(result.answerStatus.matchStatus, 'matched');
    assert.equal(result.runtime.queryEmbeddingProvider, 'mock');
    assert.equal(result.runtime.searchBackendUsed, 'memory');
    assert.equal(result.runtime.answerProviderUsed, 'template');
    assert.equal(result.runtime.status, 'degraded');
    assert.equal(result.runtime.degraded, true);
    assert.equal(result.runtime.matchStatus, 'matched');
    assert.equal(result.runtime.searchableSegmentCount, 3);
    assert.equal(result.runtime.course.qaScopeOnly, false);
    assert.equal(result.runtime.fallbacks.some((item) => item.code === 'SEGMENT_EMBEDDING_MISSING'), true);
  });

  it('falls back to course video whitelist when courseId is missing from segments', async () => {
    store.videoSegments.push(
      {
        _id: 'segment-snake-allowed-id',
        segmentId: ids.snakeCaseSegment,
        videoId: ids.publishedVideo,
        startSec: 84,
        endSec: 118,
        text: 'Atlas bridge whitelisttoken aligns text segments by filtering with the course video whitelist.',
        embedding: [],
      },
      {
        _id: 'segment-snake-foreign-id',
        segmentId: 'segment-snake-foreign',
        videoId: 'video-foreign-999',
        startSec: 84,
        endSec: 118,
        text: 'Atlas bridge whitelisttoken aligns text segments by filtering with the course video whitelist.',
        embedding: [],
      },
    );

    const result = await askQuestion({
      user: {
        id: ids.student,
        role: 'student',
      },
      courseId: ids.publishedCourse,
      question: 'How does whitelisttoken help Atlas bridge filtering?',
      source: 'service-test',
    });

    assert.equal(result.matches[0].segmentId, ids.snakeCaseSegment);
    assert.equal(result.matches[0].videoId, ids.publishedVideo);
    assert.equal(result.matches[0].startSec, 84);
    assert.equal(result.matches[0].endSec, 118);
    assert.match(result.matches[0].transcript, /course video whitelist/i);
    assert.equal(result.matches.some((match) => match.segmentId === 'segment-snake-foreign'), false);
  });

  it('uses canonical video._id scope when videos.courseId is missing', async () => {
    const publishedVideo = store.videos.find((video) => video._id === ids.publishedVideo);
    publishedVideo.courseId = null;

    store.videoSegments.length = 0;
    store.videoSegments.push(
      {
        _id: 'segment-course-videoids-only',
        segmentId: 'segment-course-videoids-only',
        videoId: ids.publishedVideo,
        startSec: 21,
        endSec: 44,
        text: 'Course refs fallbacktoken keeps canonical video object ids in scope.',
        embedding: [],
      },
      {
        _id: 'segment-course-videoids-foreign',
        segmentId: 'segment-course-videoids-foreign',
        videoId: 'video-foreign-999',
        startSec: 21,
        endSec: 44,
        text: 'Course refs fallbacktoken keeps canonical video object ids in scope.',
        embedding: [],
      },
    );

    const result = await askQuestion({
      user: {
        id: ids.student,
        role: 'student',
      },
      courseId: ids.publishedCourse,
      question: 'How does fallbacktoken keep canonical course video refs in scope?',
      source: 'service-test',
    });

    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].segmentId, 'segment-course-videoids-only');
    assert.equal(result.matches[0].videoId, ids.publishedVideo);
  });

  it('emits qa.scope_empty when the canonical video allowlist is empty', async () => {
    const course = store.courses.find((item) => item._id === ids.publishedCourse);
    course.videoIds = [];
    store.videos = store.videos.filter((video) => video._id !== ids.publishedVideo);
    const events = [];
    const originalWarn = logger.warn;
    logger.warn = (event, metadata) => events.push({ event, metadata });

    try {
      const result = await askQuestion({
        user: { id: ids.student, role: 'student' },
        courseId: ids.publishedCourse,
        question: 'Does an empty scope stay closed?',
        source: 'service-test',
      });

      assert.deepEqual(result.matches, []);
      assert.deepEqual(
        events.filter(({ event }) => event === 'qa.scope_empty'),
        [{
          event: 'qa.scope_empty',
          metadata: {
            courseId: ids.publishedCourse,
            userId: ids.student,
            searchMode: 'memory',
            reason: 'canonical_video_scope_empty',
          },
        }],
      );
    } finally {
      logger.warn = originalWarn;
    }
  });

  it('rejects videos.video_id aliases when the Leaf videoId is not canonical', async () => {
    const publishedVideo = store.videos.find((video) => video._id === ids.publishedVideo);
    publishedVideo.courseId = null;

    store.videoSegments.length = 0;
    store.videoSegments.push(
      {
        _id: 'segment-videoid-camel',
        segmentId: 'segment-videoid-camel',
        videoId: ids.publishedVideoExternal,
        startSec: 48,
        endSec: 73,
        text: 'Aliasmap token keeps camelCase videoId segments reachable from videos.video_id documents.',
        embedding: [],
      },
      {
        _id: 'segment-videoid-foreign',
        segmentId: 'segment-videoid-foreign',
        videoId: 'video-foreign-999',
        startSec: 48,
        endSec: 73,
        text: 'Aliasmap token keeps camelCase videoId segments reachable from videos.video_id documents.',
        embedding: [],
      },
    );

    const result = await askQuestion({
      user: {
        id: ids.student,
        role: 'student',
      },
      courseId: ids.publishedCourse,
      question: 'Where does aliasmap keep camelCase videoId segments reachable?',
      source: 'service-test',
    });

    assert.equal(result.matches.length, 0);
  });

  it('keeps only canonical identifier segments inside the course scope', async () => {
    const publishedVideo = store.videos.find((video) => video._id === ids.publishedVideo);
    publishedVideo.courseId = null;

    store.videoSegments.length = 0;
    store.videoSegments.push(
      {
        _id: 'segment-mixed-snake',
        segmentId: 'segment-mixed-snake',
        videoId: ids.publishedVideoExternal,
        startSec: 12,
        endSec: 28,
        text: 'Mixscope token keeps camelCase aliases inside the course scope.',
        embedding: [],
      },
      {
        _id: 'segment-mixed-camel',
        segmentId: 'segment-mixed-camel',
        videoId: ids.publishedVideo,
        startSec: 32,
        endSec: 49,
        text: 'Mixscope token also keeps camelCase aliases inside the course scope.',
        embedding: [],
      },
      {
        _id: 'segment-mixed-foreign',
        segmentId: 'segment-mixed-foreign',
        videoId: 'video-foreign-999',
        startSec: 52,
        endSec: 71,
        transcript: 'Mixscope token should not leak across foreign course videos.',
        embedding: [],
      },
    );

    const result = await askQuestion({
      user: {
        id: ids.student,
        role: 'student',
      },
      courseId: ids.publishedCourse,
      question: 'How does mixscope keep canonical identifiers inside the course scope?',
      source: 'service-test',
    });

    assert.deepEqual(
      result.matches.map((match) => match.segmentId).sort(),
      ['segment-mixed-camel'],
    );
  });

  it('scopes QA to pipeline metadata videos referenced only by course.videoIds', async () => {
    store.courses.push({
      _id: ids.pipelineBridgeCourse,
      title: 'Pipeline Bridge Course',
      description: 'QA bridge course',
      teacherId: ids.teacher,
      videoIds: [ids.pipelineBridgeVideo],
      status: 'published',
      createdAt: '2026-04-13T08:00:00.000Z',
    });
    grantStudentCourseAccess(ids.pipelineBridgeCourse);

    store.videos.push({
      _id: ids.pipelineBridgeVideo,
      video_id: ids.pipelineBridgeVideoExternal,
      file_name: 'pipeline-bridge.mp4',
      duration_sec: 420,
      createdAt: '2026-04-13T08:01:00.000Z',
      updatedAt: '2026-04-13T08:01:00.000Z',
    });

    store.videoSegments.push(
      {
        _id: 'segment-pipeline-bridge',
        segmentId: 'segment-pipeline-bridge',
        videoId: ids.pipelineBridgeVideo,
        startSec: 144,
        endSec: 178,
        text: 'Bridgecourse token lets QA scope a course onto pipeline metadata videos without rewriting the videos collection.',
        embedding: [],
      },
      {
        _id: 'segment-pipeline-foreign',
        segmentId: 'segment-pipeline-foreign',
        videoId: 'video-pipeline-foreign-999',
        startSec: 144,
        endSec: 178,
        text: 'Bridgecourse token lets QA scope a course onto pipeline metadata videos without rewriting the videos collection.',
        embedding: [],
      },
    );

    const result = await askQuestion({
      user: {
        id: ids.student,
        role: 'student',
      },
      courseId: ids.pipelineBridgeCourse,
      question: 'How does bridgecourse scope QA onto pipeline metadata videos?',
      source: 'service-test',
    });

    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].videoId, ids.pipelineBridgeVideo);
    assert.equal(result.matches[0].segmentId, 'segment-pipeline-bridge');
    assert.equal(result.runtime.status, 'degraded');
    assert.equal(result.runtime.degraded, true);
    assert.equal(result.runtime.course.qaScopeOnly, true);
    assert.equal(result.runtime.course.bridgeMode, 'qa_scope_only');
  });

  it('marks embedding dimension mismatch when Chinese pipeline segments rely on lexical fallback', async () => {
    store.courses.push({
      _id: ids.pipelineBridgeCourse,
      title: 'Pipeline Bridge Course',
      description: 'QA bridge course',
      teacherId: ids.teacher,
      videoIds: [ids.pipelineBridgeVideo],
      status: 'published',
      createdAt: '2026-04-13T08:00:00.000Z',
    });
    grantStudentCourseAccess(ids.pipelineBridgeCourse);

    store.videos.push({
      _id: ids.pipelineBridgeVideo,
      video_id: ids.pipelineBridgeVideoExternal,
      file_name: 'pipeline-bridge.mp4',
      duration_sec: 420,
      createdAt: '2026-04-13T08:01:00.000Z',
      updatedAt: '2026-04-13T08:01:00.000Z',
    });

    store.videoSegments.push({
      _id: 'segment-pipeline-bridge-zh',
      segmentId: 'segment-pipeline-bridge-zh',
      videoId: ids.pipelineBridgeVideo,
      startSec: 4.53,
      endSec: 32.62,
      text: '我們今天要開始進入影像處理的部分，會先介紹數據預測、自然語言與影像處理。',
      embedding: [1, 2, 3],
    });

    const result = await askQuestion({
      user: {
        id: ids.student,
        role: 'student',
      },
      courseId: ids.pipelineBridgeCourse,
      question: '影像處理在這門課一開始介紹了什麼？',
      source: 'service-test',
    });

    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].segmentId, 'segment-pipeline-bridge-zh');
    assert.equal(result.matches[0].videoId, ids.pipelineBridgeVideo);
    assert.equal(
      result.runtime.fallbacks.some((item) => item.code === 'EMBEDDING_DIMENSION_MISMATCH'),
      true,
    );
  });

  it('returns explicit no-searchable-data diagnostics for metadata-only bridge courses', async () => {
    store.courses.push({
      _id: ids.pipelineBridgeCourse,
      title: 'Pipeline Bridge Course',
      description: 'QA bridge course',
      teacherId: ids.teacher,
      videoIds: [ids.pipelineBridgeVideo],
      status: 'published',
      createdAt: '2026-04-13T08:00:00.000Z',
    });
    grantStudentCourseAccess(ids.pipelineBridgeCourse);

    store.videos.push({
      _id: ids.pipelineBridgeVideo,
      video_id: ids.pipelineBridgeVideoExternal,
      file_name: 'pipeline-bridge.mp4',
      duration_sec: 420,
      createdAt: '2026-04-13T08:01:00.000Z',
      updatedAt: '2026-04-13T08:01:00.000Z',
    });

    const result = await askQuestion({
      user: {
        id: ids.student,
        role: 'student',
      },
      courseId: ids.pipelineBridgeCourse,
      question: '這門課可以問什麼？',
      source: 'service-test',
    });

    assert.equal(result.matches.length, 0);
    assert.deepEqual(result.citations, []);
    assert.equal(result.answerStatus.status, 'no_answer');
    assert.equal(result.answerStatus.noAnswerReason, 'NO_SEARCHABLE_SEGMENTS');
    assert.equal(result.clip, null);
    assert.equal(result.runtime.status, 'degraded');
    assert.equal(result.runtime.degraded, true);
    assert.equal(result.runtime.matchStatus, 'no_searchable_segments');
    assert.equal(result.runtime.searchableSegmentCount, 0);
    assert.equal(result.runtime.degradedReasons.includes('NO_SEARCHABLE_SEGMENTS'), true);
    assert.equal(result.runtime.course.qaScopeOnly, true);
    assert.match(result.answer, /只有 bridge metadata/);
  });

  it('uses course-scoped video_segments_video matches when no text segments are available', async () => {
    const visualCourseId = newObjectId();
    const visualVideoId = newObjectId();

    store.courses.push({
      _id: visualCourseId,
      title: 'Visual Retrieval Course',
      description: 'Course with visual chunks',
      teacherId: ids.teacher,
      videoIds: [visualVideoId],
      status: 'published',
      createdAt: '2026-07-10T08:00:00.000Z',
    });
    grantStudentCourseAccess(visualCourseId);

    store.videos.push({
      _id: visualVideoId,
      courseId: visualCourseId,
      title: 'Visual Source Video',
      sourceUrl: '/uploads/video_001_part_0001.mp4',
      filePath: __filename,
      fileName: 'video_001_part_0001.mp4',
      processing: { status: 'completed' },
      createdAt: '2026-07-10T08:01:00.000Z',
    });

    store.videoSegmentVideos.push(
      {
        _id: 'visual-segment-1',
        video_id: 'video_001',
        clip_id: 'video_001_part_0001',
        clip_path: 'data/video_multimodal_chunks/video_001_part_0001.mp4',
        start_sec: 0,
        end_sec: 120,
        score: 0.91,
      },
      {
        _id: 'visual-segment-2',
        video_id: 'video_001',
        clip_id: 'video_001_part_0002',
        clip_path: 'data/video_multimodal_chunks/video_001_part_0002.mp4',
        start_sec: 120,
        end_sec: 240,
        score: 0.81,
      },
      {
        _id: 'visual-segment-foreign',
        video_id: 'video_999',
        clip_id: 'video_999_part_0001',
        clip_path: 'data/video_multimodal_chunks/video_999_part_0001.mp4',
        start_sec: 0,
        end_sec: 120,
        score: 0.99,
      },
    );

    const result = await askQuestion({
      user: {
        id: ids.student,
        role: 'student',
      },
      courseId: visualCourseId,
      question: 'Which visual scene is relevant?',
      source: 'service-test',
    });

    assert.equal(result.matches.length, 2);
    assert.equal(result.matches[0].modality, 'video');
    assert.equal(result.matches[0].segmentId, 'video_001_part_0001');
    assert.equal(result.matches[0].videoId, 'video_001');
    assert.equal(result.matches[0].videoTitle, 'Visual Source Video');
    assert.equal(result.citations.length, 1);
    assert.equal(result.citations[0].modality, 'video');
    assert.equal(result.citations[0].clipPath, 'data/video_multimodal_chunks/video_001_part_0001.mp4');
    assert.equal(result.answerStatus.status, 'answered');
    assert.equal(result.runtime.matchModality, 'video');
    assert.equal(result.runtime.searchBackendUsed, 'atlas_video');
    assert.equal(result.runtime.scoringMode, 'visual_vector');
    assert.equal(result.runtime.visualSearch.searchBackendUsed, 'atlas_video');
    assert.match(result.answer, /影像片段/);
  });

  it('returns null clip data when no cached clip exists and skips clip_view logging', async () => {
    store.clips.length = 0;

    const result = await askQuestion({
      user: {
        id: ids.student,
        role: 'student',
      },
      courseId: ids.publishedCourse,
      question: 'What does the course say about JWT authentication?',
      source: 'service-test',
    });

    assert.equal(result.clip, null);
    assert.equal(store.usageLogs.some((entry) => entry.event === 'ask'), true);
    assert.equal(store.usageLogs.some((entry) => entry.event === 'clip_view'), false);
  });

  it('blocks QA before retrieval when the monthly user token quota is exhausted', async () => {
    env.qaEstimatedTokensPerAsk = 1000;
    env.qaUserMonthlyTokenQuota = 1000;
    store.usageLogs.push({
      _id: newObjectId(),
      userId: ids.student,
      courseId: ids.publishedCourse,
      event: 'ask',
      metadata: {
        source: 'service-test',
        costControl: {
          estimatedTokens: 1000,
        },
      },
      timestamp: new Date(),
    });

    await assert.rejects(
      () => askQuestion({
        user: {
          id: ids.student,
          role: 'student',
        },
        courseId: ids.publishedCourse,
        question: 'What does the course say about JWT authentication?',
        source: 'service-test',
      }),
      (error) => {
        assert.equal(error.code, 'QA_QUOTA_EXCEEDED');
        assert.equal(error.statusCode, 429);
        assert.equal(error.details.scope, 'user');
        assert.equal(error.details.projectedTokens, 2000);
        return true;
      },
    );
  });

  it('fails fast when atlas mode is combined with mock query embeddings', async () => {
    env.qaVectorSearchMode = 'atlas';
    env.qaAtlasVectorIndexName = 'text_embedding_index';

    await assert.rejects(
      () => askQuestion({
        user: {
          id: ids.student,
          role: 'student',
        },
        courseId: ids.publishedCourse,
        question: 'What does the course say about JWT authentication?',
        source: 'service-test',
      }),
      (error) => error.code === 'QA_RUNTIME_MISCONFIGURED',
    );
  });

  it('drops all TEST_0720 citations when the video has no playable source', async () => {
    const testVideoId = '6a5deabebece4943079410bd';
    store.videoSegments.length = 0;
    store.videos.push({
      _id: testVideoId,
      courseId: ids.publishedCourse,
      title: 'TEST_0720',
      sourceType: 'upload',
      filePath: 'Z:\\focusflow-missing\\TEST_0720.mp4',
      youtubeVideoId: null,
      uploadedBy: ids.teacher,
      processing: { status: 'completed' },
    });
    for (let index = 1; index <= 3; index += 1) {
      store.videoSegments.push({
        _id: `test-0720-segment-${index}`,
        chunkId: `test-0720-chunk-${index}`,
        segmentId: `test-0720-segment-${index}`,
        videoId: testVideoId,
        startSec: index * 10,
        endSec: index * 10 + 5,
        text: `test0720token segment ${index}`,
        embedding: [],
      });
    }
    const events = [];
    const originalWarn = logger.warn;
    logger.warn = (event, metadata) => events.push({ event, metadata });

    try {
      const result = await askQuestion({
        user: { id: ids.student, role: 'student' },
        courseId: ids.publishedCourse,
        question: 'test0720token',
        source: 'service-test',
      });

      assert.equal(result.matches.length, 3);
      assert.deepEqual(result.citations, []);
      assert.deepEqual(result.runtime.citationFilter, {
        errorCode: 'QA_CITATION_DROPPED',
        droppedCount: 1,
      });
      assert.deepEqual(
        events.map(({ event, metadata }) => ({ event, metadata })),
        [1].map((index) => ({
          event: 'qa.citation_dropped_no_playable_source',
          metadata: {
            courseId: ids.publishedCourse,
            videoId: testVideoId,
            chunkId: `test-0720-chunk-${index}`,
          },
        })),
      );
    } finally {
      logger.warn = originalWarn;
    }
  });

  it('surfaces atlas-not-ready errors instead of silently falling back to memory', async () => {
    const originalAggregate = VideoSegment.aggregate;

    env.qaQueryEmbeddingProvider = 'openai';
    env.openaiApiKey = 'openai-test-key';
    env.qaVectorSearchMode = 'atlas';
    env.qaAtlasVectorIndexName = 'text_embedding_index';
    env.qaActiveLeafEmbeddingContractJson = JSON.stringify({
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimension: 1536,
      instructionVersion: null,
      generationVersion: null,
      normalizationVersion: null,
      contractVersion: null,
      taskType: null,
    });
    global.fetch = async () => ({
      ok: true,
      async json() {
        return {
          data: [
            {
              embedding: [0.1, 0.2, 0.3],
            },
          ],
        };
      },
    });
    VideoSegment.aggregate = async () => {
      throw new Error('Atlas index not ready');
    };

    try {
      await assert.rejects(
        () => askQuestion({
          user: {
            id: ids.student,
            role: 'student',
          },
          courseId: ids.publishedCourse,
          question: 'What does the course say about JWT authentication?',
          source: 'service-test',
        }),
        (error) => error.code === 'QA_ATLAS_NOT_READY',
      );
    } finally {
      VideoSegment.aggregate = originalAggregate;
      global.fetch = originalFetch;
    }
  });
});
