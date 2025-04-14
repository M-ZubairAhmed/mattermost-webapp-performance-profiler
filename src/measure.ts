import {Page} from 'puppeteer';
import * as fs from 'fs/promises';
import * as path from 'path';

interface MemoryMetrics {
  heapTotalMB: number;
  timestamp: number; // Unix timestamp in milliseconds (from Date.now())
  diffTimestamp?: number; // Time difference in milliseconds from first measurement
  channelName?: string;
  channelAriaLabel?: string;
  channelId?: string;
}

// Add this interface extension for scroll measurements
interface ScrollMemoryMetrics extends MemoryMetrics {
  scrollPosition: number; // Scroll position in pixels
}

/**
 * Forces garbage collection in the page
 */
export async function forceGarbageCollection(page: Page): Promise<void> {
  // Create a new CDP session
  const client = await page.createCDPSession();

  // Make sure HeapProfiler is enabled
  await client.send('HeapProfiler.enable');

  // Force garbage collection
  await client.send('HeapProfiler.collectGarbage');

  // Try to trigger GC with script execution state change
  await client.send('Emulation.setScriptExecutionDisabled', {value: true});
  await client.send('Emulation.setScriptExecutionDisabled', {value: false});

  // Additional GC attempts through browser
  await page.evaluate(() => {
    // Try to force GC using memory pressure
    if (window.gc) {
      window.gc();
    }

    // Alternative approach to encourage GC
    const generateGarbage = () => {
      const arr = [];
      for (let i = 0; i < 1000000; i++) {
        arr.push({data: new Array(10).fill(Math.random())});
      }
      return arr.length;
    };

    generateGarbage();
    if (window.gc) window.gc();
  });

  console.log('Forced garbage collection');
}

export async function measureMemoryUsage(page: Page): Promise<MemoryMetrics> {
  // Create a new CDP session
  const client = await page.createCDPSession();

  // Enable the Performance domain
  await client.send('Performance.enable');

  // Get metrics
  const metrics = await client.send('Performance.getMetrics');

  const heapTotal =
    metrics.metrics.find((m: any) => m.name === 'JSHeapTotalSize')?.value || 0;

  // Convert to MB
  const heapTotalMB = parseFloat((heapTotal / 1024 / 1024).toFixed(2));

  console.log(`JS Heap Total: ${heapTotalMB} MB`);

  return {heapTotalMB, timestamp: Date.now()};
}

/**
 * Utility function to convert milliseconds to seconds
 * Creates a copy of the data with timestamp and diffTimestamp in seconds
 */
export function convertTimestampsToSeconds(
  measurements: MemoryMetrics[],
): any[] {
  return measurements.map((m) => ({
    ...m,
    timestamp_sec: parseFloat((m.timestamp / 1000).toFixed(3)),
    diffTimestamp_sec:
      m.diffTimestamp !== undefined
        ? parseFloat((m.diffTimestamp / 1000).toFixed(3))
        : undefined,
  }));
}

export async function exportToCsv(
  measurements: MemoryMetrics[],
  outputFile: string,
): Promise<void> {
  // Convert timestamps to include seconds for better readability
  const measurementsWithSeconds = convertTimestampsToSeconds(measurements);

  // Map of original headers to headers with units
  const headerMap: Record<string, string> = {
    heapTotalMB: 'heapTotal_MB',
    timestamp: 'timestamp_ms',
    diffTimestamp: 'diffTimestamp_ms',
    timestamp_sec: 'timestamp_sec',
    diffTimestamp_sec: 'diffTimestamp_sec',
  };

  // Determine all possible headers from the data
  const headers = new Set<string>();
  measurementsWithSeconds.forEach((metric) => {
    Object.keys(metric).forEach((key) => headers.add(key));
  });

  // Create header row with units
  const headerRow = Array.from(headers)
    .map((h) => headerMap[h] || h)
    .join(',');

  // Create data rows
  const dataRows = measurementsWithSeconds.map((metric) => {
    return Array.from(headers)
      .map((header) => {
        // Handle case where a metric doesn't have all fields
        const value = metric[header];
        // Wrap string values in quotes
        return typeof value === 'string'
          ? `"${value}"`
          : value === undefined
            ? ''
            : value;
      })
      .join(',');
  });

  // Combine header and data rows
  const csvContent = [headerRow, ...dataRows].join('\n');

  // Write to file
  await fs.writeFile(outputFile, csvContent);
  console.log(`CSV data saved to ${outputFile}`);
}

