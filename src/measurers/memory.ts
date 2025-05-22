import {Page} from 'puppeteer';
import {convertTimestampsToSeconds, createAndSaveToFiles} from './toFile';

export interface MemoryMetrics {
  heapTotalMB: number;
  timestamp: number; // Unix timestamp in milliseconds (from Date.now())
  diffTimestamp?: number; // Time difference in milliseconds from first measurement
  channelName?: string;
  channelAriaLabel?: string;
  channelId?: string;
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

  return {heapTotalMB, timestamp: Date.now()};
}

export async function measureMemoryUsagePeriodically(
  page: Page,
  duration: number,
  interval: number,
  filename: string,
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

  // Convert timestamps to include seconds
  const dataWithSeconds = convertTimestampsToSeconds(measurements);

  await createAndSaveToFiles(dataWithSeconds, filename);

  return measurements;
}
