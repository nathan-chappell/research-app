# Research App

Local-first media research app with a Vite React SPA in `frontend/` and a FastAPI service in `backend/`.

## What is in here

- `frontend/`
  - Mantine app shell
  - OPFS storage helpers for raw media and derived artifacts
  - Dexie schema for local corpus state
  - ffmpeg.wasm media worker
  - MiniSearch + cosine retrieval worker for fallback search
  - Browser-side k-means + UMAP explore worker
  - ChatKit pane wired to the self-hosted FastAPI protocol endpoint
- `backend/`
  - FastAPI REST API and ChatKit server protocol endpoint
  - SQLAlchemy models for users, libraries, threads, messages, evidence refs, OpenAI conversations, usage events, and semantic transcript chunks
  - Generic bearer-token auth with OIDC/JWKS support
  - OpenAI proxy endpoints for transcription, embeddings, semantic search, theme labeling, and Responses-based answer synthesis

## Local development

Install Python dependencies from the repo root:

```bash
python3 -m pip install -r requirements.txt
```

Install Python dev tooling, including backend type checking:

```bash
python3 -m pip install -r requirements-dev.txt
```

Build the frontend once, or keep rebuilding `frontend/dist` while you work:

```bash
cd frontend
npm install
npm run build
# or
npm run build:watch
```

Run the backend from `backend/` after `frontend/dist/index.html` exists:

```bash
cd backend
python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

The backend now serves the built SPA from `frontend/dist` and will fail startup if those assets are missing. `RESEARCH_APP_FRONTEND_DIST_PATH` can override the default dist location.

The Vite dev server still works for frontend-only iteration:

```bash
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173
```

## Semantic search modes

- `sqlite`: the app keeps local import, transcript playback, evidence retrieval, and semantic exploration available through the browser fallback path.
- `postgresql` with pgvector: the backend becomes the semantic authority for transcript chunk sync, embeddings, retrieval, and theme labeling. The server will attempt `CREATE EXTENSION IF NOT EXISTS vector` during startup.

Recommended Postgres setup:

```bash
createdb research_app
psql research_app -c 'CREATE EXTENSION IF NOT EXISTS vector;'
```

## Environment

The backend defaults to local-dev mode:

- `RESEARCH_APP_AUTH_DISABLED=true`
- `RESEARCH_APP_DATABASE_URL=sqlite:///./research_app.db`

Useful overrides:

- `RESEARCH_APP_DATABASE_URL=mysql+pymysql://user:pass@host:3306/research_app`
- `RESEARCH_APP_DATABASE_URL=postgresql+psycopg://user:pass@host:5432/research_app`
- `RESEARCH_APP_FRONTEND_DIST_PATH=/absolute/path/to/frontend/dist`
- `RESEARCH_APP_OPENAI_API_KEY=...`
- `RESEARCH_APP_OIDC_ISSUER=...`
- `RESEARCH_APP_OIDC_AUDIENCE=...`
- `RESEARCH_APP_OIDC_JWKS_URL=...`
- `RESEARCH_APP_CHATKIT_DOMAIN_KEY=...`

Frontend overrides:

- `VITE_API_BASE_URL=http://127.0.0.1:8000/api`
- `VITE_AUTH_ENABLED=true`
- `VITE_OIDC_AUTHORITY=...`
- `VITE_OIDC_CLIENT_ID=...`
- `VITE_OIDC_SCOPE=openid profile email`
- `VITE_CHATKIT_DOMAIN_KEY=...`

## Verification

- Backend tests: `python3 -m pytest backend/tests -q`
- Backend type check: `python3 -m pyright`
- Frontend build: `cd frontend && npm run build`
- Frontend watch build: `cd frontend && npm run build:watch`
