import {Page} from 'puppeteer';

interface MemoryMetrics {
  heapTotal: number;
}

export async function measureMemoryUsage(page: Page): Promise<MemoryMetrics> {
  const client = await page.createCDPSession();

  // Enable the Performance domain
  await client.send('Performance.enable');

  // Get metrics
  const metrics = await client.send('Performance.getMetrics');

  const heapTotal =
    metrics.metrics.find((m) => m.name === 'JSHeapTotalSize')?.value || 0;

  console.log(`JS Heap Total: ${(heapTotal / 1024 / 1024).toFixed(2)} MB`);

  return {heapTotal};
}
