# FMP API — full endpoint reference

Base URL: `https://financialmodelingprep.com/stable/`

Auth, either form:
- Header: `apikey: <FMP_API_KEY>`
- Query: `?apikey=<FMP_API_KEY>` (use `&apikey=` if other params exist)

Errors: `401` bad/missing key, `429` rate limited (back off), `500` server side.

Key lives in env as `FMP_API_KEY`, server-side only. Never in the client bundle.

---

## Where these map to our features

| Our feature | Endpoints |
|---|---|
| Universe definition | `company-screener`, `stock-list`, `actively-trading-list`, `delisted-companies` |
| Exposure graph | `revenue-product-segmentation`, `revenue-geographic-segmentation`, `profile`, `stock-peers`, `financial-statement-full-as-reported` |
| Constraint state (tightening) | `earning-call-transcript`, `earning-call-transcript-dates`, `financial-statement-full-as-reported` (backlog/RPO custom XBRL tags) |
| Capture gate | `ratios`, `key-metrics`, `income-statement`, `income-statement-growth` |
| Recognition score | `grades-consensus`, `grades-historical`, `etf/asset-exposure`, `institutional-ownership/symbol-positions-summary`, `price-target-consensus` |
| Estimate revisions | `analyst-estimates`, `price-target-summary`, `upgrades-downgrades-consensus-bulk` |
| Price feed / triggers | `historical-price-eod/full`, `historical-price-eod/light`, `eod-bulk`, `stock-price-change` |
| Liquidity gate | `shares-float`, `quote` (volAvg), `historical-price-eod/full` (volume) |
| Insider clustering | `insider-trading/search`, `insider-trading/statistics`, `insider-trading-transaction-type` |
| Diff engine | `sec-filings-search/symbol`, `sec-filings-8k`, `news/press-releases`, `grades-historical` |
| Journal resurfacing / calendar | `earnings`, `earnings-calendar`, `dividends-calendar`, `splits-calendar`, `holidays-by-exchange` |
| Reverse DCF | `enterprise-values`, `custom-discounted-cash-flow`, `treasury-rates`, `key-metrics` |
| Constraint supply ledger | `news/press-releases`, `mergers-acquisitions-latest`, `fundraising-latest` |

---

## Search

| Endpoint | Purpose |
|---|---|
| `search-symbol?query=AAPL` | Ticker lookup by symbol |
| `search-name?query=AA` | Ticker lookup by company name |
| `search-cik?cik=320193` | CIK lookup |
| `search-cusip?cusip=037833100` | CUSIP lookup |
| `search-isin?isin=US0378331005` | ISIN lookup |
| `company-screener` | Filter by marketCap, sector, industry, beta, price, dividend, volume, exchange, country, isEtf, isFund, isActivelyTrading, page, limit |
| `search-exchange-variants?symbol=AAPL` | All exchanges a symbol trades on |

## Directory

| Endpoint | Purpose |
|---|---|
| `stock-list` | All available symbols |
| `financial-statement-symbol-list` | Symbols with financial statements |
| `cik-list?page=0&limit=1000` | All SEC-registered CIKs |
| `symbol-change` | Ticker changes from M&A, splits, renames |
| `etf-list` | All ETF symbols |
| `actively-trading-list` | Currently trading securities |
| `earnings-transcript-list` | Symbols with transcripts + counts |
| `available-exchanges` | Supported exchanges |
| `available-sectors` | Sector list |
| `available-industries` | Industry list |
| `available-countries` | Country list |

## Company

| Endpoint | Purpose |
|---|---|
| `profile?symbol=AAPL` | Full profile: sector, industry, mktCap, description, CEO, CIK, ISIN, CUSIP, employees, dcf |
| `profile-cik?cik=320193` | Same by CIK |
| `company-notes?symbol=AAPL` | Company-issued notes |
| `stock-peers?symbol=AAPL` | Peer companies, same sector/mktcap |
| `delisted-companies?page=0&limit=100` | Delisted list |
| `employee-count?symbol=AAPL` | Current headcount + SEC links |
| `historical-employee-count?symbol=AAPL` | Headcount over time |
| `market-capitalization?symbol=AAPL` | Market cap |
| `market-capitalization-batch?symbols=AAPL,MSFT` | Batch market cap |
| `historical-market-capitalization?symbol=AAPL` | Market cap over time |
| `shares-float?symbol=AAPL` | Free float, float shares, outstanding |
| `shares-float-all?page=0&limit=1000` | Float for all companies |
| `mergers-acquisitions-latest?page=0&limit=100` | Recent M&A |
| `mergers-acquisitions-search?name=Apple` | M&A search |
| `key-executives?symbol=AAPL` | Executives, titles, compensation |
| `governance-executive-compensation?symbol=AAPL` | Detailed comp with filing links |
| `executive-compensation-benchmark` | Industry average comp |

