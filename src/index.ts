import puppeteer, {Browser, Page} from 'puppeteer';
import * as path from 'path';
import * as fs from 'fs/promises';
import 'pptr-testing-library/extend';
import {formatTimestamp} from './measurers/toFile';
import {forceGarbageCollection} from './measurers/garbageCollector';
import {profileSwitchingToEachChannel} from './scenarios/switchToEachChannel';
import {profileScrollingInTwoChannels} from './scenarios/scrollingInTwoChannels';
import {Command} from 'commander';

// Set up commander for CLI options
const program = new Command();

program
  .name('mattermost-webapp-performance-profiler')
  .description('Performance profiler for Mattermost webapp')
  .version('1.0.0')
  .option('--test <type>', 'Test type to run (scroll-one-channel, scroll-two-channels, switch-same-channels, switch-each-channel)');

// Parse arguments
program.parse();

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

const EMAIL = 'sysadmin';
const PASSWORD = 'Sys@dmin-sample1';

async function performLogin(page: Page): Promise<void> {
  await page.waitForSelector('#input_loginId');
  await page.type('#input_loginId', EMAIL);
  await page.type('#input_password-input', PASSWORD);
  await page.keyboard.press('Enter');
}

async function main(): Promise<void> {
  try {
    // Get options from commander
    const options = program.opts();
    
    // If no test specified, show help
    if (!options.test) {
      console.log('No test specified. Please specify a test using --test=<type>');
      console.log('Available tests: scroll-two-channels, switch-each-channel');
      program.help();
      return;
    }

    // Setup browser and page
    const {browser, page} = await setupBrowser();

    // Clear browser data
    await clearBrowserData(page);

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
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Create results directory if it doesn't exist
    const resultsDir = path.join(process.cwd(), 'results');
    try {
      await fs.mkdir(resultsDir, {recursive: true});
    } catch (err) {
      console.log('Results directory already exists');
    }

    // Create timestamp for filenames
    const startTime = new Date();
    const timestamp = formatTimestamp(startTime);

    // Get the tests to run (split by comma)
    const testsToRun = options.test.split(',').map((t: string) => t.trim());
    
    // Track if any test failed
    let hasFailures = false;
    
    // Process each specified test
    for (const testType of testsToRun) {
      try {
        switch (testType) {
          case 'scroll-two-channels':
            await profileScrollingInTwoChannels(
              page,
              startTime,
              timestamp,
              400,  // Fewer scrolls
              300, // Smaller pixels per scroll
              150  // More time between scrolls
            );
            break;
            
          case 'switch-each-channel':
            await profileSwitchingToEachChannel(
              page,
              startTime,
              timestamp,
              1500,
            );
            break;

          default:
            console.log(`Unknown test type: ${testType}`);
            console.log('Available tests: scroll-one-channel, scroll-two-channels, switch-same-channels, switch-each-channel');
        }
      } catch (err) {
        console.error(`Error running test ${testType}:`, err);
        hasFailures = true;
        // Continue with next test instead of failing completely
      }
    }

    console.log('\nAll tests completed.');
    
    // Wait a moment before closing browser to ensure all data is processed
    console.log('Waiting 5 seconds before closing browser...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Close the browser
    await browser.close();
    
    if (hasFailures) {
      console.log('Some tests had failures. Check logs for details.');
    }
  } catch (error) {
    console.error('An error occurred:', error);
    process.exit(1);
  }
}

main();
