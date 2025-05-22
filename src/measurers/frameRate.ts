import {Page} from 'puppeteer';
import {formatTimestamp, createAndSaveToFiles} from './toFile';
import * as fs from 'fs/promises';
import * as path from 'path';

// Measurement interval in milliseconds
const MEASUREMENT_INTERVAL = 100;

// Add interface for framerate measurements
export interface FrameRateMeasurement {
  timestamp: number; // Absolute timestamp (ms since epoch)
  diffTimestamp: number; // Relative timestamp (ms since start of measurement)
  frameRate: number; // Frames per second (frame rate)
}

// Declare interface for our dynamic window properties
declare global {
  interface Window {
    __frameCount?: number;
    __lastFrameTimestamp?: number;
    __frameRateStartTime?: number;
    __isFrameRateMeasuring?: boolean;
    __frameRateData?: Array<FrameRateMeasurement>;
    __calculateFPS?: () => void;

    // For backward compatibility with other code
    [key: string]: any;
  }
}

/**
 * Class that handles framerate measurement using a simpler, more direct approach
 */
export class FrameRateMeasurer {
  private page: Page;
  private isRunning: boolean = false;
  private measurements: FrameRateMeasurement[] = [];
  private filename: string;
  private nodeInterval: NodeJS.Timeout | null = null;
  private startTime: number = 0;
  private frameCount: number = 0;
  private lastFrameTimestamp: number = 0;

  constructor(page: Page, filename: string) {
    this.page = page;
    this.filename = filename;
  }

  /**
   * Starts measuring framerate using direct FPS counting
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Framerate measurement is already running');
      return;
    }

    console.log('Started framerate measurement with direct FPS counting...');
    this.isRunning = true;
    this.measurements = [];
    this.startTime = Date.now();
    this.frameCount = 0;
    this.lastFrameTimestamp = this.startTime;

    try {
      // Inject frame counting script
      await this.page.evaluate(() => {
        // Create these on window for access
        window.__frameCount = 0;
        window.__lastFrameTimestamp = performance.now();
        window.__frameRateStartTime = performance.now();
        window.__isFrameRateMeasuring = true;
        window.__frameRateData = [];

        // Function to measure frames using requestAnimationFrame
        function countFrame() {
          if (!window.__isFrameRateMeasuring) return;

          window.__frameCount!++;

          // Request next frame
          requestAnimationFrame(countFrame);
        }

        // Start counting frames
        requestAnimationFrame(countFrame);

        // Create a function to calculate FPS periodically
        window.__calculateFPS = function () {
          if (!window.__isFrameRateMeasuring) return;

          const now = performance.now();
          const elapsedSinceStart = now - window.__frameRateStartTime!;
          const elapsedSinceLastSample = now - window.__lastFrameTimestamp!;

          // Calculate FPS based on frames since last calculation
          const fps = Math.round(
            (window.__frameCount! / elapsedSinceLastSample) * 1000,
          );

          // Store FPS data
          window.__frameRateData!.push({
            timestamp: Date.now(),
            diffTimestamp: Math.round(elapsedSinceStart),
            frameRate: fps,
          });

          // Reset for next measurement
          window.__frameCount = 0;
          window.__lastFrameTimestamp = now;
        };

        return true;
      });

      // Start interval to calculate FPS periodically
      this.nodeInterval = setInterval(async () => {
        if (!this.isRunning) {
          if (this.nodeInterval) {
            clearInterval(this.nodeInterval);
            this.nodeInterval = null;
          }
          return;
        }

        try {
          // Trigger FPS calculation in browser
          await this.page.evaluate(() => {
            if (
              window.__isFrameRateMeasuring &&
              typeof window.__calculateFPS === 'function'
            ) {
              window.__calculateFPS!();
            }
          });

          // Every 2 seconds, retrieve measurements
          const now = Date.now();
          if (now - this.lastFrameTimestamp >= 2000) {
            this.lastFrameTimestamp = now;
            await this.retrieveCurrentMeasurements();
          }
        } catch (err) {
          console.error('Error during FPS calculation:', err);
        }
      }, MEASUREMENT_INTERVAL);
    } catch (err) {
      console.error('Error starting framerate measurement:', err);
      this.isRunning = false;
    }
  }

  /**
   * Retrieves current measurements from browser
   */
  private async retrieveCurrentMeasurements(): Promise<void> {
    try {
      const currentData = await this.page.evaluate(() => {
        const data = [...(window.__frameRateData || [])];
        // Clear browser data to avoid memory buildup
        window.__frameRateData = [];
        return data;
      });

      const count = currentData.length;
      if (count > 0) {
        this.measurements = [...this.measurements, ...currentData];

        // Save intermediate results periodically
        if (
          this.measurements.length > 0 &&
          this.measurements.length % 50 === 0
        ) {
          await this.saveIntermediate();
        }
      }
    } catch (err) {
      console.error('Error retrieving frame measurements:', err);
    }
  }

  /**
   * Saves intermediate results to avoid data loss
   */
  private async saveIntermediate(): Promise<void> {
    if (this.measurements.length === 0) return;

    const tmpFilename = `${this.filename}-intermediate`;

    try {
      await createAndSaveToFiles(this.measurements, tmpFilename);
    } catch (err) {
      console.error('Error saving intermediate results:', err);
    }
  }

  /**
   * Stops measuring framerate and returns the results
   * Automatically saves the results to a file
   */
  async stop(): Promise<FrameRateMeasurement[]> {
    if (!this.isRunning) {
      console.log('No framerate measurement is running');
      return [];
    }

    // Stop the measurement interval
    if (this.nodeInterval) {
      clearInterval(this.nodeInterval);
      this.nodeInterval = null;
    }

    // Retrieve any remaining measurements
    await this.retrieveCurrentMeasurements();

    // Stop the browser measurement
    try {
      await this.page.evaluate(() => {
        window.__isFrameRateMeasuring = false;

        // Clean up
        delete window.__frameCount;
        delete window.__lastFrameTimestamp;
        delete window.__frameRateStartTime;
        delete window.__isFrameRateMeasuring;
        delete window.__frameRateData;
        delete window.__calculateFPS;

        return true;
      });
    } catch (err) {
      console.error('Error stopping browser frame counting:', err);
    }

    this.isRunning = false;

    // Sort by timestamp
    this.measurements.sort((a, b) => a.timestamp - b.timestamp);

    // Ensure we have data before saving
    if (this.measurements.length > 0) {
      try {
        await this.saveResults(this.filename);
      } catch (err) {
        console.error('Error auto-saving results:', err);

        // Emergency save to JSON as a backup
        const emergencyFile = path.join(
          process.cwd(),
          'results',
          `${this.filename}-emergency.json`,
        );
        await fs.writeFile(
          emergencyFile,
          JSON.stringify(this.measurements, null, 2),
        );
        console.log(`Emergency backup saved to ${emergencyFile}`);
      }
    }

    return this.measurements;
  }

  async saveResults(filename: string): Promise<void> {
    if (this.measurements.length === 0) {
      console.error('Cannot save empty framerate measurements');
      return;
    }

    try {
      await createAndSaveToFiles(this.measurements, filename);
    } catch (err) {
      console.error('Error saving frame rate data:', err);
      throw err;
    }
  }
}
