const { chromium } = require('playwright');
const readline = require('readline');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const TARGET_URL = 'https://asunnot.oikotie.fi/myytavat-asunnot';
const PAGES_TO_SCRAPE = 4; // Page want to scrape, adjust as needed

// const acceptCookies = async (page) => {
//   try {
//     await page.waitForSelector('button[title="Hyväksy kaikki"][aria-label="Hyväksy kaikki"]', { timeout: 7000 });
//     await page.click('button[title="Hyväksy kaikki"][aria-label="Hyväksy kaikki"]');
//     console.log('Accepted cookies automatically.');
//   } catch {
//     console.log('No cookie popup found or already accepted.');
//   }
// };

const scrollDown = async (page) => {
  await page.evaluate(async () => {
    for (let i = 0; i < 10; i++) {
      window.scrollBy(0, window.innerHeight);
      await new Promise(r => setTimeout(r, 500));
    }
  });
};

const extractItems = async (page) => {
  await page.waitForSelector('main search-result-cards-v3', { timeout: 30000 });
  return page.$$eval(
    'main search-result-cards-v3 .cards-v3__card.ng-star-inserted',
    cards => cards.map(card => {
      const el = card.querySelector('.card-v3-text-container__text');
      return el ? el.textContent.trim() : null;
    }).filter(Boolean)
  );
};

const goToNextPage = async (page) => {
  const nextBtn = await page.$('.pagination__control button:has-text("Seuraava")');
  if (!nextBtn) return false;
  await nextBtn.evaluate(el => el.click());
  await page.waitForLoadState('networkidle');
  return true;
};

const waitForEnter = () => new Promise(resolve => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Press Enter to close the browser...', () => { rl.close(); resolve(); });
});

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
//   await acceptCookies(page);

  const allItems = [];

  for (let currentPage = 1; currentPage <= PAGES_TO_SCRAPE; currentPage++) {
    await scrollDown(page);
    const items = await extractItems(page);
    console.log(`Page ${currentPage} items:`, items);
    allItems.push(...items);

    if (currentPage < PAGES_TO_SCRAPE) {
      const hasNext = await goToNextPage(page);
      if (!hasNext) {
        console.log('No more pages available.');
        break;
      }
    }
  }

  console.log(`\nTotal items collected: ${allItems.length}`);

  // Export to Excel with timestamp in public folder
  const publicDir = path.join(__dirname, 'public');
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = path.join(publicDir, `housing_${timestamp}.xlsx`);
  const worksheet = xlsx.utils.json_to_sheet(allItems.map((name, i) => ({ '#': i + 1, 'Name': name })));
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Housing');
  xlsx.writeFile(workbook, filename);
  console.log(`Exported to ${filename}`);

  await waitForEnter();
  await browser.close();
})();
