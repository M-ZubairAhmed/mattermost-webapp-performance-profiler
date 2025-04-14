import {Page} from 'puppeteer';
import * as fs from 'fs/promises';
import * as path from 'path';

interface MemoryMetrics {
  heapTotalMB: number;
  timestamp: number;
  diffTimestamp?: number; // Time difference from first timestamp
  channelName?: string;
  channelAriaLabel?: string;
  channelId?: string;
  gcCount?: number; // Count of GC runs
}

// Track garbage collection events globally
let gcEventCount = 0;
let isTrackingGC = false;
let persistentCDPSession: any = null;

/**
 * Start tracking garbage collection events
 */
export async function startTrackingGC(page: Page): Promise<void> {
  if (isTrackingGC) return; // Already tracking
  
  // Create a persistent CDP session
  persistentCDPSession = await page.createCDPSession();
  
  // Enable required domains
  await persistentCDPSession.send('HeapProfiler.enable');
  await persistentCDPSession.send('Runtime.enable');
  
  // Reset counter
  gcEventCount = 0;
  
  // Listen for garbage collection events
  // Using both HeapProfiler and Runtime events to catch all GC activity
  persistentCDPSession.on('HeapProfiler.collectGarbage', () => {
    gcEventCount++;
    console.log(`Explicit garbage collection detected (total: ${gcEventCount})`);
  });
  
  persistentCDPSession.on('Runtime.consoleAPICalled', (event: any) => {
    if (event.type === 'debug' && event.args[0]?.value?.includes('GC')) {
      gcEventCount++;
      console.log(`Runtime GC event detected (total: ${gcEventCount})`);
    }
  });
  
  // This is the most reliable event for automatic GC
  persistentCDPSession.on('Runtime.garbage-collection', () => {
    gcEventCount++;
    console.log(`Automatic garbage collection detected (total: ${gcEventCount})`);
  });
  
  // Add a helper script to monitor GC
  await page.evaluateOnNewDocument(() => {
    (window as any).gcMonitor = {
      count: 0,
      startTime: Date.now(),
      addEvent: function() {
        this.count++;
        console.debug('GC event detected by monitoring object lifecycle');
      }
    };
    
    // Create objects periodically to help detect GC
    const createObjectsForGCDetection = () => {
      const obj = { timestamp: Date.now() };
      (window as any).lastObj = obj;
      
      // Use a weak reference if supported
      if (typeof WeakRef !== 'undefined') {
        const weakRef = new WeakRef(obj);
        setTimeout(() => {
          if (!weakRef.deref()) {
            (window as any).gcMonitor.addEvent();
          }
        }, 1000);
      }
      
      setTimeout(createObjectsForGCDetection, 2000);
    };
    
    createObjectsForGCDetection();
  });
  
  isTrackingGC = true;
  console.log('Started tracking garbage collection events with improved detection');
}

/**
 * Get the current count of detected garbage collection events
 */
export function getGCCount(): number {
  return gcEventCount;
}

/**
 * Forces garbage collection in the page
 */
export async function forceGarbageCollection(page: Page): Promise<void> {
  // Use the persistent session if available, otherwise create a new one
  const client = persistentCDPSession || await page.createCDPSession();
  
  // Make sure HeapProfiler is enabled
  await client.send('HeapProfiler.enable');
  
  // Force garbage collection
  await client.send('HeapProfiler.collectGarbage');
  
  // Also try memory pressure simulation which can trigger GC
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false
  });
  await client.send('Emulation.setScriptExecutionDisabled', { value: true });
  await client.send('Emulation.setScriptExecutionDisabled', { value: false });
  
  // Check page GC monitor
  await page.evaluate(() => {
    // Try to force GC using memory pressure
    if (window.gc) {
      window.gc();
    }
    
    // Alternative approach to encourage GC
    const generateGarbage = () => {
      const arr = [];
      for (let i = 0; i < 1000000; i++) {
        arr.push({ data: new Array(10).fill(Math.random()) });
      }
      return arr.length;
    };
    
    generateGarbage();
    if (window.gc) window.gc();
  });
  
  console.log('Forced garbage collection');
}

export async function measureMemoryUsage(page: Page, runGC: boolean = false): Promise<MemoryMetrics> {
  // Use the persistent session if available, otherwise create a new one
  const client = persistentCDPSession || await page.createCDPSession();

  // Run garbage collection if requested
  if (runGC) {
    await forceGarbageCollection(page);
  }

  // Enable the Performance domain
  await client.send('Performance.enable');

  // Get metrics
  const metrics = await client.send('Performance.getMetrics');

  const heapTotal =
    metrics.metrics.find((m: any) => m.name === 'JSHeapTotalSize')?.value || 0;
  
  // Convert to MB
  const heapTotalMB = parseFloat((heapTotal / 1024 / 1024).toFixed(2));

  // Try to get page GC count
  const pageGCCount = await page.evaluate(() => {
    return (window as any).gcMonitor ? (window as any).gcMonitor.count : 0;
  }).catch(() => 0);
  
  // Combine CDP and page GC counts
  const totalGCCount = gcEventCount + pageGCCount;

  console.log(`JS Heap Total: ${heapTotalMB} MB (GC count: ${totalGCCount})`);

  return {heapTotalMB, timestamp: Date.now(), gcCount: totalGCCount};
}

