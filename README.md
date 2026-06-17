# SBI Portfolio Tracker

A local Node.js web app for importing SBI Securities CSV files and reviewing portfolio positions, realized/unrealized P/L, price history, FX trades, and gold holdings.

The app is built for personal analysis. It is not tax software and does not make tax-reporting claims.

## Features

- Import SBI domestic stock and investment fund transaction CSV files.
- Import SBI US stock payment records.
- Import SBI FX settlement CSV files.
- Import SBI gold order CSV files as detailed `GOLD_JPY` trade rows.
- Store data locally in SQLite.
- Calculate stock and fund positions together.
- Calculate FIFO realized P/L and remaining cost.
- Refresh latest prices for Japanese stocks, US stocks, mapped funds, and gold.
- Save daily stock, fund, and gold price history for charting.
- Store USD/JPY FX rates for US stock JPY valuation.
- Show a portfolio summary with market value, unrealized P/L, realized P/L, day P/L, and allocation percentage.
- Show transaction pages with pagination.
- Show trade charts with saved price history and buy/sell markers.

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

## Docker

The Docker image uses a multi-stage `node:24-alpine` build so the runtime image avoids Debian Perl packages that are commonly flagged by vulnerability scans.

Build the image:

```powershell
docker build -t sbi-portfolio-tracker .
```

Run it with a persistent SQLite data volume and login settings:

```powershell
docker run --rm -p 8080:80 -v sbi-portfolio-data:/app/data -e SBI_AUTH_PASSWORD=change-this-password -e SBI_JWT_SECRET=change-this-long-random-secret sbi-portfolio-tracker
```

Open:

```text
http://localhost:8080/
```

## Main Pages

- `/import` - upload SBI CSV files for transactions, FX, and gold.
- `/transactions` - view imported normalized transactions.
- `/summary` - view portfolio summary and update prices.
- `/trade-chart` - view price history with buy/sell markers.

## Import Notes

The importer normalizes:

- Japanese stocks as symbols like `7974.T`
- US stocks as symbols like `NVDA`
- Investment funds as custom fund symbols
- Gold as `GOLD_JPY`

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
- Fetches mapped fund prices only when a fund mapping URL/code is saved.
- Fetches gold price and converts it to JPY per gram.
- Saves stock daily OHLC price history.
- Saves mapped fund NAV history. Fund NAV is stored per 10,000 units for charting and converted back to unit price for summary valuation.
- Saves gold daily history by combining `GC=F` gold futures with `JPY=X` USD/JPY and converting each date to JPY per gram.
- Saves a latest-price snapshot row when the latest quote succeeds but the daily history endpoint has no row yet.
- Fetches at most a 30-day price-history window per click.
- Price history starts from the oldest BUY date for each held stock, fund, or gold position.
- Uses a delay between asset requests and stops on rate limits.

For US stocks, chart comparison dates are shifted to the US market date when needed, while the original SBI transaction date remains visible in tables.

Day P/L compares the current JPY market value with the previous saved price-history date. This avoids fake blanks around weekends, holidays, and delayed fund NAV dates.

## Data Source Caveat

Stock and gold price history use Yahoo-compatible chart data. Gold JPY/gram history also depends on USD/JPY chart data. Fund price history uses Yahoo Japan's frontend fund-history endpoint with a short-lived page token. That fund endpoint is not a documented public API, so it should be treated as best-effort for local personal use.

If Yahoo changes a token, endpoint, or response shape, history backfill may fail. The app should keep showing clear fetch errors and can still use latest-price snapshots as a fallback.

## Trade Chart

The trade chart can show:

- 1 month
- 6 months
- 1 year
- all data

The x-axis can be labeled weekly, monthly, or yearly. For ranges smaller than all data, use Previous/Next to page the visible window.

## Tests

```powershell
npm test
```

Current tests cover:

- portfolio FIFO summary calculations
- stock, fund, US stock, FX, and gold parsing helpers
- SQLite storage adapter behavior
- trade chart data preparation
