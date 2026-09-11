# SSP Dashboard - Minimal backend for GitHub Copilot integration

This small server provides minimal endpoints to support GitHub OAuth and fetching Copilot reports.

Important: This server is intentionally minimal and stores tokens in memory for demo/local development only. Do NOT use this as a production token store.

Setup

1. Copy `.env.example` to `.env` and set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.
2. (Optional) Set `GITHUB_COPILOT_REPORT_URL` or `GITHUB_COPILOT_API_URL` to point to your Copilot usage report or API.
3. Install and start the server:

```bash
cd server
npm install
npm start
```

Endpoints

- `GET /auth/github` - redirect to GitHub OAuth
- `GET /auth/github/callback` - OAuth callback
- `GET /api/github/status` - returns connection and last sync info
- `POST /api/github/sync` - triggers a fetch of the Copilot report (uses `GITHUB_COPILOT_REPORT_URL` or `GITHUB_COPILOT_API_URL`)
- `POST /api/github/disconnect` - clear stored token

Notes

- You must register an OAuth App in GitHub to use the flow. Set the callback URL to `http://localhost:4000/auth/github/callback` or your configured `SERVER_BASE_URL`.
- The exact Copilot API path may differ depending on GitHub Enterprise configuration. Configure `GITHUB_COPILOT_API_URL` or `GITHUB_COPILOT_REPORT_URL` accordingly.
