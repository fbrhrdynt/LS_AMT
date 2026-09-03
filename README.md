# AMT — Asset Maintenance Tracker

<p align="center">
  <strong>Self-hosted asset, maintenance, inventory, job, and equipment history management for industrial operations.</strong>
</p>

<p align="center">
  <a href="https://amt.logisourcedigital.web.id">Production</a>
  ·
  <a href="#features">Features</a>
  ·
  <a href="#quick-start">Quick Start</a>
  ·
  <a href="#deployment">Deployment</a>
</p>

---

## Overview

**AMT (Asset Maintenance Tracker)** is a self-hosted web application developed by **LogiSource Digital** to manage equipment records, maintenance history, spare parts and consumables, field assignments, supporting documents, reports, and audit trails from a single system.

The application is designed for operational environments where equipment history must remain traceable over time. Each asset maintains its own maintenance, failure, location, job, parts-consumption, and document history.

AMT also provides a **QR-based Public Equipment Passport**. A QR label can be attached directly to equipment so authorized operational information can be viewed from a mobile device without requiring an AMT login.

> The repository contains application source code only. Runtime credentials, uploaded documents, MongoDB data, backups, and other production data must remain outside Git.

---

## Features

### Equipment Registry

- Central equipment / asset register
- SAP / Asset number
- Serial / Manufacturing number
- Equipment name and category
- Manufacturer
- Purchase date
- Physical condition
- Operational status
- Current placement / location
- Complete location history
- Job assignment history

### Maintenance Management

- Open and close maintenance records
- Corrective / preventive maintenance tracking
- Problem / damage description
- Failure found
- Root cause
- Action taken
- Lead and supporting technicians
- Checked-by and final-condition records
- Automatic maintenance numbering
- Maintenance reopen workflow
- PDF maintenance reports

### Spare Parts & Consumables

Maintenance records can consume inventory using two supply sources:

**Ex-Stock**
- Deducts quantity from inventory
- Validates available stock
- Supports explicit **Stock Override**
- Allows negative inventory only when override is intentionally enabled
- Records stock-before and stock-after values

**Purchase**
- Records direct-use purchased material
- Does not reduce warehouse inventory
- Retains item quantity and cost in maintenance history

The resulting supply source and stock-override information is also included in maintenance PDF reports.

### Maintenance Documents

Documents are attached directly to individual maintenance records.

Supported document categories include:

- Before Photo
- After Photo
- Function Test
- Lifting Inspection
- Inspection Report
- Failure Evidence
- Calibration Certificate
- Test Certificate
- Certificate
- Other Document

The Equipment **Documents** tab acts as an aggregate index showing:

- Maintenance ID
- Maintenance type
- Date
- Document type
- File

Historical equipment-level documents that do not belong to a maintenance record are preserved as legacy / unassigned records.

### QR Equipment Passport

Every equipment record automatically receives a secure public token.

AMT can generate a printable QR sticker containing:

```text
QR Code Maintenance History

        [ QR CODE ]

     Equipment Name

         SAP No.
        123456789
```

Scanning the QR opens a public, mobile-friendly, **view-only** equipment page.

The public view can display:

- Equipment identification
- Operational status
- Current location
- Closed maintenance history
- Maintenance PDF reports
- Documents attached to closed maintenance records

Public URLs use secure random tokens rather than predictable SAP numbers or internal database IDs.

Administrators / supervisors can **Reset Public Link** to invalidate an existing QR and issue a new token.

### Inventory

- Spare parts
- Consumables
- Part numbers
- Units
- Storage locations
- Current stock
- Minimum stock
- Low-stock visibility
- Inventory transaction history
- Maintenance-linked consumption
- Reversal handling when maintenance is reopened or deleted

### Jobs & Clients

- Client records
- Job records
- Equipment mobilization
- Equipment demobilization
- Active assignments
- Assignment history
- Return placement tracking

### Failure Tracking

- Failure history per equipment
- Maintenance-linked failures
- Root-cause information
- Recurring failure identification
- Equipment with highest failure counts

### Reports

- Maintenance reporting
- Equipment filtering
- Date filtering
- Status filtering
- Client and job filtering
- Technician filtering
- CSV export
- Excel export
- PDF maintenance reports

### Audit Trail

Important actions are recorded with:

- Entity type
- Entity ID
- Action
- User
- Details
- Timestamp

### Role-Based Access Control

AMT uses JWT-based authentication with the following application roles:

