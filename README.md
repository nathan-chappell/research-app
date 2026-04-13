# Research App

Local-first media research app with a Vite React SPA in `frontend/` and a FastAPI service in `backend/`.

## What is in here

- `frontend/`
  - Mantine app shell
  - OPFS storage helpers for raw media and derived artifacts
  - Dexie schema for local corpus state
  - ffmpeg.wasm media worker
  - MiniSearch + cosine retrieval worker
  - ChatKit pane wired to the self-hosted FastAPI protocol endpoint
- `backend/`
  - FastAPI REST API and ChatKit server protocol endpoint
  - SQLAlchemy models for users, libraries, threads, messages, evidence refs, OpenAI conversations, and usage events
  - Generic bearer-token auth with OIDC/JWKS support
  - OpenAI proxy endpoints for transcription, embeddings, and Responses-based answer synthesis

## Local development

Backend:

```bash
cd backend
../.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

## Environment

The backend defaults to local-dev mode:

- `RESEARCH_APP_AUTH_DISABLED=true`
- `RESEARCH_APP_DATABASE_URL=sqlite:///./research_app.db`

Useful overrides:

- `RESEARCH_APP_DATABASE_URL=mysql+pymysql://user:pass@host:3306/research_app`
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

- Backend tests: `../.venv/bin/pytest backend/tests -q`
- Frontend build: `cd frontend && npm run build`
