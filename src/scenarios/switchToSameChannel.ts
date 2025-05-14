import {Page} from 'puppeteer';
import {MemoryMetrics, measureMemoryUsage} from '../measurers/memory';
import {forceGarbageCollection} from '../measurers/garbageCollector';
import {createAndSaveToFiles} from '../measurers/toFile';
import {convertTimestampsToSeconds} from '../measurers/toFile';

export async function profileSwitchingToSameChannels(
  page: Page,
  filename: string,
  numberOfSwitches: number = 10,
): Promise<MemoryMetrics[]> {
  const measurements: MemoryMetrics[] = [];

  // Run an initial garbage collection to start with a clean state
  console.log(
    'Running initial garbage collection before channel switching test...',
  );
  await forceGarbageCollection(page);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  console.log('Initial garbage collection completed');

  const startTimestamp = Date.now(); // Record start time after GC

  // Wait for sidebar container to appear
  await page.waitForSelector('#sidebar-left');

  console.log(`Starting to switch between channels ${numberOfSwitches} times`);

  // Make sure channel selectors exist
  const channelsExist = await page.evaluate(() => {
    const offTopic = document.getElementById('sidebarItem_off-topic');
    const townSquare = document.getElementById('sidebarItem_town-square');
    return {
      offTopicExists: !!offTopic,
      townSquareExists: !!townSquare,
      offTopicId: offTopic?.id || 'not found',
      townSquareId: townSquare?.id || 'not found',
    };
  });

  if (!channelsExist.offTopicExists || !channelsExist.townSquareExists) {
    console.error(
      `Unable to find required channels: off-topic (${channelsExist.offTopicId}), town-square (${channelsExist.townSquareId})`,
    );
    throw new Error('Required channels not found in sidebar');
  }

  for (let i = 0; i < numberOfSwitches; i++) {
    console.log(
      `Switch cycle ${i + 1}/${numberOfSwitches}: Navigating to off-topic`,
    );

    // Click on offtopic channel
    await page.evaluate(() => {
      const element = document.getElementById('sidebarItem_off-topic');
      if (element) {
        element.click();
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Take memory measurement
    const metricsOffTopic = await measureMemoryUsage(page);

    // Add diffTimestamp
    metricsOffTopic.diffTimestamp = metricsOffTopic.timestamp - startTimestamp;

    measurements.push({...metricsOffTopic, channelName: 'off-topic'});

    console.log(
      `Switch cycle ${i + 1}/${numberOfSwitches}: Navigating to town-square`,
    );

    // Click on town-square channel
    await page.evaluate(() => {
      const element = document.getElementById('sidebarItem_town-square');
      if (element) {
        element.click();
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Take memory measurement
    const metricsTownSquare = await measureMemoryUsage(page);

    // Add diffTimestamp
    metricsTownSquare.diffTimestamp =
      metricsTownSquare.timestamp - startTimestamp;

    measurements.push({...metricsTownSquare, channelName: 'town-square'});
  }

  console.log(
    `Completed ${numberOfSwitches} channel switches (${measurements.length} measurements)`,
  );

  // Convert timestamps to include seconds
  const dataWithSeconds = convertTimestampsToSeconds(measurements);

  await createAndSaveToFiles(dataWithSeconds, filename);

  return measurements;
}
