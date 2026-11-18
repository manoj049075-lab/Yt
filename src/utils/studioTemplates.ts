export interface EditingTemplate {
  id: string;
  name: string;
  subtitle: string;
  captionStyle: 'bold-pop' | 'clean-box' | 'headline-bar' | 'kinetic-story' | 'cinema-serif';
  captionPosition: 'bottom' | 'center' | 'lower-third';
  accentColor: string;
  badgeText: string;
  headerBanner: boolean;
  frameTone: string;
}

export const EDITING_TEMPLATES: EditingTemplate[] = [
  {
    id: 'viral-hook-bold',
    name: 'Viral Hook Bold',
    subtitle: 'Top hook headline banner, dynamic punch-in crop, high-contrast word captions',
    captionStyle: 'bold-pop',
    captionPosition: 'center',
    accentColor: '#DC2626',
    badgeText: 'SHORTS HOOK',
    headerBanner: true,
    frameTone: '#111827',
  },
  {
    id: 'podcast-split',
    name: 'Podcast Split-Screen',
    subtitle: 'Speaker framing with clean lower-third editorial captions and warm LUT',
    captionStyle: 'clean-box',
    captionPosition: 'lower-third',
    accentColor: '#D97706',
    badgeText: 'HIGHLIGHT CLIP',
    headerBanner: false,
    frameTone: '#1C1917',
  },
  {
    id: 'newsroom-kinetic',
    name: 'Minimal Newsroom',
    subtitle: 'Crisp upper source ticker, balanced typography, high-legibility subtitle strip',
    captionStyle: 'headline-bar',
    captionPosition: 'bottom',
    accentColor: '#2563EB',
    badgeText: 'KEY MOMENT',
    headerBanner: true,
    frameTone: '#0F172A',
  },
  {
    id: 'animation-2d-story',
    name: '2D Motion Explainer',
    subtitle: 'Vector scene backdrop, animated props & character motions, story subtitles',
    captionStyle: 'kinetic-story',
    captionPosition: 'lower-third',
    accentColor: '#16A34A',
    badgeText: '2D STORY',
    headerBanner: true,
    frameTone: '#1E293B',
  },
  {
    id: 'cinematic-faceless',
    name: 'Cinematic Faceless',
    subtitle: 'Subtle film vignette, atmospheric contrast, crisp centered narration text',
    captionStyle: 'cinema-serif',
    captionPosition: 'center',
    accentColor: '#B91C1C',
    badgeText: 'STORY REEL',
    headerBanner: false,
    frameTone: '#09090B',
  },
];

export interface CopyrightFreeOption {
  id: string;
  label: string;
  detail: string;
}

export const COPYRIGHT_FREE_OPTIONS: CopyrightFreeOption[] = [
  { id: 'pitch_shift', label: 'Audio Pitch & Tempo Shift (+2.5%)', detail: 'Alters audio waveform signature cleanly' },
  { id: 'dynamic_zoom', label: 'Dynamic 9:16 Smart Pan & Zoom', detail: 'Reframes widescreen to vertical with motion' },
  { id: 'color_lut', label: 'Editorial Color Grade LUT', detail: 'Applies contrast, saturation & tone curve' },
  { id: 'mirror_flip', label: 'Horizontal Mirror Flip', detail: 'Flips visual frame orientation safely' },
  { id: 'caption_burn', label: 'Auto-Synced AI Captions', detail: 'Burns Hindi / Hinglish / English captions' },
  { id: 'ambient_bed', label: 'Royalty-Free Music Bed', detail: 'Mixes subtle copyright-free background beat' },
];

export interface AnimationStylePreset {
  id: 'flat_vector' | 'whiteboard' | 'motion_comic' | 'chibi_story';
  name: string;
  description: string;
  bgColor: string;
  fgColor: string;
  accentColor: string;
}

export const ANIMATION_STYLES: AnimationStylePreset[] = [
  {
    id: 'flat_vector',
    name: 'Flat Vector Story',
    description: 'Clean geometric characters, smooth motion paths, modern SaaS/explainer look',
    bgColor: '#0F172A',
    fgColor: '#F8FAFC',
    accentColor: '#DC2626',
  },
  {
    id: 'whiteboard',
    name: 'Whiteboard Explainer',
    description: 'Crisp paper canvas with animated ink sketches and step-by-step callouts',
    bgColor: '#F8FAFC',
    fgColor: '#0F172A',
    accentColor: '#2563EB',
  },
  {
    id: 'motion_comic',
    name: 'Motion Comic Panels',
    description: 'Bold framed comic panels with camera zoom and dramatic caption banners',
    bgColor: '#18181B',
    fgColor: '#FAFAFA',
    accentColor: '#D97706',
  },
  {
    id: 'chibi_story',
    name: '2D Character Dialogue',
    description: 'Expressive animated characters with speech bubbles and floating props',
    bgColor: '#1E293B',
    fgColor: '#F1F5F9',
    accentColor: '#16A34A',
  },
];