// Helper function to create CSV file path from JSON file path
function getCsvFilePath(jsonFilePath: string): string {
  const parsedPath = path.parse(jsonFilePath);
  return path.join(parsedPath.dir, `${parsedPath.name}.csv`);
}

export async function monitorMemoryUsage(
  page: Page,
  duration: number,
  interval: number,
  outputFile?: string,
  runGC: boolean = false,
): Promise<MemoryMetrics[]> {
  const measurements: MemoryMetrics[] = [];
  const startTime = Date.now();
  const endTime = startTime + duration;

  while (Date.now() < endTime) {
    const metrics = await measureMemoryUsage(page);

    // Calculate diffTimestamp (0 for first measurement)
    if (measurements.length === 0) {
      metrics.diffTimestamp = 0;
    } else {
      metrics.diffTimestamp = metrics.timestamp - measurements[0].timestamp;
    }

    measurements.push(metrics);

    // Wait for the specified interval before taking the next measurement
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  // Save to file if specified
  if (outputFile) {
    // Convert timestamps to include seconds
    const dataWithSeconds = convertTimestampsToSeconds(measurements);

    // Save JSON
    await fs.writeFile(outputFile, JSON.stringify(dataWithSeconds, null, 2));
    console.log(`JSON data saved to ${outputFile}`);

    // Save CSV
    const csvFile = getCsvFilePath(outputFile);
    await exportToCsv(measurements, csvFile);
  }

  return measurements;
}

export async function profileSwitchingToEachChannel(
  page: Page,
  outputFile?: string,
  runGC: boolean = false,
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
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Take memory measurement
    const metrics = await measureMemoryUsage(page);

    // Calculate diffTimestamp from start time
    metrics.diffTimestamp = metrics.timestamp - startTimestamp;

    // Add channel name to metrics
    const metricsWithChannel = {
      ...metrics,
      channelAriaLabel: channel.ariaLabel,
      channelId: channel.id,
    };

    measurements.push(metricsWithChannel);
  }

  // Save to file if specified
  if (outputFile) {
    // Convert timestamps to include seconds
    const dataWithSeconds = convertTimestampsToSeconds(measurements);

    // Save JSON
    await fs.writeFile(outputFile, JSON.stringify(dataWithSeconds, null, 2));
    console.log(`JSON data saved to ${outputFile}`);

    // Save CSV
    const csvFile = getCsvFilePath(outputFile);
    await exportToCsv(measurements, csvFile);
  }

  return measurements;
}

export async function profileSwitchingToSameChannels(
  page: Page,
  outputFile?: string,
  runGC: boolean = false,
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

  // Save to file if specified
  if (outputFile) {
    // Convert timestamps to include seconds
    const dataWithSeconds = convertTimestampsToSeconds(measurements);

    // Save JSON
    await fs.writeFile(outputFile, JSON.stringify(dataWithSeconds, null, 2));
    console.log(`JSON data saved to ${outputFile}`);

    // Save CSV
    const csvFile = getCsvFilePath(outputFile);
    await exportToCsv(measurements, csvFile);
  }

  return measurements;
}

/**
 * Measures memory usage while scrolling through a channel
 */
export async function profileScrollingInChannel(
  page: Page,
  channelId: string,
  scrollCount: number, // Number of scroll actions
  scrollStep: number, // Pixels to scroll each time
  pauseBetweenScrolls: number, // Time to wait after each scroll (ms)
  outputFile?: string,
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

  console.log(
    `\nCompleted scrolling test with ${measurements.length} measurements`,
  );

  // Save to file if specified
  if (outputFile) {
    // Convert timestamps to include seconds
    const dataWithSeconds = convertTimestampsToSeconds(measurements);

    // Save JSON
    await fs.writeFile(outputFile, JSON.stringify(dataWithSeconds, null, 2));
    console.log(`JSON data saved to ${outputFile}`);

    // Save CSV
    const csvFile = getCsvFilePath(outputFile);
    await exportToCsv(measurements, csvFile);
  }

  return measurements;
}