## Quote

Nasdaq delayed 15 min. Real-time requires a user declaration form.

| Endpoint | Purpose |
|---|---|
| `quote?symbol=AAPL` | Full quote incl. volAvg |
| `quote-short?symbol=AAPL` | Price, volume, change |
| `aftermarket-trade?symbol=AAPL` | Post-market trades |
| `aftermarket-quote?symbol=AAPL` | Post-market bid/ask |
| `stock-price-change?symbol=AAPL` | Change across daily/weekly/monthly/long-term windows |
| `batch-quote?symbols=AAPL` | Multiple full quotes |
| `batch-quote-short?symbols=AAPL` | Multiple short quotes |
| `batch-aftermarket-trade?symbols=AAPL` | Batch post-market trades |
| `batch-aftermarket-quote?symbols=AAPL` | Batch post-market quotes |
| `batch-exchange-quote?exchange=NASDAQ` | Every quote on an exchange |
| `batch-mutualfund-quotes` | Mutual fund quotes |
| `batch-etf-quotes` | ETF quotes |
| `batch-commodity-quotes` | Commodity quotes |
| `batch-crypto-quotes` | Crypto quotes |
| `batch-forex-quotes` | Forex quotes |
| `batch-index-quotes` | Index quotes |

## Statements

| Endpoint | Purpose |
|---|---|
| `income-statement?symbol=AAPL` | Income statement |
| `balance-sheet-statement?symbol=AAPL` | Balance sheet |
| `cash-flow-statement?symbol=AAPL` | Cash flow |
| `latest-financial-statements?page=0&limit=250` | Most recent filings across companies |
| `income-statement-ttm?symbol=AAPL` | Trailing twelve months |
| `balance-sheet-statement-ttm?symbol=AAPL` | TTM balance sheet |
| `cash-flow-statement-ttm?symbol=AAPL` | TTM cash flow |
| `key-metrics?symbol=AAPL` | Revenue, net income, P/E, etc. |
| `ratios?symbol=AAPL` | Profitability, liquidity, efficiency ratios |
| `key-metrics-ttm?symbol=AAPL` | TTM key metrics |
| `ratios-ttm?symbol=AAPL` | TTM ratios |
| `financial-scores?symbol=AAPL` | Altman Z-Score, Piotroski Score |
| `owner-earnings?symbol=AAPL` | Adjusted cash available to shareholders |
| `enterprise-values?symbol=AAPL` | Equity + debt total value |
| `income-statement-growth?symbol=AAPL` | Revenue/profit/expense growth |
| `balance-sheet-statement-growth?symbol=AAPL` | Asset/liability/equity growth |
| `cash-flow-statement-growth?symbol=AAPL` | Cash flow growth |
| `financial-growth?symbol=AAPL` | Growth across all three statements |
| `financial-reports-dates?symbol=AAPL` | Available report dates |
| `financial-reports-json?symbol=AAPL&year=2022&period=FY` | Full 10-K as JSON |
| `financial-reports-xlsx?symbol=AAPL&year=2022&period=FY` | Full 10-K as XLSX |
| `revenue-product-segmentation?symbol=AAPL` | Revenue split by product line |
| `revenue-geographic-segmentation?symbol=AAPL` | Revenue split by region |
| `income-statement-as-reported?symbol=AAPL` | Raw as-filed income statement |
| `balance-sheet-statement-as-reported?symbol=AAPL` | Raw as-filed balance sheet |
| `cash-flow-statement-as-reported?symbol=AAPL` | Raw as-filed cash flow |
| `financial-statement-full-as-reported?symbol=AAPL` | All raw XBRL tags incl. custom ones |

## Charts / historical prices

| Endpoint | Purpose |
|---|---|
| `historical-price-eod/light?symbol=AAPL` | Date, price, volume |
| `historical-price-eod/full?symbol=AAPL` | OHLC, volume, change, VWAP |
| `historical-price-eod/non-split-adjusted?symbol=AAPL` | Unadjusted for splits |
| `historical-price-eod/dividend-adjusted?symbol=AAPL` | Dividend-adjusted |
| `historical-chart/1min?symbol=AAPL` | 1-minute intraday |
| `historical-chart/5min?symbol=AAPL` | 5-minute intraday |
| `historical-chart/15min?symbol=AAPL` | 15-minute intraday |
| `historical-chart/30min?symbol=AAPL` | 30-minute intraday |
| `historical-chart/1hour?symbol=AAPL` | Hourly |
| `historical-chart/4hour?symbol=AAPL` | 4-hourly |

