# SBI Portfolio Tracker

[English](README.md) | [中文](README.zh.md) | [日本語](README.ja.md)

A local Node.js web app for importing SBI Securities CSV files and reviewing portfolio positions, realized/unrealized P/L, price history, FX trades, and gold holdings.

The app is built for personal analysis. It is not tax software and does not make tax-reporting claims.

## Features

- Import SBI domestic stock and investment fund transaction CSV files.
- Import SBI US stock payment records.
- Import SBI dividend and distribution CSV files.
- Import SBI FX settlement CSV files.
- Import SBI gold order CSV files as detailed `GOLD_JPY` trade rows.
- Store data locally in SQLite.
- Calculate stock and fund positions together.
- Calculate FIFO realized P/L and remaining cost.
- Refresh latest prices for Japanese stocks, US stocks, mapped funds, and gold.
- Save daily stock, fund, and gold price history for charting.
- Store USD/JPY FX rates for US stock JPY valuation.
- Show a portfolio summary with market value, unrealized P/L, FIFO realized P/L, dividend/distribution income, total realized P/L, day P/L, and allocation percentage.
- Show transaction pages with pagination.
- Show trade charts with saved price history and buy/sell markers.
- Show combined monthly/yearly summary history with historical period prices, Combined Total P/L diff, and a Detail drilldown for period changes.
- Generate a daily portfolio report from the local SQLite snapshot, either with the OpenAI API or by copying an English, Chinese, or Japanese prompt into ChatGPT.

## Version 0.1.1

This release improves period review and income tracking:

- Import SBI dividend/distribution CSV files and include that income in realized P/L.
- Show dividend/distribution income separately in the portfolio summary.
- Calculate older monthly/yearly history rows with saved historical prices at each period end.
- Add `Detail` drilldowns on history rows to explain period P/L changes by asset, FX, and in-period transactions.
- Harden manual ChatGPT prompts in English, Chinese, and Japanese so Deep Research starts with the portfolio report instead of a generic research template.

## Version 0.1.0

This first release is a local-first SBI portfolio tracker with:

- CSV imports for SBI domestic transactions, US stock payment records, dividend/distribution records, FX settlements, and gold orders.
- SQLite storage for local personal use.
- Portfolio summary with FIFO realized P/L, dividend/distribution income, unrealized P/L, day P/L, allocation percentage, and combined portfolio/FX totals.
- Price refresh and saved price history for stocks, mapped funds, gold, and USD/JPY valuation.
- Trade chart and combined summary history pages, including period detail attribution for monthly/yearly P/L changes.
- Daily Report page with API generation, saved reports, and manual ChatGPT prompts in English, Chinese, and Japanese.
- Simple JWT login and Docker support.

## Requirements

- Node.js
- npm

The app uses SQLite through the `sqlite3` package. Data is stored locally under:

```text
data/sbi-portfolio-tracker.sqlite
```

The database file is ignored by Git.

## Setup

```powershell
npm install
npm start
```

By default the app listens on port `80`.

Open:

```text
http://localhost/
```

## Login

The app protects portfolio pages with a simple password login and an HTTP-only JWT cookie.

Set these environment variables before running the app:

```powershell
$env:SBI_AUTH_PASSWORD="change-this-password"
$env:SBI_JWT_SECRET="change-this-long-random-secret"
npm start
```

If they are not set, the local development password defaults to:

```text
admin
```

## Optional OpenAI Setup

The Daily Report page works without an API key by generating prompts that can be copied into ChatGPT. To generate and save reports directly inside the app, set:

```powershell
$env:OPENAI_API_KEY="your-openai-api-key"
```

Optional settings:

```powershell
$env:OPENAI_REPORT_MODEL="gpt-4.1-mini"
$env:OPENAI_WEB_SEARCH_TOOL="web_search"
```

Reports are for personal analysis only. They are not investment, legal, or tax advice.

## Optional J-Quants Setup

J-Quants Free supplies up to two years of Japanese stock daily history with a 12-week delay. Enter the key without echoing it, save it as a user environment variable, and also load it into the current PowerShell session before starting the app:

```powershell
$secret = Read-Host "Enter your J-Quants API key" -AsSecureString
$key = [System.Net.NetworkCredential]::new("", $secret).Password
[Environment]::SetEnvironmentVariable("JQUANTS_API_KEY", $key, "User")
$env:JQUANTS_API_KEY = $key
Remove-Variable secret, key
Write-Host (-not [string]::IsNullOrWhiteSpace($env:JQUANTS_API_KEY))
npm start
```

The check must print `True`. The key is read only by the server and is not saved in SQLite, browser storage, or Git.

## Docker

The Docker image uses a multi-stage `node:24-alpine` build so the runtime image avoids Debian Perl packages that are commonly flagged by vulnerability scans.

Docker Hub:

```text
https://hub.docker.com/r/iriyano/sbi-portfolio-tracker
```

Build the image:

```powershell
docker build -t sbi-portfolio-tracker .
```

Run it with a persistent SQLite data volume and login settings:

```powershell
docker run --rm -p 8080:80 -v sbi-portfolio-data:/app/data -e SBI_AUTH_PASSWORD=change-this-password -e SBI_JWT_SECRET=change-this-long-random-secret sbi-portfolio-tracker
```

Or run the published image:

```powershell
docker run --rm -p 8080:80 -v sbi-portfolio-data:/app/data -e SBI_AUTH_PASSWORD=change-this-password -e SBI_JWT_SECRET=change-this-long-random-secret iriyano/sbi-portfolio-tracker
```

Open:

```text
http://localhost:8080/
```

## Main Pages

