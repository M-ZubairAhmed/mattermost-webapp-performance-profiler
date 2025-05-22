import {Page} from 'puppeteer';
import {MemoryMetrics, measureMemoryUsage} from '../measurers/memory';
import {createAndSaveToFiles} from '../measurers/toFile';
import {forceGarbageCollection} from '../measurers/garbageCollector';
import {convertTimestampsToSeconds} from '../measurers/toFile';
import {FrameRateMeasurer} from '../measurers/frameRate';

export async function profileSwitchingToEachChannel(
  page: Page,
  startTime: Date,
  timestamp: string,
  waitAfterEachSwitch: number = 2000,
): Promise<MemoryMetrics[]> {
  const measurements: MemoryMetrics[] = [];

  await forceGarbageCollection(page);

  const frameRateMeasurer = new FrameRateMeasurer(
    page,
    `switch-each-channel-framerate-${timestamp}`,
  );
  await frameRateMeasurer.start();

  console.log('Started switching to each channel');
  console.log(
    `Configuration: ${waitAfterEachSwitch}ms delay`,
  );

  // Wait for sidebar container to appear
  await page.waitForSelector('#sidebar-left');

  // Get all sidebar links within sidebar-left
  const channelLinks = await page.evaluate(() => {
    const sidebar = document.getElementById('sidebar-left');
    if (!sidebar) return [];

    // Find all anchor tags with class SidebarLink directly
    const links = Array.from(sidebar.querySelectorAll('a.SidebarLink'));
    return links
      .map((link) => {
        return {
          id: link.id || 'Unknown Channel id',
          ariaLabel:
            link.getAttribute('aria-label') || 'Unknown Channel aria-label',
        };
      })
      .filter((link) => link.id); // Filter out links without IDs
  });

  for (let i = 0; i < channelLinks.length; i++) {
    const channel = channelLinks[i];

    // Click on the channel by ID
    await page.evaluate((id) => {
      const element = document.getElementById(id);
      if (element) {
        element.click();
      }
    }, channel.id);

    // Wait for content to load and stabilize
    await new Promise((resolve) => setTimeout(resolve, waitAfterEachSwitch));

    // Take memory measurement
    const metrics = await measureMemoryUsage(page);

    // Calculate diffTimestamp from start time
    metrics.diffTimestamp = metrics.timestamp - startTime.getTime();

    // Add channel name to metrics
    const metricsWithChannel = {
      ...metrics,
      channelAriaLabel: channel.ariaLabel,
      channelId: channel.id,
    };

    measurements.push(metricsWithChannel);
  }

  await frameRateMeasurer.stop();

  // Convert timestamps to include seconds
  const dataWithSeconds = convertTimestampsToSeconds(measurements);

  await createAndSaveToFiles(
    dataWithSeconds,
    `switch-each-channel-memory-profile-${timestamp}`,
  );

  return measurements;
}
