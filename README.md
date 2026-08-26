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
- Track price-history coverage by expected market session, including completed, no-data, failed, and deferred-retry intervals.
- Use a dedicated Price Update page with progress, status filters, per-asset retry, provider dates, and coverage details.
- Store USD/JPY FX rates for US stock JPY valuation.
- Show a portfolio summary with market value, unrealized P/L, FIFO realized P/L, dividend/distribution income, total realized P/L, day P/L, and allocation percentage.
- Show transaction pages with pagination.
- Show trade charts with saved price history, newest-first buy/sell history, and technical indicators.
- Show combined monthly/yearly summary history with historical period prices, Combined Total P/L diff, and a Detail drilldown for period changes.
- Generate a daily portfolio report from the local SQLite snapshot, either with the OpenAI API or by copying an English, Chinese, or Japanese prompt into ChatGPT.
- Show the application version in the navigation bar.

## Version 0.2.1

This patch release keeps recovered fund updates from remaining failed on the Price Update page:

- Remove obsolete failed coverage intervals when they fall outside the provider's current publication range, while preserving completed history.
- Retry Yahoo fund history once with a freshly loaded JWT when the first token receives HTTP 401.
- Add regression coverage for legacy failed intervals and stale Yahoo JWT recovery.

## Version 0.2.0

This release makes mapped Yahoo Finance Japan fund updates resilient to page-state variations and NAV publication lag:

- Accept both ordinary and escaped Yahoo fund token representations while rejecting malformed or missing tokens without persisting token material.
- Preserve Yahoo's published NAV date and the existing per-10,000-unit conversion instead of labeling the prior NAV with the new Japanese calendar date.
- Represent an eligible but unpublished fund session as pending publication, and stop history requests at the latest provider-derived NAV date.
- Keep genuine transport, token, and payload failures visible with retry backoff; manual Retry preserves older NAV rows and completes recovered coverage.
- Fall back to recent history when the public page's NAV markup cannot be parsed, without requesting an unpublished date.
- Require explicit secure authentication for non-local startup while retaining an explicit local-only development mode.
- Restore the tested Linux runtime and dependency workflow.
- Add deterministic offline provider, Price Update, and temporary-SQLite coverage without requiring a database migration.

## Version 0.1.3

This release prepares a more reliable, inspectable price-update workflow:

- Move price updates from the Summary page to a dedicated `/prices` page with live progress, status filters, provider dates, and per-asset retry.
- Fill multiple missing history intervals in one update run, newest first, under a shared request and time budget.
- Persist market-session coverage as `COMPLETE`, `NO_DATA`, or `FAILED`, so successful and terminal no-data ranges are not requested repeatedly.
- Add retry backoff for provider errors and a manual retry action that bypasses the waiting period for one asset.
- Judge expected dates with Japanese and US market calendars instead of treating every weekday as a trading session.
- Keep live quote snapshots separate from completed daily history when deciding whether a date is covered.
- Fix foreign-currency MMF valuation and normalize SBI Okasan MMF name variants so one holding is not split into duplicate assets.
- Use Tokyo, New York, fund publication, and imported MMF dates according to each asset's data domain.

## Version 0.1.2

This release expanded chart analysis and historical data coverage:

- Add SMA 20/50/200, Bollinger Bands 20/2, RSI 14, and MACD 12/26/9 to the Trade Chart.
- Show 20-day annualized volatility, 52-week high/low, and drawdown when enough history is available.
- Backfill older Japanese stock history through J-Quants while keeping Yahoo-compatible data for recent and archive ranges.
- Start history from the earlier of two years ago or the oldest BUY date.
- List trade history newest first and show the application version in the navigation bar.
- Normalize SBI Okasan US-dollar money-market-fund name variants.

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

The app protects portfolio pages with a simple password login and an HTTP-only JWT cookie. Normal startup is fail-closed: set an authentication password of at least 12 characters and an independent JWT signing secret of at least 32 characters before running the app:

```powershell
$env:SBI_AUTH_PASSWORD = Read-Host "Enter the application password"
$env:SBI_JWT_SECRET = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
npm start
```

Known placeholder values are rejected, and the two values must differ. Startup errors name the invalid setting without printing its value.

For local development only, explicitly enable the local-only posture:

```powershell
$env:SBI_LOCAL_ONLY="true"
npm start
```

Local-only mode binds to `127.0.0.1`, uses `admin` when no password is supplied, and uses a separate development-only JWT secret. Never enable `SBI_LOCAL_ONLY` for an internet-facing deployment.

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

The Japanese-stock history split assumes the free-tier coverage used when this integration was built: J-Quants supplies the older part of the latest two years, while Yahoo-compatible history supplies the newest 12 weeks and dates older than two years. Enter the key without echoing it, save it as a user environment variable, and also load it into the current PowerShell session before starting the app:

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

