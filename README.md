# GrowEasy AI-Powered CSV Importer

An intelligent, full-stack CRM CSV Importer built for the GrowEasy developer assignment. The application parses arbitrary CSV layouts (Facebook Ads export, Google Ads export, custom Excel sheets) and utilizes AI (Google Gemini or OpenAI) to map and normalize raw data into standard GrowEasy CRM fields.

## Core Features
1. **Dynamic Schema Mapping**: Send messy spreadsheets with different column names (e.g., `Full Name`, `Mobile No`, `Email Address`, `Created Date`) and let the AI map them into correct CRM headers.
2. **GrowEasy Light-Theme Dashboard**: Clean, responsive SPA matching the GrowEasy dashboard layout precisely—complete with navigation sidebar, active highlights, rounded modal triggers, and a lead list workspace.
3. **Modal CSV Uploader**:
   - **Step 1: Drag & Drop**: Custom drag-and-drop area with validator warnings. Includes a **Download CSV Template** helper.
   - **Step 2: Instant Client-Side Preview**: Parses CSV using PapaParse and renders the spreadsheet layout immediately in a scrollable table with sticky headers.
   - **Step 3: AI Processing Overlay**: Splits large files into small batches (10 rows per batch) and fires sequential API calls. Displays live speed metrics (leads/sec), progress percentage, and active indexes. Includes a **Retry Mechanism** for failed batches.
   - **Step 4: Mapped Summary**: Visual dashboard cards summarizing imported versus skipped leads.
4. **CRM Workspace**: Transitions straight to a unified "Manage Leads" view with:
   - **Tabbed Sub-Panels**: Switch between successful "Imported Leads" and "Skipped Records".
   - **Validation Rule Enforcement**: Automatically filters out invalid rows (missing both email and phone), standardizes date formats, separates multiple contact records, and maps CRM status tags (`Good Lead`, `Sale Done`, `Not Dialed`, `Bad Lead`).
   - **Interactive Filter**: Live client-side text search across names, emails, and phone numbers.
5. **No-Key Demo Fallback (Mock Mode)**: If no Gemini or OpenAI key is configured in `.env`, the server automatically falls back to a **local rule-based regex mapper** that parses standard keywords. This allows the evaluator to test the application immediately out of the box without providing API keys.

---

## Tech Stack
* **Frontend**: React + Vite (Vanilla CSS & CSS Modules for layout precision and responsive control)
* **Backend**: Node.js + Express (ES Modules)
* **AI Model Options**: Google Gemini (`gemini-2.5-flash`) or OpenAI (`gpt-4o-mini`)

---

## Folder Structure
```
groweasy-csv-importer/
├── backend/                  # Node.js + Express Server
│   ├── src/
│   │   ├── controllers/      # Route controllers (importController.js)
│   │   ├── services/         # AI mapping (aiService.js), Validation rules (validator.js)
│   │   └── server.js         # Entry point (port 5001)
│   ├── .env                  # Configuration variables
│   └── package.json
│
├── frontend/                 # Vite + React Client
│   ├── src/
│   │   ├── App.jsx           # App layout & Wizard state engine
│   │   ├── index.css         # Styling system (GrowEasy Light Dashboard Theme)
│   │   └── main.jsx          # Entry point
│   ├── index.html            # HTML page title & viewport
│   └── package.json
│
└── samples/                  # Mock leads for testing
    └── messy_leads.csv       # Test dataset with non-standard columns & invalid rows
```

---

## Getting Started

### Prerequisites
Make sure you have Node.js installed (v18 or higher is recommended; tested on v24).

### Step 1: Run the Backend Server
1. Navigate to the `backend` folder:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables:
   - Copy `.env.example` to `.env`.
   - To test with live AI mapping, fill in `GEMINI_API_KEY` (Google AI Studio) or `OPENAI_API_KEY`.
   - If left empty, the server automatically starts in **Demo Mock Mode** and runs locally.
4. Run the server:
   ```bash
   npm run dev
   ```
   The backend will run on: `http://localhost:5001`

### Step 2: Run the Frontend Client
1. Open a new terminal and navigate to the `frontend` folder:
   ```bash
   cd ../frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the dev server:
   ```bash
   npm run dev
   ```
   The client will open on: `http://localhost:5173`

---

## How to Test — Full Assignment Checklist

Use the sample file included at `samples/messy_leads.csv` for all tests below.
Open the app at **`http://localhost:5173/`**.

---

### Frontend — Step 1: Upload CSV

| # | What to Check | How | Expected |
|---|---|---|---|
| 1 | File picker upload | Click **"Import Leads via CSV"** card → click the dashed zone → select `messy_leads.csv` | File accepted, modal advances |
| 2 | **Drag & Drop** *(Bonus)* | Drag `messy_leads.csv` from File Explorer and drop it onto the dashed zone | File accepted instantly |
| 3 | Rejects non-CSV files | Try uploading a `.jpg` or `.txt` file | Shows an error alert |

---

### Frontend — Step 2: Preview (NO AI yet)

