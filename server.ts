import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GoogleGenAI, Type } from '@google/genai';
import ytdl from '@distube/ytdl-core';
import {
  extractYouTubeVideoId,
  clampClipRange,
  buildCopyrightFreeFilterPlan,
  formatSecondsToTimestamp,
} from './src/utils/youtube.ts';

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT) || 3000;
const RENDER_DIR = path.join(os.tmpdir(), 'clippulse-renders');
const UPLOAD_DIR = path.join(os.tmpdir(), 'clippulse-uploads');

fs.mkdirSync(RENDER_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the server environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

interface TranscriptCue {
  startSec: number;
  endSec: number;
  text: string;
}

interface HeatmapPeak {
  startSec: number;
  endSec: number;
  intensity: number;
}

interface ScrapedYouTubeContext {
  videoId: string;
  title: string;
  author: string;
  durationSec: number;
  viewCount: number;
  isLiveContent: boolean;
  thumbnailUrl: string;
  description: string;
  heatmapPeaks: HeatmapPeak[];
  transcriptCues: TranscriptCue[];
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBalancedJson(source: string, marker: string): string | null {
  const idx = source.indexOf(marker);
  if (idx === -1) return null;
  const braceStart = source.indexOf('{', idx + marker.length);
  if (braceStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(braceStart, i + 1);
      }
    }
  }
  return null;
}

async function fetchYouTubeContext(videoId: string): Promise<ScrapedYouTubeContext> {
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const fallbackThumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  let title = `YouTube Video (${videoId})`;
  let author = 'YouTube Creator';
  let durationSec = 420;
  let viewCount = 0;
  let isLiveContent = false;
  let description = '';
  const heatmapPeaks: HeatmapPeak[] = [];
  const transcriptCues: TranscriptCue[] = [];

  // 1. oEmbed metadata (reliable title + author + thumbnail)
  try {
    const oembedRes = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`,
      { signal: AbortSignal.timeout(7000) }
    );
    if (oembedRes.ok) {
      const oembed = (await oembedRes.json()) as {
        title?: string;
        author_name?: string;
      };
      if (oembed.title) title = oembed.title;
      if (oembed.author_name) author = oembed.author_name;
    }
  } catch {
    // Continue to watch page scrape
  }

  // 2. Watch page HTML scrape for duration, views, heatmap ("Most Replayed"), and captions
  try {
    const pageRes = await fetch(canonicalUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8',
      },
      signal: AbortSignal.timeout(9000),
    });

    if (pageRes.ok) {
      const html = await pageRes.text();
      const playerJsonStr = extractBalancedJson(html, 'ytInitialPlayerResponse =');
      if (playerJsonStr) {
        const player = JSON.parse(playerJsonStr) as {
          videoDetails?: {
            title?: string;
            author?: string;
            lengthSeconds?: string;
            viewCount?: string;
            isLiveContent?: boolean;
            shortDescription?: string;
          };
          captions?: {
            playerCaptionsTracklistRenderer?: {
              captionTracks?: Array<{ baseUrl?: string; languageCode?: string }>;
            };
          };
        };

        if (player.videoDetails) {
          title = player.videoDetails.title || title;
          author = player.videoDetails.author || author;
          durationSec = Number.parseInt(player.videoDetails.lengthSeconds || '0', 10) || durationSec;
          viewCount = Number.parseInt(player.videoDetails.viewCount || '0', 10) || 0;
          isLiveContent = Boolean(player.videoDetails.isLiveContent);
          description = (player.videoDetails.shortDescription || '').slice(0, 1800);
        }

        const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
        const preferredTrack =
          tracks.find((t) => t.languageCode === 'hi') ??
          tracks.find((t) => t.languageCode?.startsWith('en')) ??
          tracks[0];

        if (preferredTrack?.baseUrl) {
          try {
            const capRes = await fetch(preferredTrack.baseUrl, { signal: AbortSignal.timeout(6000) });
            if (capRes.ok) {
              const xml = await capRes.text();
              const textRegex = /<text start="([^"]+)" dur="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g;
              let match: RegExpExecArray | null;
              while ((match = textRegex.exec(xml)) !== null) {
                const start = Number.parseFloat(match[1]);
                const dur = Number.parseFloat(match[2]);
                const text = decodeHtmlEntities(match[3]);
                if (!Number.isNaN(start) && text) {
                  transcriptCues.push({
                    startSec: Math.floor(start),
                    endSec: Math.ceil(start + (Number.isNaN(dur) ? 3 : dur)),
                    text,
                  });
                }
                if (transcriptCues.length >= 160) break;
              }
            }
          } catch {
            // Transcript fetch optional
          }
        }
      }

      // Extract Most Replayed Heatmap peaks from ytInitialData if available
      const dataJsonStr = extractBalancedJson(html, 'ytInitialData =');
      if (dataJsonStr) {
        const markerMatches = [
          ...dataJsonStr.matchAll(
            /"heatMarkerRenderer":\{"timeRangeStartMillis":(\d+),"markerDurationMillis":(\d+),"heatMarkerIntensityScoreNormalized":([0-9.]+)\}/g
          ),
        ];
        const parsedPeaks: HeatmapPeak[] = markerMatches
          .map((m) => ({
            startSec: Math.floor(Number(m[1]) / 1000),
            endSec: Math.ceil((Number(m[1]) + Number(m[2])) / 1000),
            intensity: Number(m[3]),
          }))
          .filter((p) => p.intensity >= 0.45)
          .sort((a, b) => b.intensity - a.intensity)
          .slice(0, 8);
        heatmapPeaks.push(...parsedPeaks);
      }
    }
  } catch {
    // Continue with oEmbed data
  }

  return {
    videoId,
    title,
    author,
    durationSec,
    viewCount,
    isLiveContent,
    thumbnailUrl: fallbackThumb,
    description,
    heatmapPeaks,
    transcriptCues,
  };
}

function writeSrtFile(
  srtPath: string,
  captions: Array<{ startOffsetSec: number; endOffsetSec: number; text: string }>
): void {
  const toSrtTime = (sec: number) => {
    const ms = Math.max(0, Math.round(sec * 1000));
    const hrs = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    const remMs = ms % 1000;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(remMs).padStart(3, '0')}`;
  };

  const lines = captions
    .filter((c) => c.text.trim().length > 0)
    .map((c, idx) => `${idx + 1}\n${toSrtTime(c.startOffsetSec)} --> ${toSrtTime(c.endOffsetSec)}\n${c.text.trim()}\n`)
    .join('\n');

  fs.writeFileSync(srtPath, lines || '1\n00:00:00,000 --> 00:00:04,000\nClipPulse Shorts Highlight\n', 'utf8');
}