The app still starts without this key, but Japanese-stock dates assigned to the J-Quants range will remain failed until a key is configured or those dates already exist in SQLite.

Optional price-history limits:

```powershell
$env:PRICE_HISTORY_MAX_REQUESTS="40"
$env:PRICE_HISTORY_MAX_DURATION_MS="600000"
```

These values limit one Update All run. Failed intervals are saved with retry backoff, so a later run can continue without starting over.

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
docker run --rm -p 8080:80 -v sbi-portfolio-data:/app/data -e SBI_AUTH_PASSWORD -e SBI_JWT_SECRET sbi-portfolio-tracker
```

Or run the published image:

```powershell
docker run --rm -p 8080:80 -v sbi-portfolio-data:/app/data -e SBI_AUTH_PASSWORD -e SBI_JWT_SECRET iriyano/sbi-portfolio-tracker
```

Open:

```text
http://localhost:8080/
```

## Main Pages

- `/import` - upload SBI CSV files for transactions, dividends/distributions, FX, and gold.
- `/transactions` - view imported normalized transactions.
- `/summary` - view the combined portfolio and FX summary, and edit fund price-source mappings.
- `/prices` - update current prices and history, monitor progress, filter status, inspect coverage, and retry one asset.
- `/trade-chart` - view price history, buy/sell markers, and technical indicators.
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

Use `Update All` on `/prices`. The job runs in the background and the page polls `/prices/status` to show progress. `Retry` runs the same workflow for one asset and ignores that asset's current retry waiting period.

Current behavior:

- Skips assets with zero net quantity.
- Fetches latest stock prices from Yahoo-compatible chart data.
- For Japanese stock history, Yahoo supplies the newest 12 weeks, J-Quants supplies older dates within the latest two years, and Yahoo archive history supplies dates older than two years.
- Price history starts from the earlier of two years ago or the oldest BUY date for each active stock, fund, or gold holding.
- Fetches mapped fund prices only when a fund mapping URL/code is saved.
- Fetches gold price and converts it to JPY per gram.
- Uses the imported SBI transaction price for foreign-currency MMFs; MMFs are not sent to a market-history provider.
- Saves stock daily OHLC price history.
- Saves mapped fund NAV history. Fund NAV is stored per 10,000 units for charting and converted back to unit price for summary valuation.
- Saves gold daily history by combining `GC=F` gold futures with `JPY=X` USD/JPY and converting each date to JPY per gram.
- Saves a latest-price snapshot row when the latest quote succeeds but the daily history endpoint has no row yet.
- Does not count a live snapshot as a completed daily market session.
- Saves interval coverage as `COMPLETE`, `NO_DATA`, or `FAILED`. Completed rows and valid pre-listing/no-data dates are not fetched again.
- Requests missing intervals newest first. One run defaults to at most 40 history requests and 10 minutes across all assets.
- Defers failed dates with exponential backoff from 1 to 24 hours; rate-limit failures wait 15 minutes. Per-asset Retry bypasses the wait once.
- Paces J-Quants requests at 12.5-second intervals for the Free-plan rate limit.
- Uses bounded provider windows and a short delay between assets, and stops the remaining work when a provider rate limit requires it.

The history boundary called "today" depends on the asset:

- Japanese stocks use the latest completed Tokyo market date.
- US stocks and gold use the latest completed New York market session.
- Funds use the latest published NAV date when known.
- MMFs use the imported SBI transaction price date.

Expected history dates exclude weekends and known Japanese/US market holidays. The Price Update table shows the provider price date, completed-history range, live snapshot date, pending session count, next retry, and the persisted coverage intervals.

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

Available technical overlays and panels:

- SMA 20, SMA 50, and SMA 200
- Bollinger Bands 20/2
- RSI 14 with 30/70 reference levels
- MACD 12/26/9 with signal line and histogram
- 20-day annualized realized volatility, 52-week high/low, and drawdown summary values

Indicators are calculated locally from saved daily closing prices. Values remain unavailable until enough completed daily history exists. Money-market funds are excluded because their stable imported NAV is not useful for these signals.

## Tests

```powershell
npm test
```

Current tests cover:

- authentication and application-version wiring
- report, Tokyo-market, New York-market, fund-publication, and MMF date domains
- Japanese and US market-calendar sessions and holidays
- interval coverage normalization, missing-window selection, no-data classification, and retry backoff
- Price Update page routes and controls
- portfolio FIFO, MMF, income, FX conversion, day-change, and mixed-asset summary calculations
- stock, fund, US stock, dividend/distribution, FX, gold, Yahoo, and J-Quants parsing helpers
- SQLite storage, including persisted price-history coverage
- SMA, Bollinger Bands, RSI, MACD, volatility, and 52-week calculations
- daily report snapshots and multilingual ChatGPT prompts
- trade-chart preparation, source priority, markers, and newest-first history
- monthly/yearly combined history and period-detail attribution

## License

ISC License. See `LICENSE`.
