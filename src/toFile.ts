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
 * Save data to JSON file
 * Creates the directory if it doesn't exist
 */
async function saveToJson<T>(data: T, filename: string): Promise<string> {
  // Create the full JSON file path
  const outputFile = createFilePath(filename, '.json');

  // Create results directory if it doesn't exist
  const resultsDir = path.join(process.cwd(), 'results');
  try {
    await fs.mkdir(resultsDir, {recursive: true});
  } catch (err) {}

  // Save JSON
  await fs.writeFile(outputFile, JSON.stringify(data, null, 2));
  console.log(`JSON data saved to ${outputFile}`);

  return outputFile;
}

/**
 * Simple function to save array data to CSV file
 * Takes an array of objects and converts them to CSV format
 *
 * @param data Array of objects with the same structure
 * @param filename Filename without path (e.g., "memory_test")
 */
async function saveToCsv<T extends Record<string, any>>(
  data: T[],
  filename: string,
): Promise<string> {
  const outputFile = createFilePath(filename, '.csv');

  // Create results directory if it doesn't exist
  const resultsDir = path.join(process.cwd(), 'results');
  try {
    await fs.mkdir(resultsDir, {recursive: true});
  } catch (err) {}

  const csvHeaders = data.length > 0 ? Object.keys(data[0]) : [];

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
  console.log(`CSV data saved to ${outputFile}`);

  return outputFile;
}

export async function createAndSaveToFiles<T extends Record<string, any>>(
  data: T[],
  filename: string,
) {
  try {
    await Promise.all([saveToJson(data, filename), saveToCsv(data, filename)]);
  } catch (error) {
    console.error('Error saving data to files:', error);
  }
}
