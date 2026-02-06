Web UI (GitHub Pages) setup

The web UI in `web/` is a static single-page app built with Vite + React.

Important: the UI relies on the bot backend to perform authenticated actions (OAuth login, publish messages, create contests, etc.). When deployed to GitHub Pages you must configure the backend URL so the front end can reach it.

1. Set the backend URL for the web build

- Add a repository secret (or Pages environment variable) named `VITE_API_BASE` and set it to the HTTPS base URL where your bot's HTTP API is hosted (for example `https://dcb-backend.example.com`).
- The UI will then call `${VITE_API_BASE}/api/*` and the Discord login button will open `${VITE_API_BASE}/auth/discord` which performs OAuth.

2. GitHub Actions

The `pages-deploy-vite.yml` workflow runs `npm run build` in `web/` and publishes `web/dist` to the `gh-pages` branch. Make sure `VITE_API_BASE` is available to the workflow during build (add it as a repository variable or secret and reference it in the Actions workflow if required).

3. OAuth redirect / CORS

- Make sure your backend OAuth redirect URI is configured correctly in your Discord application settings (e.g. `https://your-backend.example.com/auth/discord/callback`).
- Ensure your backend sets appropriate CORS headers so the GitHub Pages site (or any origin) can call the API.

4. Local testing

- While developing locally use `VITE_API_BASE=http://localhost:3000` and run `npm run dev` in `web/` and your backend locally on port 3000. The Vite dev server proxies `/api` to the backend when `VITE_API_BASE` is not set.

If you want I can add an example GitHub Actions snippet that injects `VITE_API_BASE` into the build step for you.