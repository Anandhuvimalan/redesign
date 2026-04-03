# JET Journal Trainer

High-performance workbook-driven practice platform for accounting journal entries.

## Stack

- React + Vite + TypeScript frontend
- Fastify + TypeScript API
- File-backed question repository seeded from `Jet questions.xlsx`

## What it does

- Reads the existing Excel workbook format with `Basic`, `Medium`, and `Hard` sheets
- Builds a student quiz flow with matrix-style answer entry
- Scores answers against correct rows and shows correct vs wrong results
- Provides an admin console for:
  - bulk upload using the same Excel format
  - filter/search by level
  - delete individual questions
  - bulk delete selected questions
  - clear an entire level

## Commands

```bash
npm install
npm run dev
```

- Frontend dev server: `http://localhost:5173`
- API server: `http://localhost:3001`

Production build:

```bash
npm run build
npm start
```

## Import behavior

- On first server start, the app seeds itself from `Jet questions.xlsx`
- Admin uploads replace the levels present in the uploaded workbook
- Current workbook counts:
  - Basic: 250
  - Medium: 199
  - Hard: 201

## Data storage

- Seeded and uploaded question data is stored in `data/questions.json`
