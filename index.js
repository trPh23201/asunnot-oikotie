const { chromium } = require('playwright');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const TARGET_URL = 'https://asunnot.oikotie.fi/myytavat-asunnot';
const PAGES_TO_SCRAPE = parseInt(process.argv[2]) || 2;
const POOL_SIZE = 6; // Number of detail pages to open in parallel
const clean = v => (v || '').replace(/\s+/g, ' ').trim();

// ── helpers ──────────────────────────────────────────────────────────────────

const acceptCookies = async (page) => {
  try {
    // The cookie banner button contains text "Hyväksy kaikki" inside a <span>
    const btn = page.locator('button:has(span:text("Hyväksy kaikki")), button:has-text("Hyväksy kaikki")').first();
    if (await btn.count()) await btn.click({ timeout: 4000 });
  } catch { /* no banner */ }
};

const scrollToBottom = async (page) => {
  await page.evaluate(async () => {
    for (let i = 0; i < 10; i++) {
      window.scrollBy(0, window.innerHeight);
      await new Promise(r => setTimeout(r, 400));
    }
  });
};

const getListingUrls = async (page) => {
  await page.waitForSelector('main search-result-cards-v3', { timeout: 30000 });
  return page.$$eval(
    'main search-result-cards-v3 .cards-v3__card.ng-star-inserted a[href*="/myytavat-asunnot/"]',
    els => [...new Set(els.map(a => new URL(a.getAttribute('href'), location.origin).href))]
  );
};

const nextPage = async (page) => {
  const btn = await page.$('.pagination__control button:has-text("Seuraava"), button[aria-label="Seuraava"]');
  if (!btn) return false;
  await btn.evaluate(el => el.click());
  await page.waitForLoadState('networkidle');
  return true;
};

// ── per-listing extractors ────────────────────────────────────────────────────

const getCompanyName = (page) => page.evaluate(() => {
  const clean = v => (v || '').replace(/\s+/g, ' ').trim();
  const LABELS = ['taloyhtiön nimi', 'yhtiön nimi'];
  // table rows
  for (const row of document.querySelectorAll('tr')) {
    const [th, td] = row.querySelectorAll('th,td');
    if (th && td && LABELS.some(l => clean(th.textContent).toLowerCase().includes(l)))
      return clean(td.textContent) || null;
  }
  // definition list
  for (const dt of document.querySelectorAll('dt')) {
    if (LABELS.some(l => clean(dt.textContent).toLowerCase().includes(l)))
      return clean(dt.nextElementSibling?.textContent) || null;
  }
  return null;
});

const getPhone = async (page) => {
  const btn = page.locator('button:has(span:text-is("Näytä numero"))').first();
  if (!await btn.count()) return '';
  try {
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    // Wait until <reveal-phone-number> has real content
    await page.waitForFunction(
      () => { const el = document.querySelector('reveal-phone-number'); return el && el.innerText.trim().length > 2; },
      { timeout: 10000 }
    );
    const raw = clean(await page.locator('reveal-phone-number').first().innerText());
    return raw.replace(/[^\d+ \-()]/g, '').trim();
  } catch {
    // Last-ditch: grab any tel: link that appeared after click
    const tel = await page.$eval('a[href^="tel:"]', a => a.href.replace('tel:', '')).catch(() => '');
    return tel;
  }
};

const getEmail = (page) => page.evaluate(() => {
  const hits = document.body.innerText.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi) || [];
  return hits[0] || '';
});

// ── main ──────────────────────────────────────────────────────────────────────

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  const listPage = await ctx.newPage();

  await listPage.goto(TARGET_URL, { waitUntil: 'networkidle' });
  // await acceptCookies(listPage);

  // Collect listing URLs across pages
  const seen = new Set();
  const urls = [];
  for (let p = 1; p <= PAGES_TO_SCRAPE; p++) {
    await scrollToBottom(listPage);
    for (const u of await getListingUrls(listPage)) {
      if (!seen.has(u)) { seen.add(u); urls.push(u); }
    }
    console.log(`Page ${p}: ${urls.length} links total`);
    if (p < PAGES_TO_SCRAPE && !await nextPage(listPage)) break;
  }

  // Scrape each listing in parallel batches
  const rows = [];
  for (let i = 0; i < urls.length; i += POOL_SIZE) {
    const batch = urls.slice(i, i + POOL_SIZE);
    const results = await Promise.all(batch.map(async (url, idx) => {
      const dp = await ctx.newPage();
      try {
        await dp.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await dp.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
        let company = clean(await getCompanyName(dp));
        if (!company) company = "None";
        const phone = await getPhone(dp);
        const email = await getEmail(dp);
        console.log(`[${i + idx + 1}/${urls.length}] ${company} | ${phone || '-'} | ${email || '-'}`);
        return { '#': i + idx + 1, CompanyName: company, Phone: phone, Email: email, URL: url };
      } catch (e) {
        console.log(`[${i + idx + 1}/${urls.length}] error: ${e.message}`);
        return null;
      } finally {
        await dp.close();
      }
    }));
    rows.push(...results.filter(Boolean));
  }

  // Export
  const outDir = path.join(__dirname, 'public');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const file = path.join(outDir, `housing_${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(rows), 'Housing');
  xlsx.writeFile(wb, file);
  console.log(`\nSaved ${rows.length} records → ${file}`);

  await browser.close();
})();
