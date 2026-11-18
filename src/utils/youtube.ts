export interface ClipRange {
  startSec: number;
  endSec: number;
  durationSec: number;
}

export interface CopyrightFreeFilterPlan {
  ffmpegVideoFilter: string;
  ffmpegAudioFilter: string;
  summary: string[];
}

/**
 * Extracts a canonical 11-character YouTube Video ID from watch, youtu.be,
 * live, shorts, or embed URLs.
 */
export function extractYouTubeVideoId(rawUrl: string): string | null {
  const input = rawUrl.trim();
  if (!input) return null;

  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
    return input;
  }

  try {
    const normalized = input.startsWith('http') ? input : `https://${input}`;
    const url = new URL(normalized);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();

    if (host === 'youtu.be') {
      const seg = url.pathname.split('/').filter(Boolean)[0] ?? '';
      return /^[a-zA-Z0-9_-]{11}$/.test(seg) ? seg : null;
    }

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const vParam = url.searchParams.get('v');
      if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
        return vParam;
      }
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && ['live', 'shorts', 'embed', 'v'].includes(parts[0])) {
        const candidate = parts[1];
        return /^[a-zA-Z0-9_-]{11}$/.test(candidate) ? candidate : null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function formatSecondsToTimestamp(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function clampClipRange(
  startSec: number,
  endSec: number,
  maxDurationSec: number,
  videoDurationSec?: number
): ClipRange {
  const clampedMax = Math.max(5, Math.min(60, Math.round(maxDurationSec)));
  let safeStart = Math.max(0, Math.floor(startSec));
  if (typeof videoDurationSec === 'number' && videoDurationSec > 10) {
    safeStart = Math.min(safeStart, Math.max(0, Math.floor(videoDurationSec) - 5));
  }
  const desiredEnd = Math.max(safeStart + 5, Math.floor(endSec));
  let safeEnd = Math.min(desiredEnd, safeStart + clampedMax);
  if (typeof videoDurationSec === 'number' && videoDurationSec > 0) {
    safeEnd = Math.min(safeEnd, Math.floor(videoDurationSec));
  }
  if (safeEnd <= safeStart) {
    safeEnd = safeStart + Math.min(15, clampedMax);
  }
  return {
    startSec: safeStart,
    endSec: safeEnd,
    durationSec: safeEnd - safeStart,
  };
}

export function buildCopyrightFreeFilterPlan(transforms: string[]): CopyrightFreeFilterPlan {
  const set = new Set(transforms);
  const videoFilters: string[] = [];
  const audioFilters: string[] = [];
  const summary: string[] = [];

  // Always crop/scale to 9:16 vertical Shorts canvas (720x1280 for fast crisp encoding)
  if (set.has('dynamic_zoom')) {
    videoFilters.push('scale=1280:1280:force_original_aspect_ratio=increase,crop=720:1280:(iw-720)/2+sin(t*0.7)*18:(ih-1280)/2');
    summary.push('Dynamic 9:16 Pan & Zoom');
  } else {
    videoFilters.push('scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280');
    summary.push('9:16 Vertical Framing');
  }

  if (set.has('mirror_flip')) {
    videoFilters.push('hflip');
    summary.push('Horizontal Framing Flip');
  }

  if (set.has('color_lut')) {
    videoFilters.push('eq=contrast=1.06:saturation=1.12:brightness=0.02');
    summary.push('Editorial Color Grade LUT');
  }

  if (set.has('pitch_shift')) {
    // Micro-shift tempo +2.5% and pitch +2.5% for audio fingerprint transformation
    audioFilters.push('asetrate=44100*1.025,aresample=44100,atempo=0.985');
    summary.push('Audio Pitch & Tempo Shift (+2.5%)');
  }

  if (set.has('caption_burn')) {
    summary.push('Burned-in Synced Captions');
  }

  if (set.has('ambient_bed')) {
    summary.push('Royalty-Free Audio Bed');
  }

  return {
    ffmpegVideoFilter: videoFilters.join(','),
    ffmpegAudioFilter: audioFilters.length > 0 ? audioFilters.join(',') : 'anull',
    summary,
  };
}