| Role | Typical Access |
| --- | --- |
| `admin` | Full administration and user management |
| `supervisor` | Operational management |
| `technician` | Maintenance and operational updates |
| `viewer` | Read-only authenticated access |

Public QR pages are intentionally separate from authenticated AMT pages.

---

## Architecture

```text
                         ┌──────────────────────┐
                         │      Web Browser     │
                         └──────────┬───────────┘
                                    │ HTTPS
                                    ▼
                         ┌──────────────────────┐
                         │        Nginx         │
                         └─────────┬────────────┘
                                   │
                 ┌─────────────────┴─────────────────┐
                 │                                   │
                 ▼                                   ▼
      ┌──────────────────────┐            ┌──────────────────────┐
      │   React Frontend     │            │   FastAPI Backend    │
      │   Production Build   │            │      Uvicorn         │
      └──────────────────────┘            └──────────┬───────────┘
                                                    │
                                  ┌─────────────────┼─────────────────┐
                                  │                 │                 │
                                  ▼                 ▼                 ▼
                         ┌──────────────┐   ┌──────────────┐  ┌──────────────┐
                         │   MongoDB    │   │ Local Files  │  │ PDF / QR     │
                         │              │   │   Storage    │  │ Generation   │
                         └──────────────┘   └──────────────┘  └──────────────┘
```

### Backend

- Python
- FastAPI
- Uvicorn
- MongoDB
- Motor / PyMongo
- JWT authentication
- ReportLab
- OpenPyXL
- Pillow / QRCode
- VPS local file storage

### Frontend

- React 19
- React Router
- Axios
- CRACO
- Tailwind CSS
- Radix UI
- Lucide Icons
- Recharts
- Sonner

---

## Repository Structure

```text
LS_AMT/
├── backend/
│   ├── admin_routes.py
│   ├── auth.py
│   ├── core.py
│   ├── equipment_routes.py
│   ├── importer.py
│   ├── inventory_routes.py
│   ├── jobs_routes.py
│   ├── maintenance_routes.py
│   ├── misc_routes.py
│   ├── pdf_report.py
│   ├── public_access.py
│   ├── public_routes.py
│   ├── server.py
│   ├── storage.py
│   ├── requirements.txt
│   └── tests/
│
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── components/
│   │   ├── context/
│   │   ├── lib/
│   │   └── pages/
│   ├── package.json
│   └── yarn.lock
│
├── .gitignore
└── README.md
```

---

## Quick Start

### Requirements

Recommended environment:

- Linux server or development machine
- Python 3.10+
- Node.js
- Yarn 1.x
- MongoDB
- Nginx for production deployment

Clone the repository:

```bash
git clone https://github.com/fbrhrdynt/LS_AMT.git
cd LS_AMT
```

---

## Backend Setup

Create a Python virtual environment:

```bash
cd backend

python3 -m venv venv
source venv/bin/activate

pip install --upgrade pip
pip install -r requirements.txt
```

Create the backend environment file:

```bash
cp .env.example .env
```

Example:

```env
MONGO_URL="mongodb://127.0.0.1:27017"
DB_NAME="amt_database"

JWT_SECRET="REPLACE_WITH_A_LONG_RANDOM_SECRET"

ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD="REPLACE_WITH_A_STRONG_PASSWORD"

FRONTEND_URL="http://localhost:3000"

STORAGE_ROOT="/opt/amt/storage"
```

For a production QR deployment, `FRONTEND_URL` should point to the externally reachable HTTPS domain because public equipment QR URLs are derived from the frontend base URL.

Start the backend:

```bash
uvicorn server:app \
  --host 127.0.0.1 \
  --port 8010
```

API root:

```text
http://127.0.0.1:8010/api/
```

---

## Frontend Setup

Create the frontend environment file:

```bash
cd frontend

cp .env.example .env
```

For local development:

```env
REACT_APP_BACKEND_URL=http://localhost:8010
```

Install dependencies:

```bash
yarn install
```

Run the development server:

```bash
yarn start
```

Create a production build:

```bash
yarn build
```

Production output:

```text
frontend/build/
```

---

## File Storage

AMT stores uploaded maintenance documents in private local VPS storage rather than inside the Git repository.

Default production location:

```text
/opt/amt/storage
```

Supported file types include common:

- Images
- PDF
- Word documents
- Excel files
- CSV
- Text files

The configured upload size limit is enforced by the backend.

Do **not** commit uploaded files or the production storage directory to Git.

---

## MongoDB

Default database configuration:

```env
MONGO_URL="mongodb://127.0.0.1:27017"
DB_NAME="amt_database"
```

