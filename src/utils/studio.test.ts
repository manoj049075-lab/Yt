import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractYouTubeVideoId,
  formatSecondsToTimestamp,
  clampClipRange,
  buildCopyrightFreeFilterPlan,
} from './youtube';
import { computeAutomationTotals, generateMultiChannelSchedule } from './scheduler';

test('extractYouTubeVideoId handles watch, short, live, and youtu.be URLs', () => {
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=42'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/live/jfKfPfyJRdk?feature=share'), 'jfKfPfyJRdk');
  assert.equal(extractYouTubeVideoId('https://youtube.com/shorts/aqz-KE-bpKQ'), 'aqz-KE-bpKQ');
  assert.equal(extractYouTubeVideoId('not-a-valid-url'), null);
});

test('clampClipRange enforces maximum seconds and video bounds', () => {
  const clamped = clampClipRange(120, 210, 45, 500);
  assert.equal(clamped.startSec, 120);
  assert.equal(clamped.endSec, 165);
  assert.equal(clamped.durationSec, 45);

  const boundedByVideo = clampClipRange(95, 140, 60, 110);
  assert.equal(boundedByVideo.endSec, 110);
  assert.equal(boundedByVideo.durationSec, 15);
});

test('formatSecondsToTimestamp formats mm:ss and hh:mm:ss cleanly', () => {
  assert.equal(formatSecondsToTimestamp(65), '01:05');
  assert.equal(formatSecondsToTimestamp(3661), '1:01:01');
});

test('buildCopyrightFreeFilterPlan builds valid ffmpeg filters', () => {
  const plan = buildCopyrightFreeFilterPlan(['pitch_shift', 'dynamic_zoom', 'color_lut', 'mirror_flip']);
  assert.ok(plan.ffmpegVideoFilter.includes('crop=720:1280'));
  assert.ok(plan.ffmpegVideoFilter.includes('hflip'));
  assert.ok(plan.ffmpegVideoFilter.includes('eq=contrast=1.06'));
  assert.ok(plan.ffmpegAudioFilter.includes('asetrate=44100*1.025'));
  assert.equal(plan.summary.length, 4);
});

test('computeAutomationTotals and generateMultiChannelSchedule distribute across 3 channels', () => {
  const channels = [
    {
      id: 'ch-1',
      title: 'Tech Bytes',
      videosPerDay: 2,
      postingSlots: ['10:00', '18:00'],
      preferredTemplate: 'viral-hook-bold',
      maxClipDuration: 45,
      automationMonths: 3,
      automationActive: true,
    },
    {
      id: 'ch-2',
      title: 'Hindi 2D Stories',
      videosPerDay: 1,
      postingSlots: ['14:00'],
      preferredTemplate: 'animation-2d-story',
      maxClipDuration: 60,
      automationMonths: 2,
      automationActive: true,
    },
    {
      id: 'ch-3',
      title: 'Paused Channel',
      videosPerDay: 2,
      postingSlots: ['09:00', '20:00'],
      preferredTemplate: 'podcast-split',
      maxClipDuration: 30,
      automationMonths: 6,
      automationActive: false,
    },
  ];

  const totals = computeAutomationTotals(channels);
  assert.equal(totals.totalChannels, 3);
  assert.equal(totals.activeChannels, 2);
  assert.equal(totals.dailyPosts, 3);
  assert.equal(totals.maxHorizonDays, 90);
  assert.equal(totals.projectedTotalVideos, 2 * 90 + 1 * 60);

  const schedule = generateMultiChannelSchedule(
    channels,
    [
      { id: 'clip-a', title: 'Hook 1', durationSec: 38 },
      { id: 'clip-b', title: 'Hook 2', durationSec: 42 },
    ],
    '2026-11-18T08:00:00.000Z',
    5
  );
  // 5 days * (2 posts on ch-1 + 1 post on ch-2) = 15 scheduled entries
  assert.equal(schedule.length, 15);
  assert.ok(schedule.every((entry) => entry.channelId !== 'ch-3'));
});
