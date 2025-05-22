import {Page} from 'puppeteer';

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

  await new Promise((resolve) => setTimeout(resolve, 2000));
}
