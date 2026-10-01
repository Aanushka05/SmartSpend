# SmartSpend v3.0 — Expense Tracking System

## 🚀 Quick Start

```bash
cd backend
npm install
npm run seed     # Creates: admin@smartspend.com / Admin@123
npm run dev      # API starts at http://localhost:3001
```

Then open `frontend/index.html` in your browser (or use VS Code Live Server).

---

## 🔑 Default Credentials
| Role  | Email                | Password  |
|-------|----------------------|-----------|
| Admin | admin@smartspend.com | Admin@123 |

---

## ✅ Features in v3.0

### New Features
- **₹ INR Default Currency** — all values stored in INR
- **Multi-Currency Display** — switch between INR, USD, EUR, GBP, JPY, CAD, AUD, SGD, CHF, CNY
- **Currency Selector** — dropdown in top navbar, persisted in localStorage
- **Live Rate Conversion** — uses backend exchange rates, falls back to static rates
- **Report Download (CSV)** — `GET /api/reports/download?month=YYYY-MM&format=csv`
- **Report Download (JSON)** — `GET /api/reports/download?month=YYYY-MM&format=json`
- **Charts auto-convert** — all Chart.js charts update when currency changes
- **Exchange Rate Table** — visible on Currency Converter page

### Download Endpoint
```
GET /api/reports/download?month=2026-03&format=csv
Authorization: Bearer <token>
→ Downloads: SmartSpend_Report_March_2026.csv
```

## 🗂 Project Structure
```
smartspend/
├── backend/
│   ├── src/
│   │   ├── server.js
│   │   ├── routes/      auth, expenses, budgets, reports*, currency, admin
│   │   ├── middleware/  auth.js, validate.js
│   │   ├── db/          database.js, seed.js
│   │   └── utils/       tokens.js, audit.js
│   ├── data/            (SQLite DB auto-created)
│   ├── .env
│   └── package.json
└── frontend/
    └── index.html
```

## 💱 Currency Architecture
- **Storage**: All amounts in INR (backend)
- **Display**: Converted client-side using exchange rates from `/api/currency/rates`
- **Fallback**: Static rates if API key not configured
- **Selector**: Navbar dropdown → saves to `localStorage`