## Economics

| Endpoint | Purpose |
|---|---|
| `treasury-rates` | Treasury rates, all maturities |
| `economic-indicators?name=GDP` | GDP, unemployment, inflation, etc. |
| `economic-calendar` | Upcoming economic data releases |
| `market-risk-premium` | Market risk premium by date |

## Calendar — earnings, dividends, splits, IPOs

| Endpoint | Purpose |
|---|---|
| `dividends?symbol=AAPL` | Dividend history for a symbol |
| `dividends-calendar` | All upcoming dividends |
| `earnings?symbol=AAPL` | Earnings dates, EPS estimates, revenue projections |
| `earnings-calendar` | All upcoming/past earnings announcements |
| `ipos-calendar` | Upcoming IPOs |
| `ipos-disclosure` | IPO regulatory filings |
| `ipos-prospectus` | IPO pricing, discounts, proceeds |
| `splits?symbol=AAPL` | Split history |
| `splits-calendar` | Upcoming splits |

## Earnings transcripts

| Endpoint | Purpose |
|---|---|
| `earning-call-transcript-latest` | Most recent transcripts across companies |
| `earning-call-transcript?symbol=AAPL&year=2020&quarter=3` | Full transcript text |
| `earning-call-transcript-dates?symbol=AAPL` | Available transcript dates by FY/quarter |
| `earnings-transcript-list` | All symbols with transcripts + counts |

## News

| Endpoint | Purpose |
|---|---|
| `fmp-articles?page=0&limit=20` | FMP's own articles |
| `news/general-latest?page=0&limit=20` | General news |
| `news/press-releases-latest?page=0&limit=20` | Latest press releases |
| `news/stock-latest?page=0&limit=20` | Latest stock news |
| `news/crypto-latest?page=0&limit=20` | Latest crypto news |
| `news/forex-latest?page=0&limit=20` | Latest forex news |
| `news/press-releases?symbols=AAPL` | Press releases by symbol |
| `news/stock?symbols=AAPL` | Stock news by symbol |
| `news/crypto?symbols=BTCUSD` | Crypto news by symbol |
| `news/forex?symbols=EURUSD` | Forex news by pair |

## Form 13F / institutional ownership

| Endpoint | Purpose |
|---|---|
| `institutional-ownership/latest?page=0&limit=100` | Latest 13F filings |
| `institutional-ownership/extract?cik=&year=&quarter=` | Extract holdings from a filing |
| `institutional-ownership/dates?cik=` | Filing dates for a holder |
| `institutional-ownership/extract-analytics/holder?symbol=&year=&quarter=` | Analytical breakdown by holder |
| `institutional-ownership/holder-performance-summary?cik=` | Holder performance vs benchmark |
| `institutional-ownership/holder-industry-breakdown?cik=&year=&quarter=` | Holder sector allocation |
| `institutional-ownership/symbol-positions-summary?symbol=&year=&quarter=` | Investor count, share changes, ownership % over time |
| `institutional-ownership/industry-summary?year=&quarter=` | Industry-level institutional flows |

## Analyst

| Endpoint | Purpose |
|---|---|
| `analyst-estimates?symbol=AAPL&period=annual&page=0&limit=10` | Consensus revenue, EPS forecasts |
| `ratings-snapshot?symbol=AAPL` | Current financial rating |
| `ratings-historical?symbol=AAPL` | Rating history |
| `price-target-summary?symbol=AAPL` | Average price targets by timeframe |
| `price-target-consensus?symbol=AAPL` | High/low/median/consensus targets |
| `grades?symbol=AAPL` | Latest analyst grade actions |
| `grades-historical?symbol=AAPL` | Grade changes over time |
| `grades-consensus?symbol=AAPL` | Count of strong buy/buy/hold/sell/strong sell |

## Market performance

| Endpoint | Purpose |
|---|---|
| `sector-performance-snapshot?date=` | Sector performance on a date |
| `industry-performance-snapshot?date=` | Industry performance on a date |
| `historical-sector-performance?sector=Energy` | Sector performance over time |
| `historical-industry-performance?industry=Biotechnology` | Industry performance over time |
| `sector-pe-snapshot?date=` | Sector P/E ratios |
| `industry-pe-snapshot?date=` | Industry P/E ratios |
| `historical-sector-pe?sector=Energy` | Sector P/E over time |
| `historical-industry-pe?industry=Biotechnology` | Industry P/E over time |
| `biggest-gainers` | Largest daily price increases |
| `biggest-losers` | Largest daily price drops |
| `most-actives` | Highest volume |