MongoDB contains operational records including:

- Users
- Equipment
- Maintenance
- Failures
- Inventory
- Inventory transactions
- Jobs
- Clients
- Assignments
- File metadata
- Audit logs
- Settings
- Public equipment tokens

Back up MongoDB before testing workflows that modify stock, maintenance lifecycle state, assignments, or production records.

Example:

```bash
mongodump \
  --uri="mongodb://127.0.0.1:27017/amt_database" \
  --out="/opt/amt/backups/amt-$(date +%Y%m%d-%H%M%S)"
```

---

## Deployment

A typical production deployment uses:

```text
Nginx
  ├── /                → /opt/amt/frontend/build
  └── /api/            → FastAPI / Uvicorn on 127.0.0.1:8010
```

Recommended application directory:

```text
/opt/amt
```

### Backend Service

A typical systemd service runs:

```text
/opt/amt/backend/venv/bin/uvicorn
server:app
--host 127.0.0.1
--port 8010
```

After backend changes:

```bash
sudo systemctl restart amt-backend
sudo systemctl status amt-backend --no-pager
```

### Frontend Deployment

After frontend changes:

```bash
cd /opt/amt/frontend

rm -rf build
yarn build
```

Validate and reload Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

A React source change does not reach production until the `frontend/build` directory has been rebuilt.

---

## Public QR Security Model

The QR Equipment Passport intentionally exposes only a controlled subset of AMT data.

Public access is based on a high-entropy random token:

```text
/q/e/<secure-random-token>
```

The public API does not use a predictable SAP number as the access key.

Public document downloads are validated against:

1. The public equipment token
2. The equipment record
3. The document's maintenance ID
4. Equipment ownership of that maintenance
5. Closed maintenance status
6. Active / non-deleted file status

Resetting an equipment's public link invalidates previously generated public URLs and QR stickers.

Because a physical QR sticker can be photographed or shared, only information suitable for public equipment access should be exposed through public routes.

---

## Production Security Checklist

Before exposing AMT to the internet:

- Replace the default `JWT_SECRET`
- Use a strong administrator password
- Keep `.env` outside Git
- Run MongoDB privately
- Serve the application only over HTTPS
- Restrict VPS firewall access
- Keep `/opt/amt/storage` private
- Back up MongoDB and file storage
- Keep public routes separate from authenticated APIs
- Review document types before making them available through QR pages
- Do not expose internal credentials in frontend code
- Review access roles when creating users

---

## Importing Existing Data

AMT includes an Excel import workflow for equipment and maintenance records.

The importer supports:

- Equipment register data
- Maintenance history
- Duplicate detection
- Existing SAP-number matching
- Automatic maintenance numbering

Import production data only after verifying workbook structure and taking a database backup.

---

## Testing

Backend tests are located under:

```text
backend/tests/
```

Some lifecycle tests create, modify, or delete application data.

> **Never run state-changing integration/lifecycle tests against the production database.**

Use a dedicated test MongoDB database and isolated test environment.

At minimum, before deployment:

```bash
python3 -m py_compile \
  backend/server.py \
  backend/maintenance_routes.py \
  backend/public_routes.py
```

For frontend verification:

```bash
cd frontend
yarn build
```

A successful production build should finish with:

```text
Compiled successfully.
```

---

## Git Workflow

Use short-lived feature branches for application changes:

```bash
git switch main
git pull --ff-only origin main

git switch -c feature/my-feature
```

After development and testing:

```bash
git add .
git commit -m "Describe the change"
git push -u origin feature/my-feature
```

Merge into `main`:

```bash
git switch main
git pull --ff-only origin main

git merge --ff-only feature/my-feature
git push origin main
```

Remove the completed branch:

```bash
git branch -d feature/my-feature
git push origin --delete feature/my-feature
```

---

## Operational Data & Git

The following should **never** be committed:

```text
.env
storage/
uploads/
database dumps
database backups
node_modules/
frontend/build/
logs
credentials
private keys
```

Always review:

```bash
git status
```

before committing.

---

## Current Production URL

AMT is deployed at:

**https://amt.logisourcedigital.web.id**

Public Equipment Passport URLs use the same domain and a per-equipment secure token.

---

## Product

**AMT — Asset Maintenance Tracker**

Developed for equipment maintenance and operational asset-history management.

**LogiSource Digital**

---

## License

No open-source license is currently declared in this repository.

Unless a license is added explicitly, the source code should be treated as **all rights reserved / proprietary**.