- `/import` - upload SBI CSV files for transactions, dividends/distributions, FX, and gold.
- `/transactions` - view imported normalized transactions.
- `/summary` - view portfolio summary and update prices.
- `/trade-chart` - view price history with buy/sell markers.
- `/history` - view monthly/yearly combined summary history, P/L changes, and period detail attribution.
- `/daily-report` - build a daily portfolio report snapshot, generate an API-backed report, or copy a ChatGPT prompt in English, Chinese, or Japanese.

## Daily Report

The Daily Report page builds a compact snapshot from local SQLite data:

- portfolio totals and active holding count
- allocation by asset class
- top holdings and notable P/L movers
- FX summary
- data quality warnings

There are two workflows:

- `Generate today's report`: sends the snapshot to the OpenAI Responses API with web search, then saves the generated Markdown report in SQLite.
- `Use ChatGPT Chat Instead`: copies a ready-to-paste prompt for ChatGPT in English, Chinese, or Japanese. This does not require `OPENAI_API_KEY`.

The app calculates the portfolio numbers locally. The model is only used to write narrative context and connect the snapshot with current market/news information.

When using ChatGPT or Deep Research manually, paste the full generated prompt including the JSON snapshot. Sending only a short trigger such as `@deep research` can produce a generic research-plan template instead of a portfolio report.

## Import Notes

The importer normalizes:

- Japanese stocks as symbols like `7974.T`
- US stocks as symbols like `NVDA`
- Investment funds as custom fund symbols
- Gold as `GOLD_JPY`

Dividend/distribution CSV imports create non-position transaction rows:

- Stock income uses side `DIVIDEND`.
- Fund and MMF income uses side `DISTRIBUTION`.
- Income rows do not change quantity or FIFO lots.
- Portfolio realized P/L includes FIFO realized P/L plus dividend/distribution income.

Gold CSV imports keep aggregate metadata in `gold_holdings`, but individual filled gold orders are also imported into the normal `transactions` table. Those detailed rows are what drive summary FIFO, trade chart buy markers, and gold price-history refresh. The old manual gold entry form has been removed.

SBI CSV files often contain only dates, not exact execution times. The app assigns synthetic ordering:

- BUY at `09:00:00`
- SELL at `15:00:00`

This keeps same-day buy/sell FIFO behavior stable.

## Price Refresh

Use `Update Prices` on `/summary`.

Current behavior:

- Skips assets with zero net quantity.
- Fetches latest stock prices from Yahoo-compatible chart data.
- For Japanese stock history, Yahoo supplies the newest 12 weeks and J-Quants Free supplies older dates within its two-year history limit. Yahoo is also the fallback for any period before that limit when the first BUY is older.
- A successful J-Quants range request is recorded per stock, including a valid no-data result, so later price refreshes do not request the same range again.
- Fetches mapped fund prices only when a fund mapping URL/code is saved.
- Fetches gold price and converts it to JPY per gram.
- Saves stock daily OHLC price history.
- Saves mapped fund NAV history. Fund NAV is stored per 10,000 units for charting and converted back to unit price for summary valuation.
- Saves gold daily history by combining `GC=F` gold futures with `JPY=X` USD/JPY and converting each date to JPY per gram.
- Saves a latest-price snapshot row when the latest quote succeeds but the daily history endpoint has no row yet.
- Fetches J-Quants Free's eligible range in one logical request per Japanese stock and records completed subranges so they are not requested again. Pagination may add HTTP requests.
- Paces J-Quants requests at 12.5-second intervals for the Free-plan rate limit.
- Fetches up to 30 days per Yahoo recent-history request and up to 365 days per Yahoo archive request.
- Price history starts from the earlier of two years ago or the oldest BUY date for each held stock, fund, or gold position.
- Uses a delay between asset requests and stops on rate limits.

For US stocks, chart comparison dates are shifted to the US market date when needed, while the original SBI transaction date remains visible in tables.

Day P/L compares the current JPY market value with the previous saved price-history date. This avoids fake blanks around weekends, holidays, and delayed fund NAV dates.

## Combined Summary History

`/history` calculates the current month and current year through the local current date, so those current rows should match the live Combined Summary. Older monthly and yearly rows are period cutoffs. They use the latest saved price-history row at or before each period end date, falling back to the current asset price only when no historical price row exists.

Use the `Detail` button on a monthly or yearly row to see why the period changed. The detail page compares the selected period end with the previous period end and shows:

- top asset and FX reasons for the Combined Total P/L change
- asset-level market value, unrealized P/L, realized P/L, income, and total P/L changes
- portfolio transactions inside the period
- FX trades inside the period

## Data Source Caveat

Recent stock and gold price history use Yahoo-compatible chart data. Older Japanese stock history uses the official J-Quants API when `JQUANTS_API_KEY` is configured. Gold JPY/gram history also depends on USD/JPY chart data. Fund price history uses Yahoo Japan's frontend fund-history endpoint with a short-lived page token. That fund endpoint is not a documented public API, so it should be treated as best-effort for local personal use.

If Yahoo changes a token, endpoint, or response shape, history backfill may fail. The app should keep showing clear fetch errors and can still use latest-price snapshots as a fallback.

## Trade Chart

The trade chart can show:

- 1 month
- 6 months
- 1 year
- all data

The x-axis can be labeled weekly, monthly, or yearly. For ranges smaller than all data, use Previous/Next to page the visible window.

The chart's trade-history table lists BUY and SELL records newest first.

## Tests

```powershell
npm test
```

Current tests cover:

- portfolio FIFO summary calculations
- stock, fund, US stock, dividend/distribution, FX, and gold parsing helpers
- SQLite storage adapter behavior
- daily report snapshot and ChatGPT prompt generation
- trade chart data preparation

## License

ISC License. See `LICENSE`.