## Technical indicators

All take `?symbol=AAPL&periodLength=10&timeframe=1day`.

`technical-indicators/sma`, `/ema`, `/wma`, `/dema`, `/tema`, `/rsi`, `/standarddeviation`, `/williams`, `/adx`

## ETF & mutual funds

| Endpoint | Purpose |
|---|---|
| `etf/holdings?symbol=SPY` | Securities held and weights |
| `etf/info?symbol=SPY` | Expense ratio, AUM, fund details |
| `etf/country-weightings?symbol=SPY` | Country allocation |
| `etf/asset-exposure?symbol=AAPL` | Which ETFs hold this stock, weight % |
| `etf/sector-weightings?symbol=SPY` | Sector allocation |
| `funds/disclosure-holders-latest?symbol=AAPL` | Latest fund disclosures |
| `funds/disclosure?symbol=VWO&year=2023&quarter=4` | Fund disclosure detail |
| `funds/disclosure-holders-search?name=` | Search disclosures by fund name |
| `funds/disclosure-dates?symbol=VWO` | Disclosure filing dates |

## SEC filings

| Endpoint | Purpose |
|---|---|
| `sec-filings-8k?from=&to=&page=0&limit=100` | Latest 8-Ks |
| `sec-filings-financials?from=&to=&page=0&limit=100` | Latest financial filings |
| `sec-filings-search/form-type?formType=8-K&from=&to=` | Filings by form type |
| `sec-filings-search/symbol?symbol=AAPL&from=&to=` | Filings by symbol |
| `sec-filings-search/cik?cik=&from=&to=` | Filings by CIK |
| `sec-filings-company-search/name?company=Berkshire` | Company lookup by name |
| `sec-filings-company-search/symbol?symbol=AAPL` | Company lookup by symbol |
| `sec-filings-company-search/cik?cik=` | Company lookup by CIK |
| `sec-profile?symbol=AAPL` | Full SEC company profile |
| `standard-industrial-classification-list` | SIC codes and titles |
| `industry-classification-search` | Search industry classifications |
| `all-industry-classification` | All SIC data |

## Insider trades

| Endpoint | Purpose |
|---|---|
| `insider-trading/latest?page=0&limit=100` | Latest insider transactions |
| `insider-trading/search?page=0&limit=100` | Search by company or symbol |
| `insider-trading/reporting-name?name=Zuckerberg` | Search by insider name |
| `insider-trading-transaction-type` | All transaction type codes |
| `insider-trading/statistics?symbol=AAPL` | Aggregated purchase/sale stats |
| `acquisition-of-beneficial-ownership?symbol=AAPL` | Beneficial ownership changes |

## Indexes

| Endpoint | Purpose |
|---|---|
| `index-list` | All market indexes |
| `quote?symbol=^VIX` | Index quote |
| `quote-short?symbol=^VIX` | Short index quote |
| `batch-index-quotes` | All index quotes |
| `historical-price-eod/light?symbol=^VIX` | Index EOD history |
| `historical-price-eod/full?symbol=^VIX` | Full index EOD history |
| `historical-chart/1min\|5min\|1hour?symbol=^VIX` | Index intraday |
| `sp500-constituent` | S&P 500 members |
| `nasdaq-constituent` | Nasdaq members |
| `dowjones-constituent` | Dow members |
| `historical-sp500-constituent` | S&P additions/removals over time |
| `historical-nasdaq-constituent` | Nasdaq changes over time |
| `historical-dowjones-constituent` | Dow changes over time |

## Market hours

| Endpoint | Purpose |
|---|---|
| `exchange-market-hours?exchange=NASDAQ` | Open/close times |
| `holidays-by-exchange?exchange=NASDAQ` | Non-trading days |
| `all-exchange-market-hours` | Hours for all exchanges |

## Commodities

`commodities-list`, `quote?symbol=GCUSD`, `quote-short?symbol=GCUSD`, `batch-commodity-quotes`, `historical-price-eod/light?symbol=GCUSD`, `historical-price-eod/full?symbol=GCUSD`, `historical-chart/1min|5min|1hour?symbol=GCUSD`

## Discounted cash flow

