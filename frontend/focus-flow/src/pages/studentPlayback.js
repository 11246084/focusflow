function extractYouTubeVideoId(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;

  const patterns = [
    /[?&]v=([^&#]+)/,
    /youtu\.be\/([^?&#/]+)/,
    /\/shorts\/([^?&#/]+)/,
    /\/embed\/([^?&#/]+)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  return null;
}

export function resolveVideoPlayback(video) {
  if (!video) return { type: 'none', youtubeId: null, videoUrl: null };

  const sourceType = String(video.videoSource || video.video_source || video.sourceType || '').toLowerCase();
  if (video.playbackSource?.type === 'unavailable') return { type: 'unavailable', youtubeId: null, videoUrl: null };
  const youtubeId = (
    extractYouTubeVideoId(video.youtubeVideoId)
    || extractYouTubeVideoId(video.youtube_video_id)
    || extractYouTubeVideoId(video.videoUrl)
    || extractYouTubeVideoId(video.video_url)
    || extractYouTubeVideoId(video.sourceUrl)
  );

  const legacyYoutubeUrl = !video.playbackSource && !video.videoSource && !video.video_source
    && [video.videoUrl, video.video_url, video.sourceUrl].some((url) => /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i.test(String(url || '')));
  if (youtubeId && (sourceType === 'youtube' || video.playbackSource?.type === 'youtube' || legacyYoutubeUrl || (!sourceType && !video.playbackSource))) {
    return { type: 'youtube', youtubeId, videoUrl: null };
  }

  if (sourceType === 'youtube' || video.metadataOnly || video.qaScopeOnly) {
    return { type: 'unavailable', youtubeId: null, videoUrl: null };
  }

  const sourceUrl = video.sourceUrl || video.videoUrl || video.video_url;
  if (!sourceUrl) return { type: 'none', youtubeId: null, videoUrl: null };

  const textUrl = String(sourceUrl);
  const videoUrl = textUrl.startsWith('/uploads/')
    ? textUrl
    : textUrl;

  return { type: 'upload', youtubeId: null, videoUrl };
}

// A source probe can outlive a course/video selection, including another index 0.
export async function recoverLocalPlayback({ videoId, probe, loadVideo, isCurrent }) {
  if (!isCurrent()) return null;
  const unavailable = { error: '影片準備中，可先提問。' };
  if (!videoId) return unavailable;
  try {
    const check = await probe(videoId);
    if (!isCurrent()) return null;
    if ([403, 404, 409].includes(check.status)) {
      const result = await loadVideo(videoId);
      if (!isCurrent()) return null;
      const refreshed = result.data?.video;
      if (refreshed && resolveVideoPlayback(refreshed).type === 'youtube') return { refreshed };
      if (check.status === 403) return { error: '目前沒有這門課程的觀看權限。' };
    }
  } catch (error) {
    if (!isCurrent()) return null;
    if (error.status === 403 || error.code === 'COURSE_ACCESS_DENIED') {
      return { error: '目前沒有這門課程的觀看權限。' };
    }
  }
  return unavailable;
}