| # | What to Check | How | Expected |
|---|---|---|---|
| 4 | Preview table renders | After upload | Table with all CSV columns and rows appears inside modal |
| 5 | Sticky headers | Scroll **down** inside the preview table | Column headers stay pinned at the top |
| 6 | Horizontal scrolling | Scroll **sideways** inside the preview table | All columns accessible, no overflow clipping |
| 7 | AI NOT called yet | Open **DevTools → F12 → Network tab**, then upload file | Zero calls to `/api/import-batch` at this stage |

---

### Frontend — Step 3: Confirm Import

| # | What to Check | How | Expected |
|---|---|---|---|
| 8 | Confirm button present | Look at the modal footer after file preview loads | Orange **"Upload File"** button is visible and clickable |
| 9 | AI fires ONLY after confirm | Click **"Upload File"** button | Network tab now shows `/api/import-batch` POST requests |
| 10 | Progress bar animates | Watch the modal during processing | Spinner + percentage bar update live |
| 11 | **Batch processing** *(Bonus)* | Check DevTools Network tab during import | Multiple separate `/api/import-batch` calls (one per 10 rows) |
| 12 | Speed metrics shown | Watch processing screen | "leads/sec" throughput counter updates |
| 13 | **Retry mechanism** *(Bonus)* | Stop the backend (`Ctrl+C`) mid-import, restart it, click Retry | Retry buttons appear per failed batch; re-running them completes import |

---

### Frontend — Step 4: Display Results

| # | What to Check | How | Expected |
|---|---|---|---|
| 14 | Summary cards appear | After processing completes | Two cards: **Leads Imported** and **Records Skipped** |
| 15 | Correct imported count | Read the green card | **5** |
| 16 | Correct skipped count | Read the red card | **1** |
| 17 | Click "View Mapped Leads" | Press the dark green button | Modal closes, sidebar switches to **Manage Leads** |
| 18 | Imported leads table | Check "Imported Leads" tab | 5 rows: Alice, Bob, Charlie, David, Eve — with proper CRM columns |
| 19 | Skipped records table | Click **"Skipped Records"** tab | 1 row: `Invalid Lead` — reason: *"Missing both email and mobile number"* |
| 20 | Status badges correct | Look at the **Status** column | Colored badges: `Good Lead` (green), `Sale Done` (blue), `Not Dialed` (grey), `Bad Lead` (red) |
| 21 | Live search filter | Type a name in the search bar above the table | Table filters in real time |
| 22 | Responsive tables | Scroll left/right and up/down in the leads table | Headers stay sticky, all columns scroll horizontally |

---

### Backend — API & AI Verification

| # | What to Check | How | Expected |
|---|---|---|---|
| 23 | Backend health check | Open **`http://localhost:5001/api/health`** in browser | JSON: `"geminiKeyConfigured": true` |
| 24 | Accepts any CSV format | Upload `messy_leads.csv` (uses "Full Name", "Email Address", "Mobile No" — not standard CRM headers) | All 5 valid leads still imported correctly |
| 25 | AI field mapping | Check the leads table — column "Full Name" in CSV | Correctly mapped to the **Name** column |
| 26 | Phone number mapped | "Mobile No" column in CSV | Mapped to **Contact** column in results |
| 27 | Date format valid | Check `created_at` in the results table | Shows a parseable date like `2026-06-01` |

---

### AI Extraction Rules Verification

| # | Rule | Test | Expected |
|---|---|---|---|
| 28 | Only allowed CRM statuses | Upload CSV with status `"Follow Up"` | Maps to `GOOD_LEAD_FOLLOW_UP` |
| 29 | Unknown status → default | Upload CSV with status `"Pending"` | Maps to `GOOD_LEAD_FOLLOW_UP` |
| 30 | Skip if no email AND no phone | `Invalid Lead` row in `messy_leads.csv` | Appears in **Skipped Records** tab |
| 31 | Multiple emails → first primary | Put `a@x.com; b@y.com` in one email cell | `a@x.com` = primary, `b@y.com` appended to CRM Notes |
| 32 | Unknown data source → blank | Source column value not in allowed list | `data_source` field is left blank |

---

### Bonus Features Checklist

| # | Bonus Feature | Where to See It |
|---|---|---|
| 33 | ✅ Drag & Drop upload | Dashed drop zone in the modal |
| 34 | ✅ Progress indicator | Spinner + % bar + speed counter during processing |
| 35 | ✅ Retry failed batches | Stop backend mid-import → retry buttons appear per failed batch |
| 36 | ✅ GrowEasy dashboard UI | Sidebar, cards, modal, table — matches the provided UI screenshots exactly |

---

> **Quick Smoke Test (2 minutes):**
> 1. Open `http://localhost:5173/`
> 2. Click **Import Leads via CSV** card
> 3. Upload `samples/messy_leads.csv`
> 4. Click orange **Upload File** button
> 5. Wait for completion → click **View Mapped Leads**
> 6. Confirm: **Imported Leads = 5**, **Skipped Records = 1** ✅
