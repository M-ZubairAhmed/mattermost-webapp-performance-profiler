import {Page} from 'puppeteer';
import {measureMemoryUsage, MemoryMetrics} from '../measurers/memory';
import {forceGarbageCollection} from '../measurers/garbageCollector';
import {createAndSaveToFiles} from '../measurers/toFile';
import {convertTimestampsToSeconds} from '../measurers/toFile';
import { FrameRateMeasurer } from '../measurers/frameRate';

// Add this interface extension for scroll measurements
interface ScrollMemoryMetrics extends MemoryMetrics {
  scrollPosition: number; // Scroll position in pixels
  frameRate?: number; // Frames per second (frame rate)
  frameTime?: number; // Average time to render a frame in ms
}

/**
 * Measures memory usage while scrolling through a channel
 */
export async function profileScrollingInChannel(
  page: Page,
  channelId: string,
  scrollCount: number,
  scrollStep: number,
  pauseBetweenScrolls: number,
  filename: string,
): Promise<ScrollMemoryMetrics[]> {
  const measurements: ScrollMemoryMetrics[] = [];

  // Navigate to the specified channel
  console.log(`Navigating to channel with id: ${channelId}`);
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

  // Run initial garbage collection
  await forceGarbageCollection(page);
  console.log('Initial garbage collection completed');

  const startTimestamp = Date.now(); // Record start time after GC and navigation

  const containerSelector = '.post-list__dynamic';

  // Take initial measurement before scrolling
  let initialMetrics = await measureMemoryUsage(page);

  const frameRateMeasurer = new FrameRateMeasurer(page);
  await frameRateMeasurer.start();

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

    console.log(`Scrolled ${i + 1}/${scrollCount}`);
  }

  await frameRateMeasurer.stop();

  console.log(
    `\nCompleted scrolling test with ${measurements.length} measurements`,
  );

  // Convert timestamps to include seconds
  const dataWithSeconds = convertTimestampsToSeconds(measurements);

  await createAndSaveToFiles(dataWithSeconds, filename);

  return measurements;
}
