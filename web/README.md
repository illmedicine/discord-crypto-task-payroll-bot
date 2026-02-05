# DCB Event Manager (Frontend)

This is a lightweight React + Vite frontend for managing Contests, Tasks, and Events for DisCryptoBank.

Development

1. cd web
2. npm install
3. npm run dev

API

The frontend expects the backend API at the same origin under `/api` during development. The bot backend exposes these endpoints when running locally (see `server/api.js`).

Deployment to GitHub Pages

- Set `vite.config.ts` base to `/DCB-Event-Manager/` (already configured)
- Build: `npm run build`
- Deploy: `npm run deploy` (requires `gh-pages` and permission to push to the repo's `gh-pages` branch)

Note: The full integration requires the bot backend to be running for publishing to Discord and payments processing.