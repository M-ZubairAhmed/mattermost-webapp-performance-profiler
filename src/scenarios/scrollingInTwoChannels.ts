import {Page} from 'puppeteer';
import {
  convertTimestampsToSeconds,
  createAndSaveToFiles,
} from '../measurers/toFile';
import * as path from 'path';
import {FrameRateMeasurer} from '../measurers/frameRate';
import {measureMemoryUsage, MemoryMetrics} from '../measurers/memory';
import * as fs from 'fs/promises';
import {forceGarbageCollection} from '../measurers/garbageCollector';

interface ScrollMemoryMetrics extends MemoryMetrics {
  scrollPosition: number; // Scroll position in pixels
  frameRate?: number; // Frames per second (frame rate)
  frameTime?: number; // Average time to render a frame in ms
}

export async function profileScrollingInTwoChannels(
  page: Page,
  startTime: Date,
  timestamp: string,
  scrollCount: number,
  pixelsPerScroll: number,
  delayBetweenScrolls: number,
) {
  // Ensure results directory exists
  const resultsDir = path.join(process.cwd(), 'results');
  try {
    await fs.mkdir(resultsDir, {recursive: true});
  } catch (err) {
    console.log('Results directory already exists');
  }

  // First channel (town-square by default)
  const firstChannelId = 'sidebarItem_town-square';
  // Second channel (off-topic by default)
  const secondChannelId = 'sidebarItem_off-topic';

  await forceGarbageCollection(page);

  // Create frame rate measurer with descriptive filename
  const frameRateFilename = `scroll-two-channels-framerate-${timestamp}`;
  const frameRateMeasurer = new FrameRateMeasurer(page, frameRateFilename);

  await frameRateMeasurer.start();

  console.log('Started scrolling test in two channels');
  console.log(
    `Configuration: ${scrollCount} scrolls, ${pixelsPerScroll}px per scroll, ${delayBetweenScrolls}ms delay`,
  );

  // Wait a bit to ensure the frame rate measuring has started
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Scroll in the first channel
  const firstChannelMeasurements = await profileScrollingInChannel(
    page,
    startTime,
    firstChannelId,
    scrollCount,
    pixelsPerScroll,
    delayBetweenScrolls,
  );

  // Wait a bit before switching channels
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Scroll in the second channel
  const secondChannelMeasurements = await profileScrollingInChannel(
    page,
    startTime,
    secondChannelId,
    scrollCount,
    pixelsPerScroll,
    delayBetweenScrolls,
  );

  // Wait before stopping frame rate measurement to ensure we capture all data
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Create and save a combined report
  const lastFirstChannelTimestamp =
    firstChannelMeasurements.length > 0
      ? firstChannelMeasurements[firstChannelMeasurements.length - 1]
          .diffTimestamp || 0
      : 0;

  // Add 2000ms for the wait time between channel switches
  const timeOffset = lastFirstChannelTimestamp + 2000;

  const combinedMeasurements = [
    ...firstChannelMeasurements.map((m) => ({...m, channel: firstChannelId})),
    ...secondChannelMeasurements.map((m) => ({
      ...m,
      channel: secondChannelId,
      // Adjust timestamps to continue from first channel
      diffTimestamp: (m.diffTimestamp || 0) + timeOffset,
    })),
  ];

  await frameRateMeasurer.stop();

  // Save the combined memory results
  await createAndSaveToFiles(
    combinedMeasurements,
    `scroll-two-channels-memory-profile-${timestamp}`,
  );

  // Return only the memory measurements (framerate is saved separately)
  return combinedMeasurements;
}

/**
 * Measures memory usage while scrolling through a channel
 */
async function profileScrollingInChannel(
  page: Page,
  startTime: Date,
  channelId: string,
  scrollCount: number,
  scrollStep: number,
  pauseBetweenScrolls: number,
): Promise<ScrollMemoryMetrics[]> {
  const measurements: ScrollMemoryMetrics[] = [];

  // Navigate to the specified channel
  await page.evaluate((id) => {
    const element = document.getElementById(id);
    if (element) {
      element.click();
    } else {
      console.error(`Channel with id ${id} not found`);
    }
  }, channelId);

  // Wait for channel content to load
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const startTimestamp = Date.now(); // Record start time after GC and navigation

  const containerSelector = '.post-list__dynamic';

  // Take initial measurement before scrolling
  let initialMetrics = await measureMemoryUsage(page);

  // Add initial metrics
  measurements.push({...initialMetrics, diffTimestamp: 0, scrollPosition: 0});

  for (let i = 0; i < scrollCount; i++) {
    // Scroll up by scrollStep pixels
    await page.evaluate(
      (selector, step) => {
        const container = document.querySelector(selector) as HTMLElement;
        if (container) {
          // Negative value scrolls UP
          container.scrollBy({top: -step, behavior: 'smooth'});
        }
      },
      containerSelector,
      scrollStep,
    );

    // Wait for content to load and smooth scrolling to complete
    await new Promise((resolve) => setTimeout(resolve, pauseBetweenScrolls));

    // Get current scroll position from the DOM
    const scrollPosition = await page.evaluate((selector) => {
      const container = document.querySelector(selector) as HTMLElement;
      return container ? container.scrollTop : 0;
    }, containerSelector);

    // Take memory measurement
    const metrics = await measureMemoryUsage(page);

    measurements.push({
      ...metrics,
      diffTimestamp: metrics.timestamp - startTimestamp,
      scrollPosition,
    });
  }

  return measurements;
}
