const fetch = require('node-fetch');

/**
 * Extracts the YouTube video ID from various URL formats:
 *   https://www.youtube.com/watch?v=dQw4w9WgXcQ
 *   https://youtu.be/dQw4w9WgXcQ
 *   https://www.youtube.com/shorts/dQw4w9WgXcQ
 *   https://m.youtube.com/watch?v=dQw4w9WgXcQ
 */
const extractYouTubeId = (url) => {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^(www\.|m\.)/, '');

    if (hostname === 'youtu.be') {
      return parsed.pathname.slice(1).split('?')[0];
    }

    if (hostname === 'youtube.com') {
      if (parsed.pathname.startsWith('/shorts/')) {
        return parsed.pathname.split('/shorts/')[1].split('?')[0];
      }
      return parsed.searchParams.get('v');
    }
  } catch {
    return null;
  }
  return null;
};

/**
 * Fetches video metadata using YouTube's oEmbed endpoint.
 * No API key required.
 */
const fetchYouTubeMetadata = async (videoUrl) => {
  const videoId = extractYouTubeId(videoUrl);
  if (!videoId) throw new Error('Invalid YouTube URL');

  const oEmbedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;

  const response = await fetch(oEmbedUrl);
  if (!response.ok) {
    throw new Error('Could not fetch video metadata. The video may be private or unavailable.');
  }

  const data = await response.json();

  return {
    videoId,
    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    title: data.title,
    thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    channelName: data.author_name || null,
  };
};

module.exports = { extractYouTubeId, fetchYouTubeMetadata };
