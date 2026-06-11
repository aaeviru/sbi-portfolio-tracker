# Data rules

## Same-day buy/sell

If SBI CSV has the same date and same asset but no execution time:

- Buy should be ordered before Sell.
- Synthetic time:
  - Buy: 09:00:00
  - Sell: 15:00:00

Example:

2025/09/30 任天堂 7974 株式現物売 100 12760
2025/09/30 任天堂 7974 株式現物買 100 12700

Normalize as:

2025-09-30 09:00:00 BUY  7974.T 100 12700
2025-09-30 15:00:00 SELL 7974.T 100 12760