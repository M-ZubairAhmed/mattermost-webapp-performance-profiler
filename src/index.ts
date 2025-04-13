import puppeteer, {Browser, Page} from 'puppeteer';
import {measureMemoryUsage} from './measure';

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

    // Navigate to the page
    await page.goto(
      'http://localhost:8065/team-au5hif5xh3gctgbfasrhq8dt1o/channels/town-square',
    );

    // Measure memory before actions
    console.log('\nMemory before actions:');
    await measureMemoryUsage(page);

    // Handle preference checkbox
    await handlePreferenceCheckbox(page);

    // Click View in Browser button
    await clickViewInBrowser(page);

    // Measure memory after navigation
    console.log('\nMemory after navigation:');
    await measureMemoryUsage(page);

    // Perform login
    await performLogin(page);

    // Measure memory after login
    console.log('\nMemory after login:');
    await measureMemoryUsage(page);

    // Keep the browser open
    // To close the browser, uncomment the following line:
    // await browser.close();
  } catch (error) {
    console.error('An error occurred:', error);
  }
}

main();
