# AGENTS.md

## Project goal

Build a Node.js web app for analyzing SBI Securities transaction history.

The app should import SBI CSV files, normalize Japanese stocks and investment funds, calculate positions, realized P/L, unrealized P/L, and allow users to input or fetch current prices.

The user wants to see stocks and funds together, not stocks only.

## Important domain rules

- SBI CSV often contains date only, not execution time.
- When buy and sell happen on the same day for the same symbol, default sort order should be:
  1. Buy first
  2. Sell second
- This is an approximation. If exact execution time exists in future CSVs, use it.
- Japanese stocks should use tickers like 7974.T internally.
- TradingView format may use TSE:7974, but the app should use 7974.T unless exporting to TradingView.
- Japanese investment funds do not have normal stock tickers. Treat them as custom fund assets.
- Fund price in SBI CSV may be 基準価額 per 10,000 units. Convert to unit price when calculating quantity/value if needed.
- Do not skip funds.
- Stocks and funds must be shown in the same portfolio dashboard.

## Required features

1. CSV upload
2. SBI transaction parser
3. Normalized transaction table
4. Position calculation
5. Realized P/L using FIFO
6. Current price table
7. Manual price override
8. Yahoo Finance Japan URL field for each asset
9. Dashboard:
   - total cost
   - market value
   - unrealized P/L
   - realized P/L
   - stocks vs funds allocation
10. Export:
   - Google Sheets compatible CSV
   - TradingView stock-only CSV
   - Portseido-style CSV if possible

## Tech stack

- Node.js
- TypeScript
- Next.js or Express + React
- SQLite for local storage
- CSV parser library
- No paid APIs initially

## Testing

Create tests for:
- same-day buy/sell ordering
- stock transactions
- investment fund transactions
- FIFO realized P/L
- current price override
- mixed stock + fund portfolio

## Do not do

- Do not skip investment funds.
- Do not rely only on TradingView/Portseido compatibility.
- Do not assume Yahoo Finance Japan scraping is always stable.
- Do not make tax-reporting claims. Calculations are for personal analysis only.