| Endpoint | Purpose |
|---|---|
| `discounted-cash-flow?symbol=AAPL` | Standard DCF valuation |
| `levered-discounted-cash-flow?symbol=AAPL` | DCF incorporating debt |
| `custom-discounted-cash-flow?symbol=AAPL` | DCF with your own assumptions |
| `custom-levered-discounted-cash-flow?symbol=AAPL` | Levered DCF with your assumptions |

## Forex

`forex-list`, `quote?symbol=EURUSD`, `quote-short?symbol=EURUSD`, `batch-forex-quotes`, `historical-price-eod/light|full?symbol=EURUSD`, `historical-chart/1min|5min|1hour?symbol=EURUSD`

## Crypto

`cryptocurrency-list`, `quote?symbol=BTCUSD`, `quote-short?symbol=BTCUSD`, `batch-crypto-quotes`, `historical-price-eod/light|full?symbol=BTCUSD`, `historical-chart/1min|5min|1hour?symbol=BTCUSD`

## Senate / House

| Endpoint | Purpose |
|---|---|
| `senate-latest?page=0&limit=100` | Latest Senate disclosures |
| `house-latest?page=0&limit=100` | Latest House disclosures |
| `senate-trades?symbol=AAPL` | Senate trades in a symbol |
| `senate-trades-by-name?name=Jerry` | Senate trades by member |
| `senate-trades-by-id` | Senate trades by member ID |
| `house-trades?symbol=AAPL` | House trades in a symbol |
| `house-trades-by-name?name=James` | House trades by member |
| `house-trades-by-id` | House trades by member ID |
| `senate-profile` | Member party, state, position, years |
| `senate-positions` | Positions held with term dates |
| `senate-net-worth?senateID=&page=0&limit=250` | Itemized net worth |
| `senate-net-worth-aggregated?senateID=` | Aggregated net worth by year |

## ESG

`esg-disclosures?symbol=AAPL`, `esg-ratings?symbol=AAPL`, `esg-benchmark`

## Commitment of Traders

`commitment-of-traders-report`, `commitment-of-traders-analysis`, `commitment-of-traders-list`

## Fundraisers

| Endpoint | Purpose |
|---|---|
| `crowdfunding-offerings-latest?page=0&limit=100` | Recent crowdfunding campaigns |
| `crowdfunding-offerings-search?name=` | Search campaigns |
| `crowdfunding-offerings?cik=` | Campaigns by company |
| `fundraising-latest?page=0&limit=10` | Latest equity offerings |
| `fundraising-search?name=` | Search equity offerings |
| `fundraising?cik=` | Offerings by company |

## Bulk

One call covering many symbols. Check tier availability — these are the rate-limit
solution if accessible.

| Endpoint | Purpose |
|---|---|
| `profile-bulk?part=0` | Bulk company profiles |
| `rating-bulk` | Bulk ratings |
| `dcf-bulk` | Bulk DCF valuations |
| `scores-bulk` | Bulk financial scores |
| `price-target-summary-bulk` | Bulk price targets |
| `etf-holder-bulk?part=1` | Bulk ETF holdings |
| `upgrades-downgrades-consensus-bulk` | Bulk analyst consensus |
| `key-metrics-ttm-bulk` | Bulk TTM metrics |
| `ratios-ttm-bulk` | Bulk TTM ratios |
| `peers-bulk` | Bulk peer lists |
| `earnings-surprises-bulk?year=2026` | Bulk earnings surprises |
| `income-statement-bulk?year=2026&period=Q1` | Bulk income statements |
| `income-statement-growth-bulk?year=&period=` | Bulk income growth |
| `balance-sheet-statement-bulk?year=&period=` | Bulk balance sheets |
| `balance-sheet-statement-growth-bulk?year=&period=` | Bulk balance sheet growth |
| `cash-flow-statement-bulk?year=&period=` | Bulk cash flow |
| `cash-flow-statement-growth-bulk?year=&period=` | Bulk cash flow growth |
| `eod-bulk?date=2024-10-22` | All EOD prices for one date |

## TipRanks — requires paid add-on

Ratings history limited to 3 years without Enterprise.

| Endpoint | Purpose |
|---|---|
| `tipranks-search` | Individual analyst ratings, targets, actions |
| `tipranks-pit-symbol?symbol=AAPL` | Point-in-time ratings for a symbol |
| `tipranks-pit-analyst` | Point-in-time ratings by analyst |
| `tipranks-symbol-summary?symbol=AAPL` | Rating rollup + price target accuracy |
| `tipranks-analyst-summary?expertUID=` | Analyst track record |
| `tipranks-firm-summary?firmName=Morgan Stanley` | Firm-level rollup |
| `tipranks-analysts` | Analyst directory lookup |
