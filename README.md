# KoinX Transaction Reconciliation Engine (Backend Take-Home)

A production-grade, highly performant **Transaction Reconciliation Engine** built in Node.js, Express, and MongoDB. It ingests transaction logs from a cryptocurrency user and an exchange, flags and logs data-quality issues without silently discarding records, matches them using configurable tolerances, and serves reports through REST APIs and a sleek glassmorphic dashboard interface.

---

## 🚀 Key Features

1. **Streaming Ingestion & Data Quality Engine**: Streams large CSVs efficiently using `csv-parser`. Malformed dates, empty values, or negative values are flagged as invalid with specific reasons (`validationErrors`) and saved, maintaining a perfect audit trail.
2. **Robust Matching Algorithm**:
   - **Asset Normalization**: Handles case-insensitive and alias mapping (e.g. `bitcoin` / `BTC` normalized to `btc`) at ingestion.
   - **Perspective Matching**: Automatically maps exchange perspective (`TRANSFER_IN`) to user perspective (`TRANSFER_OUT`).
   - **Proximity Filtering**: Filters by configurable timestamp windows and evaluates percentage deviations in decimal quantities.
3. **Immersive UI Dashboard**: Serve static HTML/CSS files natively through Express to provide a beautiful glassmorphism single-page app displaying real-time summaries, tolerance adjustment sliders, distribution visualizers, and detailed discrepancy reports.
4. **Rich REST APIs & CSV Exports**: Supports JSON responses, paginated detailed reports, summary metrics, and direct CSV file downloads.

---

## 🛠️ Technology Stack
- **Core**: Node.js & Express.js
- **Database**: MongoDB with Mongoose ORM
- **CSV Ingestion**: `csv-parser` (Event-driven stream parsing)
- **Testing**: Jest (Unit & Isolation tests)
- **Tooling**: Nodemon, Dotenv, CORS, UUID

---

## 📂 Project Structure

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

## 🧠 Key Technical Design Decisions

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

## ⚙️ Setup and Installation

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

---

---

## 🛜 REST API Reference
> [!NOTE]
> For strict compliance with the KoinX specifications, all routes are mounted **both at the root level** (e.g., `POST /reconcile`) and **with the `/api` prefix** (e.g., `POST /api/reconcile`) for dashboard compatibility.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/reconcile` or `/api/reconcile` | Triggers a reconciliation run. Accepts optional overrides in JSON body. |
| `GET` | `/report/:runId` or `/api/report/:runId` | Fetches the full detailed list of matches, paginated. |
| `GET` | `/report/:runId/csv` or `/api/report/:runId/csv` | Downloads the complete reconciliation report as a formatted CSV file. |
| `GET` | `/report/:runId/summary` or `/api/report/:runId/summary` | Fetches a high-level metrics count summary of the run. |
| `GET` | `/report/:runId/unmatched` or `/api/report/:runId/unmatched` | Fetches only unmatched rows with their specific mismatch reasons. |

### Sample Payload for `POST /api/reconcile`
```json
{
  "timestampToleranceSeconds": 600,
  "quantityTolerancePct": 0.05
}
```

### Sample Response for `POST /api/reconcile`
```json
{
  "success": true,
  "runId": "a5d89f81-54c3-42e7-9102-3bdc01db78c3",
  "config": {
    "timestampToleranceSeconds": 600,
    "quantityTolerancePct": 0.05
  },
  "summary": {
    "matchedCount": 15,
    "conflictingCount": 2,
    "unmatchedUserCount": 3,
    "unmatchedExchangeCount": 2,
    "invalidUserRowsCount": 2,
    "invalidExchangeRowsCount": 0
  }
}
```

---

## 📊 Visual Interactive Dashboard
When you start the server, open **`http://localhost:3000`** in your browser. 
You will see the fully interactive glassmorphic dashboard! 
- Adjust the sliders on the left for custom tolerances.
- Click **Trigger Reconciliation** to instantly launch the parser, ingestion, and matching pipeline.
- Observe real-time count metrics and color-coded match distribution progress bars.
- Filter through categories (Matched, Conflicts, Unmatched) and read exact discrepancies.
- Download the generated report as a **CSV file** with a single click.
