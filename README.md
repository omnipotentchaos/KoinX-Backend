# KoinX Transaction Reconciliation Engine (Backend Take-Home)

A production-grade, highly performant **Transaction Reconciliation Engine** built in Node.js, Express, and MongoDB. It ingests transaction logs from a cryptocurrency user and an exchange, flags and logs data-quality issues without silently discarding records, matches them using configurable tolerances, and serves reports through REST APIs and a sleek glassmorphic dashboard interface.

---

## Live Deployed Link
Experience the interactive glassmorphic reconciliation dashboard live on the cloud:
 **[https://koinx-backend-z6fp.onrender.com/](https://koinx-backend-z6fp.onrender.com/)**

---

## Technology Stack
- **Core**: Node.js & Express.js
- **Database**: MongoDB with Mongoose ORM (Hosted on **MongoDB Atlas** cloud)
- **Deployment & Hosting**: **Render** (Automatic web service deployment)
- **CSV Ingestion**: `csv-parser` (Event-driven stream parsing)
- **Tooling**: Nodemon, Dotenv, CORS, UUID

---

## Key Features

1. **Streaming Ingestion & Data Quality Engine**: Streams large CSVs efficiently using `csv-parser`. Malformed dates, empty values, or negative values are flagged as invalid with specific reasons (`validationErrors`) and saved, maintaining a perfect audit trail.
2. **Robust Matching Algorithm**:
   - **Asset Normalization**: Handles case-insensitive and alias mapping (e.g. `bitcoin` / `BTC` normalized to `btc`) at ingestion.
   - **Perspective Matching**: Automatically maps exchange perspective (`TRANSFER_IN`) to user perspective (`TRANSFER_OUT`).
   - **Proximity Filtering**: Filters by configurable timestamp windows and evaluates percentage deviations in decimal quantities.
3. **Immersive UI Dashboard**: Serve static HTML/CSS files natively through Express to provide a beautiful glassmorphism single-page app displaying real-time summaries, tolerance adjustment sliders, distribution visualizers, and detailed discrepancy reports.
4. **Rich REST APIs & CSV Exports**: Supports JSON responses, paginated detailed reports, summary metrics, and direct CSV file downloads.

---

## MongoDB Schema
To support high-speed queries and thorough data auditability, the system defines three Mongoose schemas:

### 1. `Transaction` (Parsed Raw CSV Records)
Stores every record parsed from the User and Exchange files, including flagged/dirty data.
* `runId` (String, indexed): Associates the row with a specific reconciliation execution.
* `source` (String): `'user'` or `'exchange'`.
* `rawRowIndex` (Number): The line index in the source CSV file for easy tracking.
* `transactionId` (String): Original transaction ID from file.
* `timestamp` (Date): Standardized Date object (saved as `null` if malformed).
* `rawTimestamp` (String): Raw timestamp text.
* `type` (String): Transaction action type (e.g. `BUY`, `SELL`, `TRANSFER_OUT`).
* `asset` / `normalizedAsset` (String, indexed): Original asset name and its standardized lowercase token (e.g. `bitcoin` $\to$ `btc`).
* `quantity` (Number) / `rawQuantity` (String): Parsed float value and original text.
* `priceUsd` / `fee` (Number): Price in USD and transactions fee.
* `isValid` (Boolean): Flag indicating if the row passed data quality checks.
* `validationErrors` (Array): Description of logged parsing errors (e.g., `Malformed timestamp`).

### 2. `Run` (Reconciliation Execution Tracks)
Tracks metadata, configuration settings, and summaries of each run.
* `runId` (String, unique indexed): Unique run session ID.
* `status` (String): `'PROCESSING'`, `'COMPLETED'`, or `'FAILED'`.
* `config` (Object): Tolerance values used (`timestampToleranceSeconds` and `quantityTolerancePct`).
* `summary` (Object): Counts of Matched, Conflicting, Unmatched (User/Exchange), and Invalid rows.

### 3. `Result` (Final Reconciliation Matches)
Represents the categorized matches inside the generated report.
* `runId` (String, indexed): Associates report entries with a run.
* `category` (String, indexed): `'MATCHED'`, `'CONFLICTING'`, `'UNMATCHED_USER'`, or `'UNMATCHED_EXCHANGE'`.
* `userTransaction` (Object): Snapshotted copy of the matched user transaction (null if unmatched exchange).
* `exchangeTransaction` (Object): Snapshotted copy of the matched exchange transaction (null if unmatched user).
* `reason` (String): Detailed text explaining why this categorization was decided.

---

## REST API Reference
> [!NOTE]
> For strict compliance with the KoinX specifications, all routes are mounted **both at the root level** (e.g., `POST /reconcile`) and **with the `/api` prefix** (e.g., `POST /api/reconcile`) for dashboard compatibility.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/reconcile` or `/api/reconcile` | Triggers a reconciliation run. Accepts optional overrides in JSON body. |
| `GET` | `/report/:runId` or `/api/report/:runId` | Fetches the full detailed list of matches, paginated. |
| `GET` | `/report/:runId/csv` or `/api/report/:runId/csv` | Downloads the complete reconciliation report as a formatted CSV file. |
| `GET` | `/report/:runId/summary` or `/api/report/:runId/summary` | Fetches a high-level metrics count summary of the run. |
| `GET` | `/report/:runId/unmatched` or `/api/report/:runId/unmatched` | Fetches only unmatched rows with their specific mismatch reasons. |

---

## Key Technical Design Decisions

### 1. Handling Messy Data (No Silent Drops)
* **Decision**: We designed the `Transaction` schema to store both parsed datatypes and original strings (`rawTimestamp`, `rawQuantity`), along with an `isValid` boolean flag and a `validationErrors` array of strings.
* **Rationale**: If Mongoose encounters a malformed timestamp (e.g. `2024-03-09T` in user row 20) or a negative quantity (`-0.1` in user row 21), casting directly into a strict `Date` or `Number` would cause the script to crash. By storing raw strings, we successfully insert *every single row* into the database, flag invalid ones, and log the exact reason. Evaluators and users have complete visibility into dirty files.

### 2. Transaction Snapshots inside `Result` (Denormalization)
* **Decision**: Instead of saving only references (object IDs) of user and exchange transactions in the `ReconciliationResult` collection, we embed a complete copy/snapshot of both transactions directly inside the result document.
* **Rationale**: In MongoDB, performing database Joins (`$lookup`) is slow and CPU-intensive. By denormalizing the snapshots, our APIs can serve the full detailed report (with columns from both user and exchange sides combined) in a single rapid database read. Additionally, it preserves historical records of what was matched at that specific run time if raw transactions are edited later.

### 3. Pre-calculating `normalizedAsset` at Ingestion
* **Decision**: Normalizing crypto symbols (e.g. mapping `bitcoin` to `btc`, trimming, and lowercasing) is done *during parsing* rather than inside the matching engine.
* **Rationale**: The matching engine does O(N * M) comparison loops. Doing alias translation and string formatting dynamically inside double-loops drastically slows down processing. Saving a indexed `normalizedAsset` at ingestion keeps matching operations to incredibly fast, standard direct checks.

### 4. Perspective Mapping & Matching Tie-Breakers
* **Decision**: 
  - Standardized buy/sell match exactly (`BUY` $\leftrightarrow$ `BUY`).
  - Mapped transfer types to their equivalent opposite perspective (`TRANSFER_OUT` $\leftrightarrow$ `TRANSFER_IN`).
  - For timing and quantity tie-breakers: if a user transaction has multiple exchange candidate matches within the window, the engine rates and pairs it with the absolute closest candidate in time, falling back to quantity variance to ensure optimal matches.

---

##  Project Structure

```text
KoinX/
│
├── public/
│   └── index.html           # Beautiful Single-Page Dashboard UI
│
├── src/
│   ├── config/
│   │   └── db.js            # Mongoose connection bootstrapper
│   │
│   ├── models/
│   │   ├── Transaction.js   # DB schema storing valid & flagged CSV rows
│   │   ├── Run.js           # DB schema tracking execution histories and metrics
│   │   └── Result.js        # DB schema storing finalized reconciliation reports
│   │
│   ├── services/
│   │   ├── parser.js        # Streaming CSV parser with field validation
│   │   └── matcher.js       # Core double-pass tolerance matching engine
│   │
│   ├── controllers/
│   │   └── reconcileController.js # Handles API requests & report outputs
│   │
│   ├── routes/
│   │   └── api.js           # REST API endpoints mapping
│   │
│   └── app.js               # Express application initialization
│
├── user_transactions.csv    # Default CSV files provided
├── exchange_transactions.csv
├── .env                     # Configuration tolerances
├── package.json
└── README.md
```

---

## Visual Interactive Dashboard
When you start the server, open **`http://localhost:3000`** in your browser. 
You will see the fully interactive glassmorphic dashboard! 
- Adjust the sliders on the left for custom tolerances.
- Click **Trigger Reconciliation** to instantly launch the parser, ingestion, and matching pipeline.
- Observe real-time count metrics and color-coded match distribution progress bars.
- Filter through categories (Matched, Conflicts, Unmatched) and read exact discrepancies.
- Download the generated report as a **CSV file** with a single click.

---

## Setup and Installation

### 1. Prerequisites
Ensure you have the following installed on your machine:
- **Node.js** (v16.x or higher)
- **MongoDB** (running locally on port `27017` or a custom MongoDB Atlas connection string)

### 2. Install Dependencies
Clone the repository and run the following command in the root folder:
```bash
npm install
```

### 3. Configure Environment Variables
A `.env` file is initialized at the root of the project:
```env
PORT=3000
MONGO_URI=mongodb://localhost:27017/koinx-reconciliation

# Reconciliation tolerances (As per KoinX job assignment specifications)
TIMESTAMP_TOLERANCE_SECONDS=300
QUANTITY_TOLERANCE_PCT=0.01
```
*You can customize `MONGO_URI` to connect to your local or cloud database instance.*

### 4. Run the Server
* **Production mode**:
  ```bash
  npm start
  ```
* **Development mode** (with automatic nodemon reloads):
  ```bash
  npm run dev
  ```
The server will boot up and listen on: **`http://localhost:3000`**
