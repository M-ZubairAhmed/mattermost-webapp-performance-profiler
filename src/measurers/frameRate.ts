import {Page} from 'puppeteer';
import {formatTimestamp, createAndSaveToFiles} from './toFile';

// Add interface for framerate measurements
export interface FrameRateMeasurement {
  timestamp: number; // Absolute timestamp (ms since epoch)
  diffTimestamp: number; // Relative timestamp (ms since start of measurement)
  frameRate: number; // Frames per second
}

// Declare interface for our dynamic window properties
declare global {
  interface Window {
    // Frame rate measurement properties
    __frameRateTimes?: number[];
    __frameRateData?: Array<FrameRateMeasurement>;
    __frameRateStartTime?: number;
    __frameRateLastUpdate?: number;
    __isFrameRateMeasuring?: boolean;
    __refreshFrameRateLoop?: () => void;

    // For backward compatibility with other code
    [key: string]: any;
  }
}

/**
 * Class that handles framerate measurement
 */
export class FrameRateMeasurer {
  private page: Page;
  private isRunning: boolean = false;
  private measurements: FrameRateMeasurement[] = [];
  private measurementId: string | null = null;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Starts measuring framerate
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Framerate measurement is already running');
      return;
    }

    this.isRunning = true;

    // Generate a unique ID for this measurement session
    this.measurementId = `frm_${Date.now()}`;

    // Start measurement in browser context where requestAnimationFrame is available
    await this.page.evaluate(() => {
      // We need to store these in the window because we're running in the browser context
      // These variables will be cleaned up when we stop
      window.__frameRateTimes = [];
      window.__frameRateData = [];
      window.__frameRateStartTime = performance.now();
      window.__frameRateLastUpdate = 0;
      window.__isFrameRateMeasuring = true;

      // Define the refresh loop function
      window.__refreshFrameRateLoop = function () {
        if (!window.__isFrameRateMeasuring) return;

        const now = performance.now();

        // Add current timestamp to times array
        window.__frameRateTimes!.push(now);

        // Keep only frames within the last second
        while (
          window.__frameRateTimes!.length > 0 &&
          window.__frameRateTimes![0] <= now - 1000
        ) {
          window.__frameRateTimes!.shift();
        }

        // Calculate and store framerate (every 500ms)
        if (now - window.__frameRateLastUpdate! >= 500) {
          const frameRate = window.__frameRateTimes!.length;
          const diffTime = now - window.__frameRateStartTime!;

          window.__frameRateData!.push({
            timestamp: Date.now(),
            diffTimestamp: Math.round(diffTime),
            frameRate: frameRate,
          });

          window.__frameRateLastUpdate = now;
        }

        // Continue the loop
        window.requestAnimationFrame(window.__refreshFrameRateLoop!);
      };

      // Start the loop
      window.requestAnimationFrame(window.__refreshFrameRateLoop);

      return true;
    });

    console.log('Started measuring framerate');
  }

  /**
   * Stops measuring framerate and returns the results
   * Automatically saves the results to a file
   */
  async stop(
    resultsDir: string = './results',
  ): Promise<FrameRateMeasurement[]> {
    if (!this.isRunning) {
      console.log('No framerate measurement is running');
      return [];
    }

    // Stop the measurement in the browser and retrieve data
    const measurements = await this.page.evaluate(() => {
      // Flag to stop the loop
      window.__isFrameRateMeasuring = false;

      // Get the collected data
      const data = window.__frameRateData || [];

      // Clean up
      delete window.__frameRateTimes;
      delete window.__frameRateData;
      delete window.__frameRateStartTime;
      delete window.__frameRateLastUpdate;
      delete window.__isFrameRateMeasuring;
      delete window.__refreshFrameRateLoop;

      return data;
    });

    this.isRunning = false;
    this.measurements = measurements;

    console.log(
      `Stopped framerate measurement, collected ${measurements.length} samples`,
    );

    // Auto-save results with timestamp in filename
    const timestamp = formatTimestamp();
    const filename = `framerate_${timestamp}`;

    try {
      await this.saveResults(filename);
    } catch (err) {
      console.error('Error auto-saving results:', err);
    }

    return measurements;
  }

  async saveResults(filename: string): Promise<void> {
    await createAndSaveToFiles(this.measurements, filename);
  }
}