/**
 * Exports memory metrics to a CSV file
 */
export async function exportToCsv(measurements: MemoryMetrics[], outputFile: string): Promise<void> {
  // Determine all possible headers from the data
  const headers = new Set<string>();
  measurements.forEach(metric => {
    Object.keys(metric).forEach(key => headers.add(key));
  });
  
  // Create header row
  const headerRow = Array.from(headers).join(',');
  
  // Create data rows
  const dataRows = measurements.map(metric => {
    return Array.from(headers).map(header => {
      // Handle case where a metric doesn't have all fields
      const value = metric[header as keyof MemoryMetrics];
      // Wrap string values in quotes
      return typeof value === 'string' ? `"${value}"` : value === undefined ? '' : value;
    }).join(',');
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
  runGC: boolean = false
): Promise<MemoryMetrics[]> {
  const measurements: MemoryMetrics[] = [];
  const startTime = Date.now();
  const endTime = startTime + duration;
  
  while (Date.now() < endTime) {
    const metrics = await measureMemoryUsage(page, runGC);
    
    // Calculate diffTimestamp (0 for first measurement)
    if (measurements.length === 0) {
      metrics.diffTimestamp = 0;
    } else {
      metrics.diffTimestamp = metrics.timestamp - measurements[0].timestamp;
    }
    
    measurements.push(metrics);
    
    // Wait for the specified interval before taking the next measurement
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  // Save to file if specified
  if (outputFile) {
    // Save JSON
    await fs.writeFile(outputFile, JSON.stringify(measurements, null, 2));
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
  runGC: boolean = false
): Promise<MemoryMetrics[]> {
  const measurements: MemoryMetrics[] = [];
  
  // Run an initial garbage collection to start with a clean state
  console.log('Running initial garbage collection before channel switching test...');
  await forceGarbageCollection(page);
  await new Promise(resolve => setTimeout(resolve, 2000));
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
    return links.map(link => {
      return {
        id: link.id || 'Unknown Channel id',
        ariaLabel: link.getAttribute('aria-label') || 'Unknown Channel aria-label'
      };
    }).filter(link => link.id); // Filter out links without IDs
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
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Take memory measurement
    const metrics = await measureMemoryUsage(page, runGC);
    
    // Calculate diffTimestamp from start time
    metrics.diffTimestamp = metrics.timestamp - startTimestamp;
    
    // Add channel name to metrics
    const metricsWithChannel = {
      ...metrics,
      channelAriaLabel: channel.ariaLabel,
      channelId: channel.id
    };
    
    measurements.push(metricsWithChannel);
  }
  
  // Save to file if specified
  if (outputFile) {
    // Save JSON
    await fs.writeFile(outputFile, JSON.stringify(measurements, null, 2));
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
  numberOfSwitches: number = 10
): Promise<MemoryMetrics[]> {
  const measurements: MemoryMetrics[] = [];
  
  // Run an initial garbage collection to start with a clean state
  console.log('Running initial garbage collection before channel switching test...');
  await forceGarbageCollection(page);
  await new Promise(resolve => setTimeout(resolve, 2000));
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
      townSquareId: townSquare?.id || 'not found'
    };
  });
  
  if (!channelsExist.offTopicExists || !channelsExist.townSquareExists) {
    console.error(`Unable to find required channels: off-topic (${channelsExist.offTopicId}), town-square (${channelsExist.townSquareId})`);
    throw new Error('Required channels not found in sidebar');
  }
  
  for (let i = 0; i < numberOfSwitches; i++) {
    console.log(`Switch cycle ${i+1}/${numberOfSwitches}: Navigating to off-topic`);
    
    // Click on offtopic channel
    await page.evaluate(() => {
      const element = document.getElementById('sidebarItem_off-topic');
      if (element) {
        element.click();
      }
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Take memory measurement
    const metricsOffTopic = await measureMemoryUsage(page, runGC);
    
    // Add diffTimestamp
    metricsOffTopic.diffTimestamp = metricsOffTopic.timestamp - startTimestamp;
    
    measurements.push({...metricsOffTopic, channelName: 'off-topic'});

    console.log(`Switch cycle ${i+1}/${numberOfSwitches}: Navigating to town-square`);
    
    // Click on town-square channel
    await page.evaluate(() => {
      const element = document.getElementById('sidebarItem_town-square');
      if (element) {
        element.click();
      }
    });

    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Take memory measurement
    const metricsTownSquare = await measureMemoryUsage(page, runGC);
    
    // Add diffTimestamp
    metricsTownSquare.diffTimestamp = metricsTownSquare.timestamp - startTimestamp;
    
    measurements.push({...metricsTownSquare, channelName: 'town-square'});
  }

  console.log(`Completed ${numberOfSwitches} channel switches (${measurements.length} measurements)`);

  // Save to file if specified
  if (outputFile) {
    // Save JSON
    await fs.writeFile(outputFile, JSON.stringify(measurements, null, 2));
    console.log(`JSON data saved to ${outputFile}`);
    
    // Save CSV
    const csvFile = getCsvFilePath(outputFile);
    await exportToCsv(measurements, csvFile);
  }
    
  return measurements;
}
