import puppeteer, {Browser, Page} from 'puppeteer';
import * as path from 'path';
import * as fs from 'fs/promises';
import 'pptr-testing-library/extend';
import {formatTimestamp} from './measurers/toFile';
import {forceGarbageCollection} from './measurers/garbageCollector';
import {profileScrollingInChannel} from './scenarios/scrollingInChannel';
import {profileSwitchingToSameChannels} from './scenarios/switchToSameChannel';
import {profileSwitchingToEachChannel} from './scenarios/switchToEachChannel';
import {Command} from 'commander';

// Set up commander for CLI options
const program = new Command();

program
  .name('mattermost-webapp-performance-profiler')
  .description('Performance profiler for Mattermost webapp')
  .version('1.0.0');

// Global options
program
  .option('--headless', 'Run browser in headless mode', false)
  .option('--no-run', 'Parse arguments but do not run tests');

// Scrolling test options
program
  .command('scroll')
  .description('Run scrolling test in channel')
  .option('-c, --count <number>', 'Number of scrolls to perform', '20')
  .option('-p, --pixels <number>', 'Pixels per scroll', '400')
  .option('-d, --delay <number>', 'Milliseconds between scrolls', '500')
  .option('--channel <id>', 'Channel ID to test', 'sidebarItem_town-square')
  .action(cmd => {
    cmd.testType = 'scroll';
  });

// Same channel switching test
program
  .command('same-channels')
  .description('Test switching between same channels repeatedly')
  .option('-c, --count <number>', 'Number of channel switches to perform', '100')
  .action(cmd => {
    cmd.testType = 'same-channels';
  });

// Each channel switching test
program
  .command('each-channel')
  .description('Test switching to each available channel')
  .action(cmd => {
    cmd.testType = 'each-channel';
  });

// All tests command
program
  .command('all')
  .description('Run all tests with default settings')
  .action(cmd => {
    cmd.testType = 'all';
  });

// Parse arguments
program.parse();

async function setupBrowser(headless = false): Promise<{browser: Browser; page: Page}> {
  const browser = await puppeteer.launch({
    headless,
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
    // Get options from commander
    const options = program.opts();
    
    // Find which command/test was specified
    const commands = program.commands.filter(cmd => 
      cmd.opts().testType !== undefined);
    
    // If no-run flag is set, exit early
    if (!options.run) {
      console.log('Arguments parsed but tests not run due to --no-run flag');
      return;
    }
    
    // If no command specified, show help
    if (commands.length === 0) {
      console.log('No test specified. Please specify a test to run:');
      program.help();
      return;
    }

    // Setup browser and page
    const {browser, page} = await setupBrowser(options.headless);

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

    // Force garbage collection before starting analysis
    console.log('Running initial garbage collection to clean memory state...');
    await forceGarbageCollection(page);

    // Wait a moment for GC to complete fully
    await new Promise((resolve) => setTimeout(resolve, 2000));
    console.log('Initial garbage collection completed. Starting analysis...');

    // Create results directory if it doesn't exist
    const resultsDir = path.join(process.cwd(), 'results');
    try {
      await fs.mkdir(resultsDir, {recursive: true});
    } catch (err) {
      console.log('Results directory already exists');
    }

    // Create timestamp for filenames
    const timestamp = formatTimestamp();

    // Process each specified command
    for (const cmd of commands) {
      const cmdOptions = cmd.opts();
      
      switch (cmdOptions.testType) {
        case 'scroll':
          console.log('Running scrolling test...');
          await profileScrollingInChannel(
            page,
            cmdOptions.channel,
            parseInt(cmdOptions.count, 10),
            parseInt(cmdOptions.pixels, 10),
            parseInt(cmdOptions.delay, 10),
            `scroll-memory-profile-no-gc-${timestamp}`,
          );
          break;
          
        case 'same-channels':
          console.log('Running same-channels test...');
          await profileSwitchingToSameChannels(
            page,
            path.join(
              resultsDir,
              `same-channels-memory-profile-no-gc-${timestamp}.json`,
            ),
            parseInt(cmdOptions.count, 10),
          );
          break;
          
        case 'each-channel':
          console.log('Running each-channel test...');
          await profileSwitchingToEachChannel(
            page,
            path.join(
              resultsDir,
              `each-channel-memory-profile-no-gc-${timestamp}.json`,
            ),
          );
          break;
          
        case 'all':
          console.log('Running all tests...');
          
          // Run scrolling test
          await profileScrollingInChannel(
            page,
            'sidebarItem_town-square',
            20,
            400,
            500,
            `scroll-memory-profile-no-gc-${timestamp}`,
          );
          
          // Run same-channels test
          await profileSwitchingToSameChannels(
            page,
            path.join(
              resultsDir,
              `same-channels-memory-profile-no-gc-${timestamp}.json`,
            ),
            100,
          );
          
          // Run each-channel test
          await profileSwitchingToEachChannel(
            page,
            path.join(
              resultsDir,
              `each-channel-memory-profile-no-gc-${timestamp}.json`,
            ),
          );
          break;
      }
    }

    console.log('\nAll tests completed.');

    // Close the browser
    await browser.close();
  } catch (error) {
    console.error('An error occurred:', error);
  }
}

main();
