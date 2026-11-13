# 🍇 Grape Master — Multilingual AI Agricultural Advisory Platform

**Grape Master** is a production-grade, multilingual (English · Marathi · Hindi) agricultural advisory chatbot for grape farmers in Maharashtra. It combines a custom 7-class CNN for leaf-disease diagnosis, a locally-embedded multilingual RAG pipeline, an intelligent NLP pre-processor with Devanagari support, and an Expert-in-the-Loop Admin Review Queue.

> Built for Maharashtra farmers — speaks their language, understands their crops.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Feature Overview](#feature-overview)
3. [Supported Languages](#supported-languages)
4. [NLP Pipeline](#nlp-pipeline)
5. [Vision Pipeline](#vision-pipeline)
6. [RAG Advisory Engine](#rag-advisory-engine)
7. [API Reference](#api-reference)
8. [Setup & Run](#setup--run)
9. [Environment Variables](#environment-variables)
10. [Benchmark Results](#benchmark-results)
11. [Test Commands](#test-commands)
12. [Project Structure](#project-structure)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│          Farmer Browser  (React + Vite  :5173)              │
│   • Multilingual chat UI   • Image upload   • History       │
└───────────────────────────┬─────────────────────────────────┘
                            │  REST / JSON
                            ▼
┌─────────────────────────────────────────────────────────────┐
│          Express API Gateway  (Node.js  :5000)              │
│                                                             │
│  ┌──────────────────┐   ┌──────────────────────────────┐   │
│  │   NLP Service    │   │    RAG Advisory Engine       │   │
│  │  (nlp.js)        │   │  (ragAdvisoryEngine.js)      │   │
│  │                  │   │  Xenova MiniLM-L12-v2        │   │
│  │ • Damerau-       │   │  ➜ SQLite vector search      │   │
│  │   Levenshtein    │   │    (1,425 chunks, 384-dim)   │   │
│  │ • Devanagari     │   │  ➜ Confidence calibration    │   │
│  │   phonetics      │   │  ➜ Auto-escalation queue     │   │
│  │ • PII scrub      │   └──────────────────────────────┘   │
│  │ • Lang detect    │                                       │
│  └──────────────────┘   ┌──────────────────────────────┐   │
│                         │      Vision Engine            │   │
│  ┌──────────────────┐   │   (visionEngine.js)          │   │
│  │  SQLite Database │   │                              │   │
│  │  grape_master.db │   │  CLIP Subject Gate           │   │
│  │                  │   │  (clip-vit-base-patch32)     │   │
│  │ • conversations  │◄──│  ➜ grape_leaf → 7-class CNN  │   │
│  │ • messages       │   │  ➜ berries / pest / soil     │   │
│  │ • review_queue   │   │      → RAG + clarifying Qs  │   │
│  │ • embeddings     │   │      → review queue          │   │
│  └──────────────────┘   └──────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │  REST /api/admin/*
                            ▼
┌─────────────────────────────────────────────────────────────┐
│          Admin Portal  (Next.js 16  :3000)                  │
│   • Live metrics   • Review queue   • Retrain trigger       │
│   • Export dataset  • Revoke approvals                      │
│   Location: D:\Downloads\grape-master-admin                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Feature Overview

| # | Feature | Status |
|---|---------|--------|
| 1 | 7-class grape leaf CNN diagnosis | ✅ Done |
| 2 | Multilingual RAG (en/mr/hi) with 1,425 embedded chunks | ✅ Done |
| 3 | Damerau-Levenshtein spell correction (Indic-aware) | ✅ Done |
| 4 | Devanagari phonetic normalization & grammar rules | ✅ Done |
| 5 | PII scrubbing (phone, Aadhaar, email) | ✅ Done |
| 6 | Language auto-detection (langdetect) | ✅ Done |
| 7 | CLIP subject gate — route non-leaf images to RAG | ✅ Done |
| 8 | Confidence calibration with auto-escalation queue | ✅ Done |
| 9 | Expert-in-the-Loop Admin Review & revoke workflow | ✅ Done |
| 10 | Retrain pipeline — export approved data, re-embed | ✅ Done |
| 11 | Admin dashboard (live SQLite integration, Next.js) | ✅ Done |
| 12 | Full production API gateway (health, ready, auth, chat) | ✅ Done |

---

## Supported Languages

| Code | Language | Script | Notes |
|------|----------|--------|-------|
| `en` | English | Latin | Full spell-correction + RAG |
| `mr` | Marathi | Devanagari | Phonetic normalization, Devanagari regex |
| `hi` | Hindi | Devanagari | Phonetic normalization, Devanagari regex |
| `kn` | Kannada | *(planned)* | Registry slot reserved |
| `gu` | Gujarati | *(planned)* | Registry slot reserved |
| `te` | Telugu | *(planned)* | Registry slot reserved |

Language is auto-detected per message. Mid-session language switches are supported — conversation context is preserved across language changes via `PATCH /api/conversations/:id/language`.

---

## NLP Pipeline

Every user message passes through `backend/services/nlp.js` before reaching the RAG engine:

```
Raw User Input
     │
     ▼
1. Language Detection (langdetect)
     │
     ▼
2. PII Scrubbing
     │  • 10-digit phone numbers → [PHONE REDACTED]
     │  • 12-digit Aadhaar → [AADHAAR REDACTED]
     │  • Email addresses → [EMAIL REDACTED]
     ▼
3. Devanagari Phonetic Normalization (mr/hi)
     │  • ण→न, ळ→ल, ष→स, क्ष→छ, द्ण→ड
     │  • Unicode-safe word boundaries (lookaheads, not \b)
     ▼
4. Indic Grammar Rules
     │  • तो है → वो है, मेरा फसल → मेरी फसल, etc.
     ▼
5. Spell Correction (Damerau-Levenshtein, edit-dist ≤ 2)
     │  • Canonical vocab: CANONICAL_LATIN_VOCAB + CANONICAL_INDIC_VOCAB
     │  • Skips proper nouns, URLs, numbers
     ▼
6. Corrected + Normalized Text → RAG / Vision Engine
```

---

## Vision Pipeline

Image uploads are processed by `backend/services/visionEngine.js`:

```
Uploaded Image
     │
     ▼
CLIP Subject Gate  (Xenova/clip-vit-base-patch32)
     │
     ├── grape_leaf ──────────────────────────────────────────────►  7-class CNN
     │                                                               (TF.js model)
     │                                                               Classes:
     │                                                               • bacterial_rot
     │                                                               • black_rot
     │                                                               • downy_mildew
     │                                                               • esca
     │                                                               • healthy
     │                                                               • leaf_blight
     │                                                               • powdery_mildew
     │
     ├── grape_berries ───────────────────────────────────────────►  RAG lookup
     │                                                             + Clarifying Qs
     │                                                             + Review Queue
     ├── pest / insect ───────────────────────────────────────────►  (same as above)
     │
     └── soil / other ────────────────────────────────────────────►  (same as above)
```

**Confidence Routing:**
- Multimodal (image + text): `0.45 × cnnConf + 0.35 × ragConf + 0.20 × keywordScore`
- Text-only: `0.60 × ragConf + 0.40 × keywordScore`
- Score < `0.75` **or** negative farmer feedback → auto-queue to `review_queue`

**Retrain Pipeline** (`backend/scripts/retrain_pipeline.js`):
1. Exports admin-approved review items as labeled training data
2. Re-runs embedding generation on updated knowledge base
3. Clears and rebuilds the SQLite embedding table

---

## RAG Advisory Engine

`backend/services/ragAdvisoryEngine.js` — local, offline-capable:

| Component | Detail |
|-----------|--------|
| Embedding model | `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (384-dim) |
| Vector store | SQLite (`grape_master.db`, `embeddings` table) |
| Chunk count | 1,425 chunks |
| Similarity | Cosine similarity (manual dot-product, no external DB) |
| Knowledge sources | `grape_dataset.json` (7 diseases × 3 languages + 14 FAQs) + `farmer_qa_cleaned.json` (150 real-world Q&A pairs) |
| Top-K retrieval | K=3 |

---

## API Reference

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/auth/register` | None | Register a new farmer account |
| `POST` | `/api/auth/login` | None | Login, receive JWT (`type: 'farmer'`) |
| `GET` | `/api/auth/me` | Farmer JWT | Get current farmer profile |
| `DELETE` | `/api/auth/account` | Farmer JWT | Delete own account + all data |

### Chat

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/chat` | Farmer JWT | Send message (text ± image); returns advisory response |
| `GET` | `/api/conversations` | Farmer JWT | List all conversations for the farmer |
| `GET` | `/api/conversations/:id/messages` | Farmer JWT | Fetch message history for a conversation |
| `PATCH` | `/api/conversations/:id/language` | Farmer JWT | Update conversation language mid-session |

### NLP

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/nlp/check` | Farmer JWT | Run NLP pipeline on a text string; returns corrections + detected language |

### Admin

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/admin/login` | None | Admin login, receive JWT (`type: 'admin'`) |
| `GET` | `/api/admin/metrics` | Admin JWT | Live dashboard: total farmers, messages, queue depth, accuracy, retrain count |
| `GET` | `/api/admin/review-queue` | Admin JWT | Paginated list of pending review items |
| `POST` | `/api/admin/review` | Admin JWT | Approve or reject a queued item (body: `{id, action, expert_response}`) |
| `GET` | `/api/admin/reviewed` | Admin JWT | List previously reviewed items |
| `POST` | `/api/admin/review/:id/revoke` | Admin JWT | Revoke a previous approval |
| `POST` | `/api/admin/retrain` | Admin JWT | Trigger retrain pipeline (async) |
| `GET` | `/api/admin/export` | Admin JWT | Export labeled training dataset as JSON |

### System

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/health` | None | Liveness probe — returns `{status: "ok"}` |
| `GET` | `/ready` | None | Readiness probe — checks DB + embedding model |
| `GET` | `/api/languages` | None | Returns supported language registry |

---

## Setup & Run

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9

### 1 — Backend (Express API)

```bash
cd C:\Users\Shourya\.gemini\antigravity\scratch\grape-master\backend
npm install

# First run: build the SQLite knowledge base + embeddings (~2-3 min, one-time)
node scripts/preprocess_dataset.js

# Start the server
node server.js
# → Listening on http://localhost:5000
```

### 2 — Farmer Frontend (React + Vite)

```bash
cd C:\Users\Shourya\.gemini\antigravity\scratch\grape-master\frontend
npm install
npm run dev
# → http://localhost:5173
```

### 3 — Admin Portal (Next.js)

```bash
cd D:\Downloads\grape-master-admin
npm install
npm run dev
# → http://localhost:3000
```

Default admin credentials are set via environment variables (see below). On first start the backend seeds the admin account from `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH`.

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | ✅ | — | Secret key for signing JWTs (use a strong random string) |
| `ADMIN_EMAIL` | ✅ | — | Admin login email |
| `ADMIN_PASSWORD_HASH` | ✅ | — | bcrypt hash of admin password |
| `PORT` | ❌ | `5000` | Express server port |
| `NODE_ENV` | ❌ | `development` | Set to `production` for prod |

### Farmer Frontend (`frontend/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_API_URL` | ❌ | `http://localhost:5000` | Backend base URL |

### Admin Portal (`D:\Downloads\grape-master-admin\.env.local`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | ❌ | `http://localhost:5000` | Backend base URL |

---

## Benchmark Results

Measured on `backend/data/farmer_qa_cleaned.json` (150 Q&A pairs) via `node backend/scripts/eval_rag.js`:

| Metric | Score |
|--------|-------|
| Recall@3 | **100%** |
| MRR (Mean Reciprocal Rank) | **0.903** |
| Average Retrieval Latency | **11 ms** |
| Helpfulness Score | **96.8%** |
| Embedding Chunks | 1,425 |
| Embedding Dimensions | 384 |

---

## Test Commands

All tests run offline (models are locally cached):

```bash
# Unit 1 — NLP pipeline (8 tests)
node --test backend/tests/nlp.test.js

# Unit 3 — Vision engine + retrain pipeline (4 tests, ~27s for model load)
node --test backend/tests/vision_and_retrain.test.js

# Unit 4 — API gateway integration (1 suite)
node --test backend/tests/api_gateway.test.js

# Frontend production build (verify no compile errors)
npm run build --prefix frontend

# Admin portal production build
npm run build --prefix "D:\Downloads\grape-master-admin"
```

Expected results:

| Suite | Tests | Status |
|-------|-------|--------|
| `nlp.test.js` | 8/8 | ✅ PASS |
| `vision_and_retrain.test.js` | 4/4 | ✅ PASS |
| `api_gateway.test.js` | 1/1 | ✅ PASS |
| Frontend Vite build | — | ✅ Exit 0 |
| Admin Next.js build | 12/12 static pages | ✅ Exit 0 |

---

## Project Structure

```
grape-master/
├── backend/
│   ├── config/
│   │   └── languages.js          # Multilingual language registry (en/mr/hi + slots for kn/gu/te)
│   ├── data/
│   │   ├── grape_dataset.json    # 7-disease knowledge base (3 languages × 7 diseases + 14 FAQs)
│   │   └── farmer_qa_cleaned.json # 150 real-world Maharashtra farmer Q&A pairs
│   ├── middleware/
│   │   └── authMiddleware.js     # JWT auth (checks decoded.type === 'farmer' | 'admin')
│   ├── scripts/
│   │   ├── preprocess_dataset.js # One-time: embed knowledge base → SQLite
│   │   ├── eval_rag.js           # RAG benchmark: Recall@3, MRR, latency
│   │   └── retrain_pipeline.js   # Export approved data, re-embed, rebuild DB
│   ├── services/
│   │   ├── nlp.js                # NLP pipeline (spell-check, PII, Devanagari, grammar)
│   │   ├── ragAdvisoryEngine.js  # Multilingual RAG (MiniLM-L12-v2 + SQLite cosine search)
│   │   ├── visionEngine.js       # CLIP subject gate + 7-class CNN inference
│   │   └── llmSynthesizer.js     # Response synthesis + confidence scoring
│   ├── tests/
│   │   ├── nlp.test.js
│   │   ├── vision_and_retrain.test.js
│   │   └── api_gateway.test.js
│   ├── database.js               # SQLite schema + all DB operations
│   ├── server.js                 # Express app — all routes + middleware
│   └── grape_master.db           # SQLite database (created by preprocess_dataset.js)
│
├── frontend/                     # React + Vite farmer-facing app
│   ├── src/
│   │   ├── components/
│   │   │   └── ChatInterface.jsx # Main chat UI (multilingual, image upload)
│   │   └── utils/
│   │       └── api.js            # Axios client + all API call helpers
│   └── vite.config.js
│
└── README.md                     # This file

D:\Downloads\grape-master-admin\  # Admin portal (separate Next.js 16 app)
├── src/
│   ├── app/
│   │   ├── page.tsx              # Main dashboard (live metrics, review queue, retrain)
│   │   └── globals.css           # Layout fix: sidebar pinned, main scrollable
│   └── lib/
│       └── api.ts                # Typed API client for all /api/admin/* endpoints
└── next.config.js
```

---

## Notes

- **Offline-capable**: All ML models (`MiniLM-L12-v2`, `clip-vit-base-patch32`, TF.js CNN) are cached locally in `backend/node_modules/@xenova/transformers/.cache/` — no internet required at runtime.
- **Admin JWT**: Stored as `gm_admin_token` in `localStorage` by the Next.js admin portal. Farmer JWTs use a separate key.
- **Devanagari regex**: Uses `(?=\s|[?!।]|$)` lookaheads instead of `\b` — standard `\b` does not match Devanagari word boundaries.
- **Vite chunk size warning** (857 kB): Advisory only — transformers.js bundles are large but tree-shaken. No action needed for the current stage.

---

*Grape Master — Built with ❤️ for Maharashtra's grape farmers.*
