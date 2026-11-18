export interface ChannelScheduleConfig {
  id: string;
  title: string;
  videosPerDay: number;
  postingSlots: string[];
  preferredTemplate: string;
  maxClipDuration: number;
  automationMonths: number;
  automationActive: boolean;
}

export interface ClipCandidateInput {
  id: string;
  title: string;
  durationSec: number;
}

export interface PlannedScheduleEntry {
  channelId: string;
  channelTitle: string;
  clipId: string;
  clipTitle: string;
  scheduledAt: string;
  dayIndex: number;
  slotTime: string;
}

export interface AutomationSummaryMetrics {
  totalChannels: number;
  activeChannels: number;
  dailyPosts: number;
  maxHorizonDays: number;
  projectedTotalVideos: number;
}

/**
 * Computes aggregate metrics for multi-channel, multi-month automation.
 */
export function computeAutomationTotals(channels: ChannelScheduleConfig[]): AutomationSummaryMetrics {
  const active = channels.filter((c) => c.automationActive);
  const dailyPosts = active.reduce((acc, c) => acc + Math.max(1, Math.min(3, c.videosPerDay)), 0);
  const maxHorizonDays = active.reduce((max, c) => Math.max(max, Math.max(1, c.automationMonths) * 30), 0);
  const projectedTotalVideos = active.reduce(
    (sum, c) => sum + Math.max(1, Math.min(3, c.videosPerDay)) * Math.max(1, c.automationMonths) * 30,
    0
  );

  return {
    totalChannels: channels.length,
    activeChannels: active.length,
    dailyPosts,
    maxHorizonDays,
    projectedTotalVideos,
  };
}

/**
 * Generates staggered daily/multi-month schedule entries across multiple channels
 * (e.g., 2-3 channels with 1-2 videos/day per channel).
 */
export function generateMultiChannelSchedule(
  channels: ChannelScheduleConfig[],
  clips: ClipCandidateInput[],
  startDateIso: string,
  previewDays = 30
): PlannedScheduleEntry[] {
  const activeChannels = channels.filter((c) => c.automationActive);
  if (activeChannels.length === 0 || clips.length === 0) {
    return [];
  }

  const baseDate = new Date(startDateIso);
  if (Number.isNaN(baseDate.getTime())) {
    return [];
  }

  const entries: PlannedScheduleEntry[] = [];
  let clipCursor = 0;

  for (const channel of activeChannels) {
    const horizonDays = Math.min(previewDays, Math.max(1, channel.automationMonths) * 30);
    const postsPerDay = Math.max(1, Math.min(3, channel.videosPerDay));
    const slots = channel.postingSlots.length > 0 ? channel.postingSlots : ['10:00', '18:00', '21:00'];

    for (let day = 0; day < horizonDays; day++) {
      for (let slotIdx = 0; slotIdx < postsPerDay; slotIdx++) {
        const slotStr = slots[slotIdx % slots.length] || '12:00';
        const [hhStr, mmStr] = slotStr.split(':');
        const hh = Math.max(0, Math.min(23, Number.parseInt(hhStr ?? '12', 10) || 12));
        const mm = Math.max(0, Math.min(59, Number.parseInt(mmStr ?? '0', 10) || 0));

        const targetDate = new Date(baseDate);
        targetDate.setUTCDate(baseDate.getUTCDate() + day + 1);
        targetDate.setUTCHours(hh, mm, 0, 0);

        const clip = clips[clipCursor % clips.length];
        clipCursor += 1;

        entries.push({
          channelId: channel.id,
          channelTitle: channel.title,
          clipId: clip.id,
          clipTitle: clip.title,
          scheduledAt: targetDate.toISOString(),
          dayIndex: day + 1,
          slotTime: slotStr,
        });
      }
    }
  }

  return entries.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}
