import React, { useState } from 'react';
import { Play, Download, Film, Sparkles } from 'lucide-react';
import type { ExtractedClipCandidate } from '../types/studio';
import { EDITING_TEMPLATES } from '../utils/studioTemplates';
import { formatSecondsToTimestamp } from '../utils/youtube';

interface ShortsPreviewPhoneProps {
  clip: ExtractedClipCandidate | null;
  thumbnailUrl?: string;
  templateId: string;
  transforms: string[];
  isRendering?: boolean;
  onRenderClick?: () => void;
}

export const ShortsPreviewPhone: React.FC<ShortsPreviewPhoneProps> = ({
  clip,
  thumbnailUrl,
  templateId,
  transforms,
  isRendering = false,
  onRenderClick,
}) => {
  const [captionIndex, setCaptionIndex] = useState(0);
  const [imgFailed, setImgFailed] = useState(false);

  const template = EDITING_TEMPLATES.find((t) => t.id === templateId) ?? EDITING_TEMPLATES[0];
  const fallbackBackdrop = '/src/assets/images/shorts_preview_podcast_1795011793944.jpg';
  const activeImg = !imgFailed && thumbnailUrl ? thumbnailUrl : fallbackBackdrop;

  const captions = clip?.captions ?? [];
  const activeCaption = captions[captionIndex % Math.max(1, captions.length)]?.text ??
    'AI synced Hindi / Hinglish captions appear here';

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">9:16 Vertical Short Preview</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {template.name} · {clip ? `${clip.durationSec}s` : 'Ready'}
          </p>
        </div>
        {clip?.renderUrl && (
          <a
            href={clip.renderUrl}
            download={clip.renderFilename || 'clippulse-short.mp4'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Download MP4
          </a>
        )}
      </div>

      <div className="mx-auto w-full max-w-[280px] aspect-[9/16] rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 relative flex flex-col justify-between">
        {clip?.renderUrl ? (
          <video
            key={clip.renderUrl}
            src={clip.renderUrl}
            controls
            playsInline
            className="w-full h-full object-cover"
            data-testid="rendered-short-video"
          />
        ) : (
          <>
            <img
              src={activeImg}
              alt={clip?.title || 'Shorts vertical frame preview'}
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className={`absolute inset-0 w-full h-full object-cover transition-transform duration-300 ${
                transforms.includes('mirror_flip') ? '-scale-x-100' : ''
              } ${transforms.includes('color_lut') ? 'contrast-110 saturate-115' : ''}`}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/65" />

            {/* Template Top Hook Banner */}
            <div className="relative z-10 p-4 pt-5">
              {template.headerBanner && (
                <div
                  className="px-3 py-2 rounded-lg text-center text-white text-xs font-semibold tracking-wide"
                  style={{ backgroundColor: template.accentColor }}
                >
                  {clip?.hookLine || template.badgeText}
                </div>
              )}
            </div>

            {/* Interactive Caption Preview */}
            <div
              className={`relative z-10 px-4 pb-8 flex flex-col gap-3 ${
                template.captionPosition === 'center' ? 'my-auto' : ''
              }`}
            >
              <button
                type="button"
                onClick={() => setCaptionIndex((prev) => prev + 1)}
                className="text-left focus-visible:outline-2 focus-visible:outline-white rounded-lg"
                title="Cycle preview captions"
              >
                <div
                  className={`px-3.5 py-2.5 rounded-lg text-center leading-snug ${
                    template.captionStyle === 'bold-pop'
                      ? 'bg-amber-400 text-slate-950 font-bold text-sm'
                      : template.captionStyle === 'headline-bar'
                      ? 'bg-white text-slate-950 font-semibold text-xs'
                      : 'bg-slate-950/85 text-white font-semibold text-sm border border-white/15'
                  }`}
                >
                  {activeCaption}
                </div>
              </button>

              {clip && (
                <div className="flex items-center justify-between text-[11px] text-slate-200 font-mono-tabular px-1">
                  <span>
                    {formatSecondsToTimestamp(clip.startSec)} – {formatSecondsToTimestamp(clip.endSec)}
                  </span>
                  <span>{clip.durationSec}s max</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {clip && (
        <div className="space-y-3">
          {clip.notice && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
              {clip.notice}
            </p>
          )}
          <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
            <span className="truncate">
              Transforms: {transforms.length > 0 ? transforms.length : 0} active
            </span>
            {captions.length > 1 && !clip.renderUrl && (
              <button
                type="button"
                onClick={() => setCaptionIndex((i) => i + 1)}
                className="text-slate-700 hover:text-slate-900 font-medium underline underline-offset-2 whitespace-nowrap shrink-0"
              >
                Next caption ({(captionIndex % captions.length) + 1}/{captions.length})
              </button>
            )}
          </div>

          {onRenderClick && (
            <button
              type="button"
              onClick={onRenderClick}
              disabled={isRendering}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap"
            >
              {isRendering ? (
                <>
                  <Sparkles className="w-4 h-4 animate-spin" />
                  Rendering 9:16 MP4...
                </>
              ) : clip.renderUrl ? (
                <>
                  <Film className="w-4 h-4" />
                  Re-Render with Current Edits
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Render Copyright-Free MP4
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
