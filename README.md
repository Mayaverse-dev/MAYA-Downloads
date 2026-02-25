# MAYA Downloads

Free download hub for MAYA Narrative Universe assets: wallpapers, e-book chapters, and 3D printables (STL). No login required.

## Stack

- **Backend**: Node.js, Express
- **Frontend**: Vanilla HTML/CSS/JS
- **Storage**: AWS S3–compatible (Tigris) for assets
- **Analytics DB**: SQLite (local) / PostgreSQL (production, Railway)
- **Deploy**: Railway (Nixpacks)

## Progress to date

### Core
- Homepage with category tiles (Wallpapers, E-Book, 3D Printables)
- Category pages: wallpapers (with size/variant picker), e-book, STL
- Admin panel: list/edit/delete downloads, upload files (single + multi for wallpapers), search/filter, analytics view
- S3 upload with auto thumbnails (WebP) and resolution/metadata extraction for images
- Batch download as ZIP

### First-party analytics
- **UTM tracking**: Campaign, source, medium, content, term persisted in session and sent with every event
- **Visits**: Page, referrer, IP, geo (via ip-api.com), user-agent (browser/OS/device), screen size, lang, client TZ
- **Events**: Pageviews, download clicks, modal opens, batch downloads
- **Storage**: SQLite locally (`data/analytics.db`), PostgreSQL on Railway when `DATABASE_URL` is set
- **Client**: Lightweight `tracker.js` using `navigator.sendBeacon`; no blocking

### UX / copy
- Hero: “MAYA Downloads”, “Free to download. No login required.”
- Category copy: Wallpapers (high-res desktop/mobile), E-Book (selected chapters), 3D Printables (STL files)
- Post-download popup: “MAYA is also on Discord.” + Join Discord (branded)
- Footer social icons: hover “pop” effect on logos

### Progressive rollout
- **Visible categories**: Env `VISIBLE_CATEGORIES` (comma-separated, e.g. `ebook`) controls which sections appear on the homepage and in nav. Hidden category URLs redirect to home.
- Example: `VISIBLE_CATEGORIES=ebook` → only E-Book section visible.

### Admin
- Password via `ADMIN_PASSWORD`; **on localhost, admin routes accept any request (no password required)**.
- Multi-file wallpaper upload: infers subtitle/type/resolution from filenames and image metadata.

### Scripts
- `scripts/upload-wallpapers-from-folder.js`: Bulk upload local `Wallpaper/<set>/*.png` to S3, generate thumbnails, append to `data/downloads.json`.

## Run locally

```bash
npm install
# Optional: .env with ADMIN_PASSWORD, S3_*, DATABASE_URL (or omit for SQLite)
node server.js
```

Open http://localhost:3000. Admin at http://localhost:3000/admin (no password on localhost).

## Env (reference)

| Variable | Purpose |
|----------|---------|
| `PORT` | Server port (default 3000) |
| `ADMIN_PASSWORD` | Required in production for /admin and /api/admin/* |
| `VISIBLE_CATEGORIES` | Comma-separated: `ebook`, `wallpapers`, `stl`; omit = all visible |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` | S3 (Tigris) storage |
| `DATABASE_URL` | PostgreSQL connection string (production); omit for SQLite |

## Repo notes

- `data/downloads.json`: single source of truth for download entries (committed).
- `data/analytics.db*` and `Wallpaper/` are gitignored.
