import * as fs from 'fs/promises';
import * as path from 'path';
import {format} from 'date-fns';

// Default results directory
const DEFAULT_RESULTS_DIR = './results';

/**
 * Formats a date as DD-MM-YY-HH:MM:SS
 * Used for filenames and timestamps
 */
export function formatTimestamp(date: Date = new Date()): string {
  return format(date, 'dd-MM-yy::HH:mm:ss');
}

/**
 * Creates a full file path from a results directory and filename
 */
function createFilePath(filename: string, extension: string = ''): string {
  // Add extension if provided and not already in filename
  const fullFilename =
    extension && !filename.endsWith(extension)
      ? `${filename}${extension}`
      : filename;

  return path.join(DEFAULT_RESULTS_DIR, fullFilename);
}

/**
 * Ensure results directory exists
 */
async function ensureResultsDirectory(): Promise<string> {
  const resultsDir = path.join(process.cwd(), 'results');
  try {
    await fs.mkdir(resultsDir, {recursive: true});
    return resultsDir;
  } catch (err) {
    console.error('Error creating results directory:', err);
    throw err;
  }
}

/**
 * Save data to JSON file
 * Creates the directory if it doesn't exist
 */
async function saveToJson<T>(data: T, filename: string): Promise<string> {
  // Create the full JSON file path
  const outputFile = createFilePath(filename, '.json');

  // Create results directory if it doesn't exist
  await ensureResultsDirectory();

  // Check if data exists
  if (!data) {
    console.error('No data provided to save to JSON');
    throw new Error('No data provided to save to JSON');
  }

  // Save JSON
  const jsonString = JSON.stringify(data, null, 2);
  if (!jsonString) {
    console.error('Failed to stringify data');
    throw new Error('Failed to stringify data');
  }

  try {
    await fs.writeFile(outputFile, jsonString);
    return outputFile;
  } catch (error) {
    console.error(`Error writing to ${outputFile}:`, error);

    // Create a backup with timestamp in case of file system issues
    const backupFile = `${outputFile}.backup-${Date.now()}.json`;
    try {
      await fs.writeFile(backupFile, jsonString);
      console.log(`Backup JSON saved to ${backupFile}`);
    } catch (backupError) {
      console.error(`Failed to save backup JSON:`, backupError);
    }

    throw error;
  }
}

/**
 * Simple function to save array data to CSV file
 * Takes an array of objects and converts them to CSV format
 *
 * @param data Array of objects with the same structure
 * @param filename Filename without path (e.g., "memory_test")
 * @param silent Whether to suppress log messages
 */
async function saveToCsv<T extends Record<string, any>>(
  data: T[],
  filename: string,
  silent: boolean = false,
): Promise<string> {
  const outputFile = createFilePath(filename, '.csv');

  // Create results directory if it doesn't exist
  await ensureResultsDirectory();

  // Check if data exists and is not empty
  if (!data || !Array.isArray(data) || data.length === 0) {
    console.error(
      `No data or empty array provided to save to CSV: ${filename}`,
    );
    // Create an empty file with a warning
    const errorMsg = `# WARNING: No data was available to save at ${new Date().toISOString()}\n`;
    await fs.writeFile(outputFile, errorMsg);
    return outputFile;
  }

  // Get headers from the first item
  const csvHeaders = Object.keys(data[0]);
  if (csvHeaders.length === 0) {
    console.error('Invalid data structure: empty object in data array');
    throw new Error('Invalid data structure: empty object in data array');
  }

  try {
    // Create header row
    const headerRow = csvHeaders.join(',');

    // Create data rows
    const dataRows = data.map((item) =>
      csvHeaders
        .map((header) => {
          const value = item[header];
          // Wrap strings in quotes, handle undefined
          return typeof value === 'string' ? `"${value}"` : (value ?? '');
        })
        .join(','),
    );

    // Combine headers and data
    const csvContent = [headerRow, ...dataRows].join('\n');

    // Write to file
    await fs.writeFile(outputFile, csvContent);

    return outputFile;
  } catch (error) {
    console.error(`Error writing CSV to ${outputFile}:`, error);

    // Create an emergency JSON backup
    const backupFile = `${outputFile.replace('.csv', '')}.emergency-${Date.now()}.json`;
    try {
      await fs.writeFile(backupFile, JSON.stringify(data, null, 2));
      console.log(`Emergency JSON backup saved to ${backupFile}`);
    } catch (backupError) {
      console.error(`Failed to save emergency backup:`, backupError);
    }

    throw error;
  }
}

export async function createAndSaveToFiles<T extends Record<string, any>>(
  data: T[],
  filename: string,
  format: 'json' | 'csv' = 'csv',
) {
  try {
    if (!data || data.length === 0) {
      console.warn(`Warning: Empty or null data when saving ${filename}`);
    }

    if (format === 'json') {
      await saveToJson(data, filename);
    } else if (format === 'csv') {
      await saveToCsv(data, filename);
    }
  } catch (error) {
    console.error('Error saving data to files:', error);

    // Last resort emergency save
    try {
      const emergencyFile = path.join(
        process.cwd(),
        'results',
        `emergency-${filename}-${Date.now()}.json`,
      );
      await fs.writeFile(emergencyFile, JSON.stringify(data || [], null, 2));
      console.log(`Emergency data saved to ${emergencyFile}`);
    } catch (emergencyError) {
      console.error('CRITICAL: Even emergency save failed:', emergencyError);
    }
  }
}

/**
 * Utility function to convert milliseconds to seconds
 * Creates a copy of the data with timestamp and diffTimestamp in seconds
 */
export function convertTimestampsToSeconds(measurements: any[]): any[] {
  return measurements.map((m) => ({
    ...m,
    timestamp_sec: parseFloat((m.timestamp / 1000).toFixed(3)),
    diffTimestamp_sec:
      m.diffTimestamp !== undefined
        ? parseFloat((m.diffTimestamp / 1000).toFixed(3))
        : undefined,
  }));
}
