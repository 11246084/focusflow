const assert = require('node:assert/strict');
const { beforeEach, describe, it } = require('node:test');
const { askQuestion } = require('../src/services/qa.service');
const env = require('../src/config/env');
const VideoSegment = require('../src/models/videoSegment.model');
const {
  ids,
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
  env.geminiApiKey = '';
  env.openaiApiKey = '';
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
      videoId: ids.publishedVideoExternal,
      startSec: 60,
      endSec: 85,
      transcript: 'This segment mentions JWT once.',
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

  it('normalizes snake_case segments and falls back to course video_id whitelist when courseId is missing', async () => {
    store.videoSegments.push(
      {
        _id: 'segment-snake-allowed-id',
        segment_id: ids.snakeCaseSegment,
        video_id: ids.publishedVideoExternal,
        start_sec: 84,
        end_sec: 118,
        text: 'Atlas bridge whitelisttoken aligns text segments by filtering with the course video whitelist.',
        embedding: [],
      },
      {
        _id: 'segment-snake-foreign-id',
        segment_id: 'segment-snake-foreign',
        video_id: 'video-foreign-999',
        start_sec: 84,
        end_sec: 118,
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
    assert.equal(result.matches[0].videoId, ids.publishedVideoExternal);
    assert.equal(result.matches[0].startSec, 84);
    assert.equal(result.matches[0].endSec, 118);
    assert.match(result.matches[0].transcript, /course video whitelist/i);
    assert.equal(result.matches.some((match) => match.segmentId === 'segment-snake-foreign'), false);
  });

  it('uses course.videoIds object ids to resolve videos.video_id when videos.courseId is missing', async () => {
    const publishedVideo = store.videos.find((video) => video._id === ids.publishedVideo);
    publishedVideo.courseId = null;

    store.videoSegments.length = 0;
    store.videoSegments.push(
      {
        _id: 'segment-course-videoids-only',
        segment_id: 'segment-course-videoids-only',
        video_id: ids.publishedVideoExternal,
        start_sec: 21,
        end_sec: 44,
        text: 'Course refs fallbacktoken bridges course video object ids to videos.video_id aliases.',
        embedding: [],
      },
      {
        _id: 'segment-course-videoids-foreign',
        segment_id: 'segment-course-videoids-foreign',
        video_id: 'video-foreign-999',
        start_sec: 21,
        end_sec: 44,
        text: 'Course refs fallbacktoken bridges course video object ids to videos.video_id aliases.',
        embedding: [],
      },
    );

    const result = await askQuestion({
      user: {
        id: ids.student,
        role: 'student',
      },
      courseId: ids.publishedCourse,
      question: 'How does fallbacktoken bridge course refs to video aliases?',
      source: 'service-test',
    });

    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].segmentId, 'segment-course-videoids-only');
    assert.equal(result.matches[0].videoId, ids.publishedVideoExternal);
  });

  it('maps videos.video_id to segments.videoId when the course only references the video object id', async () => {
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
        transcript: 'Aliasmap token keeps camelCase videoId segments reachable from videos.video_id documents.',
        embedding: [],
      },
      {
        _id: 'segment-videoid-foreign',
        segmentId: 'segment-videoid-foreign',
        videoId: 'video-foreign-999',
        startSec: 48,
        endSec: 73,
        transcript: 'Aliasmap token keeps camelCase videoId segments reachable from videos.video_id documents.',
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

    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].segmentId, 'segment-videoid-camel');
    assert.equal(result.matches[0].videoId, ids.publishedVideoExternal);
  });

  it('keeps mixed identifier segments inside the course scope and excludes foreign videos', async () => {
    const publishedVideo = store.videos.find((video) => video._id === ids.publishedVideo);
    publishedVideo.courseId = null;

    store.videoSegments.length = 0;
    store.videoSegments.push(
      {
        _id: 'segment-mixed-snake',
        segment_id: 'segment-mixed-snake',
        video_id: ids.publishedVideoExternal,
        start_sec: 12,
        end_sec: 28,
        text: 'Mixscope token keeps snake case aliases inside the course scope.',
        embedding: [],
      },
      {
        _id: 'segment-mixed-camel',
        segmentId: 'segment-mixed-camel',
        videoId: ids.publishedVideoExternal,
        startSec: 32,
        endSec: 49,
        transcript: 'Mixscope token also keeps camelCase aliases inside the course scope.',
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
      question: 'How does mixscope keep aliases inside the course scope?',
      source: 'service-test',
    });

    assert.deepEqual(
      result.matches.map((match) => match.segmentId).sort(),
      ['segment-mixed-camel', 'segment-mixed-snake'],
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
        video_id: ids.pipelineBridgeVideoExternal,
        start_sec: 144,
        end_sec: 178,
        text: 'Bridgecourse token lets QA scope a course onto pipeline metadata videos without rewriting the videos collection.',
        embedding: [],
      },
      {
        _id: 'segment-pipeline-foreign',
        video_id: 'video-pipeline-foreign-999',
        start_sec: 144,
        end_sec: 178,
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
    assert.equal(result.matches[0].videoId, ids.pipelineBridgeVideoExternal);
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
      video_id: ids.pipelineBridgeVideoExternal,
      start_sec: 4.53,
      end_sec: 32.62,
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
    assert.equal(result.matches[0].videoId, ids.pipelineBridgeVideoExternal);
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
    assert.equal(result.clip, null);
    assert.equal(result.runtime.status, 'degraded');
    assert.equal(result.runtime.degraded, true);
    assert.equal(result.runtime.matchStatus, 'no_searchable_segments');
    assert.equal(result.runtime.searchableSegmentCount, 0);
    assert.equal(result.runtime.degradedReasons.includes('NO_SEARCHABLE_SEGMENTS'), true);
    assert.equal(result.runtime.course.qaScopeOnly, true);
    assert.match(result.answer, /只有 bridge metadata/);
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

  it('surfaces atlas-not-ready errors instead of silently falling back to memory', async () => {
    const originalAggregate = VideoSegment.aggregate;

    env.qaQueryEmbeddingProvider = 'openai';
    env.openaiApiKey = 'openai-test-key';
    env.qaVectorSearchMode = 'atlas';
    env.qaAtlasVectorIndexName = 'text_embedding_index';
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
