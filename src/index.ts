import puppeteer, {Browser, Page} from 'puppeteer';
import {
  measureMemoryUsage, 
  profileSwitchingToEachChannel, 
  profileSwitchingToSameChannels,
  startTrackingGC,
  forceGarbageCollection
} from './measure';
import * as path from 'path';
import * as fs from 'fs/promises';
import 'pptr-testing-library/extend';

async function setupBrowser(): Promise<{browser: Browser; page: Page}> {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized'],
  });
  const page = await browser.newPage();
  return {browser, page};
}

async function clearBrowserData(page: Page): Promise<void> {
  const client = await page.createCDPSession();
  await client.send('Network.clearBrowserCache');

  await client.send('Network.clearBrowserCookies');
}

async function handlePreferenceCheckbox(page: Page): Promise<void> {
  await page.waitForSelector(
    'label.get-app__preference input.get-app__checkbox',
  );
  await page.click('label.get-app__preference input.get-app__checkbox');
}

async function clickViewInBrowser(page: Page): Promise<void> {
  await page.waitForSelector('a.btn.btn-tertiary.btn-lg');
  await page.evaluate(() => {
    const buttons = Array.from(
      document.querySelectorAll('a.btn.btn-tertiary.btn-lg'),
    );
    const viewButton = buttons.find(
      (button) => button.textContent?.trim() === 'View in Browser',
    );
    if (viewButton) {
      (viewButton as HTMLElement).click();
    }
  });
}

async function performLogin(page: Page): Promise<void> {
  await page.waitForSelector('#input_loginId');
  await page.type('#input_loginId', 'sysadmin');
  await page.type('#input_password-input', 'Sys@dmin-sample1');
  await page.keyboard.press('Enter');
}

async function main(): Promise<void> {
  try {
    // Setup browser and page
    const {browser, page} = await setupBrowser();

    // Clear browser data
    await clearBrowserData(page);

    // Start tracking garbage collection events
    await startTrackingGC(page);
    console.log('Garbage collection tracking enabled');

    // Navigate to the page
    await page.goto(
      'http://localhost:8065/team-au5hif5xh3gctgbfasrhq8dt1o/channels/town-square',
    );

    // Handle preference checkbox
    await handlePreferenceCheckbox(page);

    // Click View in Browser button
    await clickViewInBrowser(page);

    // Perform login
    await performLogin(page);

    // Wait for page to stabilize after login and load sidebar
    console.log('Waiting for page to stabilize after login...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Force garbage collection before starting analysis
    console.log('Running initial garbage collection to clean memory state...');
    await forceGarbageCollection(page);
    
    // Wait a moment for GC to complete fully
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('Initial garbage collection completed. Starting analysis...');

    // Create results directory if it doesn't exist
    const resultsDir = path.join(process.cwd(), 'results');
    try {
      await fs.mkdir(resultsDir, { recursive: true });
    } catch (err) {
      console.log('Results directory already exists');
    }

    // Create timestamp for filenames
    const timestamp = new Date().toISOString().replace(/:/g, '-');

    
    // Measure memory usage for each channel without GC
    // console.log('\nStarting channel memory profiling...');
    // await profileSwitchingToEachChannel(
    //   page, 
    //   path.join(resultsDir, `each-channel-memory-profile-no-gc-${timestamp}.json`),
    //   false
    // );
    
    // Measure memory usage when switching between same channels without GC
    await profileSwitchingToSameChannels(
      page, 
      path.join(resultsDir, `same-channels-memory-profile-no-gc-${timestamp}.json`),
      false,
      100
    );
    
    
    // Measure memory usage for each channel with GC
    // await profileSwitchingToEachChannel(
    //   page, 
    //   path.join(resultsDir, `each-channel-memory-profile-with-gc-${timestamp}.json`),
    //   true
    // );
    
    // Measure memory usage when switching between same channels with GC
    // await profileSwitchingToSameChannels(
    //   page, 
    //   path.join(resultsDir, `same-channels-memory-profile-with-gc-${timestamp}.json`),
    //   true
    // );
    
    console.log('\nAll tests completed.');
    
    // Close the browser
    await browser.close();
  } catch (error) {
    console.error('An error occurred:', error);
  }
}

main();
