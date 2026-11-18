export type SourceType = 'youtube_url' | 'livestream' | '2d_animation' | 'uploaded_file';
export type JobStatus = 'draft' | 'rendered' | 'scheduled' | 'published' | 'failed';
export type CaptionLanguage = 'hi' | 'en' | 'hinglish';

export interface StudioChannel {
  id: string;
  ownerId: string;
  youtubeChannelId: string;
  title: string;
  handle: string;
  thumbnailUrl: string;
  subscriberCount: string;
  isOAuthConnected: boolean;
  videosPerDay: number;
  postingSlots: string[];
  preferredTemplate: string;
  maxClipDuration: number;
  automationMonths: number;
  automationActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CaptionCue {
  startOffsetSec: number;
  endOffsetSec: number;
  text: string;
}

export interface ExtractedClipCandidate {
  id: string;
  title: string;
  hookLine: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  viralScore: number;
  reason: string;
  suggestedTemplate: string;
  seoDescription: string;
  tags: string[];
  captions: CaptionCue[];
  renderFilename?: string;
  renderUrl?: string;
  renderMode?: string;
  notice?: string;
}

export interface SourceVideoContext {
  videoId: string;
  title: string;
  author: string;
  durationSec: number;
  viewCount: number;
  isLiveContent: boolean;
  thumbnailUrl: string;
  description: string;
  heatmapPeaks: Array<{ startSec: number; endSec: number; intensity: number }>;
  transcriptCues: Array<{ startSec: number; endSec: number; text: string }>;
}

export interface AnimationScene {
  sceneTitle: string;
  durationSec: number;
  captionText: string;
  visualAction: 'walk_in' | 'point_chart' | 'celebrate' | 'think_idea' | 'rocket_launch' | 'split_compare' | string;
  propType: 'chart_up' | 'lightbulb' | 'coin_stack' | 'phone_screen' | 'clock' | 'trophy' | string;
  cameraMotion: 'zoom_in' | 'pan_left' | 'pan_right' | 'pulse' | string;
  bgTint: string;
}

export interface AnimationStoryboard {
  title: string;
  seoDescription: string;
  narrationScript: string;
  scenes: AnimationScene[];
  voiceoverAudioDataUrl: string | null;
  ttsWarning?: string | null;
}

export interface AutomationJob {
  id: string;
  ownerId: string;
  channelId: string;
  sourceType: SourceType;
  sourceUrl?: string;
  sourceTitle: string;
  sourceVideoId?: string;
  clipStartSec: number;
  clipEndSec: number;
  durationSec: number;
  templateId: string;
  copyrightFreeTransforms: string[];
  captionsPayload?: string;
  title: string;
  description?: string;
  scheduledAt: string;
  status: JobStatus;
  youtubeVideoId?: string;
  renderPath?: string;
  createdAt?: string;
  updatedAt?: string;
}