function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '')
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .slice(0, 56);
}

async function createFallbackImagePng(videoId: string, outPath: string): Promise<boolean> {
  const thumbUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  try {
    const res = await fetch(thumbUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(outPath, buf);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '60mb' }));

  app.get('/api/health', async (_req, res) => {
    let ffmpegOk = false;
    try {
      await execFileAsync('ffmpeg', ['-version']);
      ffmpegOk = true;
    } catch {
      ffmpegOk = false;
    }
    res.json({ ok: true, ffmpeg: ffmpegOk, hasGeminiKey: Boolean(process.env.GEMINI_API_KEY) });
  });

  // 1. Analyze YouTube Video / Livestream Link & Detect High-Retention Short Clips
  app.post('/api/youtube/analyze-source', async (req, res) => {
    try {
      const { url, maxDurationSec = 45, language = 'hinglish', preferredTemplate = 'viral-hook-bold' } = req.body as {
        url?: string;
        maxDurationSec?: number;
        language?: string;
        preferredTemplate?: string;
      };

      const videoId = extractYouTubeVideoId(url || '');
      if (!videoId) {
        return res.status(400).json({ error: 'Invalid YouTube video or livestream URL. Please paste a valid youtube.com or youtu.be link.' });
      }

      const safeMaxSec = Math.max(15, Math.min(60, Number(maxDurationSec) || 45));
      const context = await fetchYouTubeContext(videoId);
      const ai = getAiClient();

      const transcriptPreview =
        context.transcriptCues.length > 0
          ? context.transcriptCues
              .slice(0, 90)
              .map((c) => `[${formatSecondsToTimestamp(c.startSec)}] ${c.text}`)
              .join('\n')
          : 'No closed captions track was publicly exposed on this video. Use title, description, video duration, and Most Replayed heatmap timestamps.';

      const heatmapPreview =
        context.heatmapPeaks.length > 0
          ? context.heatmapPeaks
              .map((p) => `${formatSecondsToTimestamp(p.startSec)}-${formatSecondsToTimestamp(p.endSec)} (intensity ${(p.intensity * 100).toFixed(0)}%)`)
              .join(', ')
          : 'No public heatmap data; distribute picks across early hook, mid-video climax, and key takeaway segments.';

      const prompt = `You are an expert YouTube Shorts producer and viral video editor.
Analyze this real YouTube ${context.isLiveContent ? 'Livestream VOD' : 'Video'} and pick 3 distinct high-retention vertical Short clips.

Video Title: ${context.title}
Creator Channel: ${context.author}
Total Duration Seconds: ${context.durationSec}
View Count: ${context.viewCount}
Most Replayed Heatmap Peaks: ${heatmapPreview}
Description Snippet: ${context.description.slice(0, 800)}
Transcript Cues:
${transcriptPreview}

Rules:
1. Every clip duration (endSec - startSec) MUST be between 15 and ${safeMaxSec} seconds (strictly <= ${safeMaxSec}s).
2. All startSec and endSec values MUST fit within 0 to ${Math.max(60, context.durationSec)}.
3. Prefer timestamps matching Most Replayed peaks or strongest hooks/insights in the transcript.
4. Generate captions in ${language === 'hi' ? 'Hindi (Devanagari)' : language === 'hinglish' ? 'Hinglish (natural conversational Hindi-English)' : 'English'}, split into 4-6 crisp timed caption cues relative to the clip start (0 to durationSec).
5. Suggest an editing template id from: viral-hook-bold, podcast-split, newsroom-kinetic, animation-2d-story, cinematic-faceless (default preference: ${preferredTemplate}).
6. Write a catchy YouTube Shorts title (max 85 chars with #Shorts) and SEO description.`;

      const aiRes = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              clips: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    hookLine: { type: Type.STRING },
                    startSec: { type: Type.NUMBER },
                    endSec: { type: Type.NUMBER },
                    viralScore: { type: Type.NUMBER },
                    reason: { type: Type.STRING },
                    suggestedTemplate: { type: Type.STRING },
                    seoDescription: { type: Type.STRING },
                    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                    captions: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          startOffsetSec: { type: Type.NUMBER },
                          endOffsetSec: { type: Type.NUMBER },
                          text: { type: Type.STRING },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      const parsed = JSON.parse(aiRes.text || '{"clips": []}') as {
        clips?: Array<{
          title: string;
          hookLine: string;
          startSec: number;
          endSec: number;
          viralScore: number;
          reason: string;
          suggestedTemplate: string;
          seoDescription: string;
          tags: string[];
          captions: Array<{ startOffsetSec: number; endOffsetSec: number; text: string }>;
        }>;
      };

      const normalizedClips = (parsed.clips ?? []).slice(0, 4).map((c, idx) => {
        const range = clampClipRange(c.startSec, c.endSec, safeMaxSec, context.durationSec);
        return {
          id: `clip-${videoId}-${idx + 1}-${crypto.randomBytes(2).toString('hex')}`,
          title: (c.title || `${context.title.slice(0, 55)} #Shorts`).slice(0, 100),
          hookLine: (c.hookLine || 'Most Replayed Highlight').slice(0, 70),
          startSec: range.startSec,
          endSec: range.endSec,
          durationSec: range.durationSec,
          viralScore: Math.min(99, Math.max(72, Math.round(c.viralScore || 88))),
          reason: c.reason || 'High audience retention moment',
          suggestedTemplate: c.suggestedTemplate || preferredTemplate,
          seoDescription: (c.seoDescription || `${context.title}\n\n#Shorts #YouTubeShorts`).slice(0, 1500),
          tags: (c.tags ?? ['Shorts', 'Viral', 'Highlights']).slice(0, 8),
          captions: (c.captions ?? []).map((cap, capIdx) => ({
            startOffsetSec: Math.max(0, Math.min(range.durationSec - 1, Number(cap.startOffsetSec ?? capIdx * 4))),
            endOffsetSec: Math.max(1, Math.min(range.durationSec, Number(cap.endOffsetSec ?? (capIdx + 1) * 4))),
            text: String(cap.text ?? '').trim(),
          })),
        };
      });

      return res.json({
        source: context,
        clips: normalizedClips,
      });
    } catch (error) {
      console.error('Analyze source error:', error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to analyze YouTube video link.',
      });
    }
  });

  // 2. Upload local source video (MP4/WebM) for real FFmpeg clipping
  app.post(
    '/api/video/upload-source',
    express.raw({ type: ['video/*', 'application/octet-stream'], limit: '80mb' }),
    (req, res) => {
      try {
        const bodyBuf = req.body as Buffer;
        if (!Buffer.isBuffer(bodyBuf) || bodyBuf.length === 0) {
          return res.status(400).json({ error: 'Empty video file payload.' });
        }
        const uploadId = `src-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
        const filePath = path.join(UPLOAD_DIR, `${uploadId}.mp4`);
        fs.writeFileSync(filePath, bodyBuf);
        return res.json({ uploadId, sizeBytes: bodyBuf.length });
      } catch (error) {
        return res.status(500).json({ error: error instanceof Error ? error.message : 'Upload failed' });
      }
    }
  );

  // 3. Render real 9:16 MP4 Short with FFmpeg (real YouTube stream or uploaded file, transparent fallback if YouTube blocks datacenter IP)
  app.post('/api/video/render-short', async (req, res) => {
    const tempFiles: string[] = [];
    try {
      const {
        videoId,
        uploadId,
        startSec = 0,
        endSec = 30,
        title = 'ClipPulse Short',
        hookLine = 'HIGHLIGHT CLIP',
        transforms = ['pitch_shift', 'dynamic_zoom', 'color_lut', 'caption_burn'],
        captions = [],
      } = req.body as {
        videoId?: string;
        uploadId?: string;
        startSec?: number;
        endSec?: number;
        title?: string;
        hookLine?: string;
        transforms?: string[];
        captions?: Array<{ startOffsetSec: number; endOffsetSec: number; text: string }>;
      };

      const range = clampClipRange(startSec, endSec, 60);
      const filterPlan = buildCopyrightFreeFilterPlan(transforms);
      const renderId = `short-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const outputFilename = `${renderId}.mp4`;
      const outputPath = path.join(RENDER_DIR, outputFilename);

      const srtPath = path.join(RENDER_DIR, `${renderId}.srt`);
      writeSrtFile(srtPath, captions);
      tempFiles.push(srtPath);

      let inputMediaPath: string | null = null;
      let renderMode: 'uploaded_source' | 'youtube_stream' | 'thumbnail_kenburns_render' = 'thumbnail_kenburns_render';
      let notice = '';

      if (uploadId) {
        const candidate = path.join(UPLOAD_DIR, `${path.basename(uploadId)}.mp4`);
        if (fs.existsSync(candidate)) {
          inputMediaPath = candidate;
          renderMode = 'uploaded_source';
        }
      }

      if (!inputMediaPath && videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        const downloadedPath = path.join(RENDER_DIR, `${renderId}-raw.mp4`);
        try {
          const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
          const info = await ytdl.getInfo(watchUrl, {
            requestOptions: {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              },
            },
          });
          const format = ytdl.chooseFormat(info.formats, {
            quality: 'lowestvideo',
            filter: (f) => Boolean(f.hasVideo && f.hasAudio && f.container === 'mp4'),
          });
          if (format?.url) {
            await new Promise<void>((resolve, reject) => {
              const stream = ytdl.downloadFromInfo(info, { format });
              const out = fs.createWriteStream(downloadedPath);
              const timer = setTimeout(() => {
                stream.destroy();
                reject(new Error('YouTube stream download timed out'));
              }, 16000);
              stream.pipe(out);
              out.on('finish', () => {
                clearTimeout(timer);
                resolve();
              });
              stream.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
              });
            });
            if (fs.existsSync(downloadedPath) && fs.statSync(downloadedPath).size > 10240) {
              inputMediaPath = downloadedPath;
              tempFiles.push(downloadedPath);
              renderMode = 'youtube_stream';
            }
          }
        } catch (dlErr) {
          notice = `Direct YouTube video stream download was restricted by YouTube bot-protection (${dlErr instanceof Error ? dlErr.message.slice(0, 90) : '403'}); rendered a 9:16 storyboard MP4 with burned captions and copyright-free audio bed. You can also upload any local MP4 file for direct FFmpeg clipping.`;
        }
      }

      const escapedSrt = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
      const headerLabel = escapeDrawtext(hookLine || title);

      if (inputMediaPath) {
        const vfParts = [
          filterPlan.ffmpegVideoFilter,
          `drawbox=x=36:y=56:w=648:h=68:color=black@0.68:t=fill`,
          `drawtext=text='${headerLabel}':fontcolor=white:fontsize=26:x=(w-text_w)/2:y=78`,
        ];
        if (transforms.includes('caption_burn')) {
          vfParts.push(
            `subtitles='${escapedSrt}':force_style='Fontsize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3,Outline=2,Alignment=2,MarginV=120'`
          );
        }

        const args = [
          '-y',
          '-ss',
          String(renderMode === 'youtube_stream' ? range.startSec : Math.min(range.startSec, 5)),
          '-t',
          String(range.durationSec),
          '-i',
          inputMediaPath,
          '-vf',
          vfParts.join(','),
          '-af',
          filterPlan.ffmpegAudioFilter,
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-crf',
          '26',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-movflags',
          '+faststart',
          outputPath,
        ];
        await execFileAsync('ffmpeg', args, { timeout: 45000 });
      } else {
        // Build crisp 9:16 MP4 from real YouTube thumbnail + animated Ken Burns pan + burned captions + copyright-free synth pad
        const thumbPath = path.join(RENDER_DIR, `${renderId}-thumb.jpg`);
        const hasThumb = videoId ? await createFallbackImagePng(videoId, thumbPath) : false;
        if (hasThumb) tempFiles.push(thumbPath);

        const dur = Math.min(20, Math.max(8, range.durationSec));
        const vfFallback = [
          `scale=1080:1920:force_original_aspect_ratio=increase,crop=720:1280:(iw-720)/2+sin(t*0.8)*20:(ih-1280)/2`,
          transforms.includes('color_lut') ? 'eq=contrast=1.08:saturation=1.15' : 'eq=contrast=1.02',
          `drawbox=x=36:y=56:w=648:h=72:color=black@0.72:t=fill`,
          `drawtext=text='${headerLabel}':fontcolor=white:fontsize=26:x=(w-text_w)/2:y=78`,
          `subtitles='${escapedSrt}':force_style='Fontsize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3,Outline=2,Alignment=2,MarginV=140'`,
        ].join(',');

        const args = hasThumb
          ? [
              '-y',
              '-loop',
              '1',
              '-t',
              String(dur),
              '-i',
              thumbPath,
              '-f',
              'lavfi',
              '-t',
              String(dur),
              '-i',
              'sine=frequency=220:sample_rate=44100',
              '-vf',
              vfFallback,
              '-af',
              'volume=0.05,lowpass=f=480',
              '-c:v',
              'libx264',
              '-preset',
              'ultrafast',
              '-pix_fmt',
              'yuv420p',
              '-c:a',
              'aac',
              '-shortest',
              '-movflags',
              '+faststart',
              outputPath,
            ]
          : [
              '-y',
              '-f',
              'lavfi',
              '-t',
              String(dur),
              '-i',
              'color=c=#0f172a:s=720x1280:r=24',
              '-f',
              'lavfi',
              '-t',
              String(dur),
              '-i',
              'sine=frequency=220:sample_rate=44100',
              '-vf',
              `drawtext=text='${headerLabel}':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=160,subtitles='${escapedSrt}'`,
              '-af',
              'volume=0.05',
              '-c:v',
              'libx264',
              '-preset',
              'ultrafast',
              '-pix_fmt',
              'yuv420p',
              '-c:a',
              'aac',
              '-shortest',
              outputPath,
            ];

        await execFileAsync('ffmpeg', args, { timeout: 30000 });
      }

      for (const f of tempFiles) {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }

      return res.json({
        renderFilename: outputFilename,
        renderUrl: `/api/renders/${outputFilename}`,
        renderMode,
        filterSummary: filterPlan.summary,
        notice,
      });
    } catch (error) {
      for (const f of tempFiles) {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
      console.error('Render short error:', error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'FFmpeg render failed',
      });
    }
  });

  // 4. Serve rendered MP4 files with Range support
  app.get('/api/renders/:filename', (req, res) => {
    const safeName = path.basename(req.params.filename || '');
    const filePath = path.join(RENDER_DIR, safeName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Rendered file not found' });
    }
    const stat = fs.statSync(filePath);
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = Number.parseInt(parts[0], 10);
      const end = parts[1] ? Number.parseInt(parts[1], 10) : stat.size - 1;
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  // 5. Generate 2D Animated Short Storyboard + Voiceover TTS
  app.post('/api/ai/generate-2d-animation', async (req, res) => {
    try {
      const {
        topic,
        style = 'flat_vector',
        durationSec = 30,
        language = 'hinglish',
        includeVoiceover = true,
      } = req.body as {
        topic?: string;
        style?: string;
        durationSec?: number;
        language?: string;
        includeVoiceover?: boolean;
      };

      if (!topic || !topic.trim()) {
        return res.status(400).json({ error: 'Please provide a topic or story prompt for the 2D animation.' });
      }

      const safeDur = Math.max(15, Math.min(60, Number(durationSec) || 30));
      const sceneCount = Math.max(3, Math.min(6, Math.round(safeDur / 6)));
      const ai = getAiClient();

      const prompt = `Create a structured 2D animated YouTube Short storyboard (${safeDur} seconds total, ${sceneCount} scenes).
Topic: ${topic.trim()}
Visual Style: ${style}
Caption & Narration Language: ${language === 'hi' ? 'Hindi' : language === 'hinglish' ? 'Hinglish (Hindi + English mix)' : 'English'}

For each scene, define:
- sceneTitle (short label)
- durationSec (sum of all scenes = ${safeDur})
- captionText (concise punchy caption 6-14 words for on-screen display & voiceover)
- visualAction (enum: "walk_in", "point_chart", "celebrate", "think_idea", "rocket_launch", "split_compare")
- propType (enum: "chart_up", "lightbulb", "coin_stack", "phone_screen", "clock", "trophy")
- cameraMotion (enum: "zoom_in", "pan_left", "pan_right", "pulse")
- bgTint (hex color matching dark/editorial palette or light whiteboard if style is whiteboard)

Also generate:
- title (catchy YouTube Shorts title with #Shorts, max 85 chars)
- seoDescription (YouTube description with hashtags)
- narrationScript (smooth single-paragraph voiceover script connecting the scenes)`;

      const aiRes = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              seoDescription: { type: Type.STRING },
              narrationScript: { type: Type.STRING },
              scenes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    sceneTitle: { type: Type.STRING },
                    durationSec: { type: Type.NUMBER },
                    captionText: { type: Type.STRING },
                    visualAction: { type: Type.STRING },
                    propType: { type: Type.STRING },
                    cameraMotion: { type: Type.STRING },
                    bgTint: { type: Type.STRING },
                  },
                },
              },
            },
          },
        },
      });

      const storyboard = JSON.parse(aiRes.text || '{}') as {
        title?: string;
        seoDescription?: string;
        narrationScript?: string;
        scenes?: Array<{
          sceneTitle: string;
          durationSec: number;
          captionText: string;
          visualAction: string;
          propType: string;
          cameraMotion: string;
          bgTint: string;
        }>;
      };

      let voiceoverAudioDataUrl: string | null = null;
      let ttsWarning: string | null = null;

      if (includeVoiceover && storyboard.narrationScript) {
        try {
          const ttsRes = await ai.models.generateContent({
            model: 'gemini-3.8-flash-lite-tts',
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: storyboard.narrationScript.slice(0, 600),
                    speechMetadata: {
                      style: 'Energetic, clear YouTube Shorts narrator',
                    },
                  },
                ],
              },
            ],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: 'Kore' },
                },
              },
            },
          });

          const base64Audio = ttsRes.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
          if (base64Audio) {
            voiceoverAudioDataUrl = `data:audio/wav;base64,${base64Audio}`;
          }
        } catch (ttsErr) {
          ttsWarning = ttsErr instanceof Error ? ttsErr.message : 'TTS audio skipped';
        }
      }

      return res.json({
        title: storyboard.title || `${topic.slice(0, 60)} #Shorts`,
        seoDescription: storyboard.seoDescription || `${topic}\n\n#Shorts #2DAnimation`,
        narrationScript: storyboard.narrationScript || '',
        scenes: (storyboard.scenes ?? []).slice(0, 6),
        voiceoverAudioDataUrl,
        ttsWarning,
      });
    } catch (error) {
      console.error('2D animation generation error:', error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to generate 2D animation storyboard.',
      });
    }
  });

  // 6. Fetch Authenticated User's Real YouTube Channels via OAuth Access Token
  app.post('/api/youtube/channels', async (req, res) => {
    try {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!token) {
        return res.status(401).json({ error: 'Missing Google OAuth Bearer token.' });
      }

      const ytRes = await fetch(
        'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true',
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(8000),
        }
      );

      const data = await ytRes.json();
      if (!ytRes.ok) {
        return res.status(ytRes.status).json({
          error: data?.error?.message || 'Failed to read YouTube channels from Google API.',
        });
      }

      const items = (data.items ?? []).map((item: any) => ({
        youtubeChannelId: item.id,
        title: item.snippet?.title || 'YouTube Channel',
        handle: item.snippet?.customUrl || `@${(item.snippet?.title || 'channel').toLowerCase().replace(/\s+/g, '')}`,
        thumbnailUrl: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || '',
        subscriberCount: item.statistics?.subscriberCount || '0',
      }));

      return res.json({ channels: items });
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch YouTube channels.',
      });
    }
  });

  // 7. Real YouTube Data API v3 Resumable Video Upload (Immediate or Scheduled via publishAt)
  app.post('/api/youtube/upload', async (req, res) => {
    try {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!token) {
        return res.status(401).json({ error: 'Google YouTube OAuth sign-in is required to upload videos.' });
      }

      const {
        renderFilename,
        videoBase64,
        mimeType = 'video/mp4',
        title,
        description = '#Shorts',
        tags = ['Shorts'],
        privacyStatus = 'private',
        publishAt,
      } = req.body as {
        renderFilename?: string;
        videoBase64?: string;
        mimeType?: string;
        title?: string;
        description?: string;
        tags?: string[];
        privacyStatus?: 'private' | 'unlisted' | 'public';
        publishAt?: string;
      };

      if (!title) {
        return res.status(400).json({ error: 'Video title is required for YouTube upload.' });
      }

      let videoBuffer: Buffer | null = null;
      let contentType = mimeType;

      if (renderFilename) {
        const filePath = path.join(RENDER_DIR, path.basename(renderFilename));
        if (fs.existsSync(filePath)) {
          videoBuffer = fs.readFileSync(filePath);
          contentType = 'video/mp4';
        }
      } else if (videoBase64) {
        const cleaned = videoBase64.includes(',') ? videoBase64.split(',')[1] : videoBase64;
        videoBuffer = Buffer.from(cleaned, 'base64');
      }

      if (!videoBuffer || videoBuffer.length === 0) {
        return res.status(400).json({ error: 'No rendered video buffer found. Please render the Short clip or export the 2D animation first.' });
      }

      const statusPayload: Record<string, unknown> = {
        privacyStatus: publishAt ? 'private' : privacyStatus,
        selfDeclaredMadeForKids: false,
      };
      if (publishAt) {
        statusPayload.publishAt = publishAt;
      }

      const initRes = await fetch(
        'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Length': String(videoBuffer.length),
            'X-Upload-Content-Type': contentType,
          },
          body: JSON.stringify({
            snippet: {
              title: title.slice(0, 100),
              description: description.slice(0, 4000),
              tags: tags.slice(0, 10),
              categoryId: '22',
            },
            status: statusPayload,
          }),
        }
      );

      if (!initRes.ok) {
        const errBody = await initRes.json().catch(() => ({}));
        return res.status(initRes.status).json({
          error: errBody?.error?.message || `YouTube upload init failed (${initRes.status})`,
        });
      }

      const uploadUrl = initRes.headers.get('location');
      if (!uploadUrl) {
        return res.status(502).json({ error: 'YouTube did not return a resumable upload location header.' });
      }

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(videoBuffer.length),
          'Content-Type': contentType,
        },
        body: new Uint8Array(videoBuffer),
      });

      const uploadedData = await putRes.json().catch(() => ({}));
      if (!putRes.ok) {
        return res.status(putRes.status).json({
          error: uploadedData?.error?.message || `YouTube binary upload failed (${putRes.status})`,
        });
      }

      return res.json({
        youtubeVideoId: uploadedData.id,
        watchUrl: `https://youtube.com/shorts/${uploadedData.id}`,
        status: uploadedData.status,
      });
    } catch (error) {
      console.error('YouTube upload error:', error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to upload to YouTube.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ClipPulse Studio server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
