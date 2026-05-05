# asunnot-oikotie

A Playwright-based scraper that:

1. Thu thập link từng căn từ [asunnot.oikotie.fi](https://asunnot.oikotie.fi/myytavat-asunnot)
2. Vào từng trang chi tiết, lấy tên công ty (Taloyhtiön nimi), số điện thoại (bấm "Näytä numero" nếu có), và email (nếu có)
3. Xuất kết quả ra Excel

## Requirements

- [Node.js](https://nodejs.org/) v18+
- [Playwright](https://playwright.dev/) (installed via npm)

## Installation

```bash
npm install
```

## Usage

Run the scraper by passing the number of result pages you want to scrape:

```bash
node index.js <number_of_pages>
```

### Examples

Scrape 1 page:

```bash
node index.js 1
```

Scrape 10 pages:

```bash
node index.js 10
```

If no number is provided, it defaults to **2 pages**:

```bash
node index.js
```

## Output

The scraped data is exported to an Excel file inside the `public/` folder with a timestamp in the filename:

```
public/housing_2026-05-03T12-00-00-000Z.xlsx
```

Each file contains these columns:

- `#` — Row number
- `CompanyName` — Housing company name (Taloyhtiön nimi)
- `Phone` — Phone number (if available)
- `Email` — Email (if available)
- `URL` — Oikotie detail URL
