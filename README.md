# MAYA Downloads

Plain HTML, CSS, and JavaScript front-end with a small Node.js (Express) server. No frameworks.

- **Public site:** `/` – browse and download assets (wallpapers, 3D STL, e-book chapters).
- **Admin:** `/admin` – add or remove assets (password set via `ADMIN_PASSWORD` env var).
- **Data:** `data/downloads.json` – edited by the server when you use the admin.

## Run locally

1. Copy `.env.example` to `.env` and set `ADMIN_PASSWORD`.
2. `npm install`
3. `npm start`
4. Open http://localhost:3000 and http://localhost:3000/admin

## Deploy (Railway + GoDaddy)

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for step-by-step Railway hosting and GoDaddy domain setup.
