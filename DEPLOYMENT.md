# MAYA Downloads – Deployment Guide

Exact steps to host the site on **Railway** and connect a **GoDaddy** domain (e.g. `downloads.entermaya.com`). No frameworks; plain Node.js server.

---

## What you need before starting

- [ ] GitHub account (repo with this project)
- [ ] Railway account (railway.app)
- [ ] GoDaddy account (domain already bought)
- [ ] A strong password for the admin panel (you’ll set it as an env var)

---

## Part 1: Deploy on Railway

### 1. Push code to GitHub

If the project isn’t in a repo yet:

```bash
cd "d:\Daksh's Backup\MAYA Downloads\maya-downloads"
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

Replace `YOUR_USERNAME` and `YOUR_REPO_NAME` with your GitHub repo URL.

### 2. Create a Railway project

1. Go to [railway.app](https://railway.app) and log in.
2. Click **“New Project”**.
3. Choose **“Deploy from GitHub repo”**.
4. Connect GitHub if asked, then select the repo that contains `maya-downloads` (this project).
5. Railway will detect the app. If it asks for a **root directory**, set it to the folder that contains `server.js` and `package.json` (e.g. `maya-downloads` if the repo root is one level above).

### 3. Set environment variables on Railway

1. In the Railway project, open your **service** (the deployed app).
2. Go to the **Variables** tab.
3. Add:

| Name             | Value                          |
|------------------|--------------------------------|
| `ADMIN_PASSWORD` | Your chosen admin password     |

- No quotes in the value.
- This password is used for the `/admin` page and the API. Keep it secret.

### 4. Confirm build and start commands

Railway usually auto-detects:

- **Build:** `npm install` (no separate build step).
- **Start:** `npm start` (runs `node server.js`).

In **Settings** → **Deploy**, check that:

- Start command is: `npm start` or `node server.js`.
- No custom build command is required (leave empty if not needed).

Redeploy once if you change these.

### 5. Get the Railway URL

1. Open the **Settings** tab of your service.
2. Under **Domains**, click **“Generate Domain”** if you don’t have one.
3. Copy the URL (e.g. `maya-downloads-production-xxxx.up.railway.app`). You’ll use it in GoDaddy.

Your app is now live on that URL. Test `/` and `/admin` (login with `ADMIN_PASSWORD`).

---

## Part 2: Connect GoDaddy domain (e.g. downloads.entermaya.com)

### 1. Add custom domain in Railway

1. In your Railway service, go to **Settings** → **Domains**.
2. Click **“Custom Domain”**.
3. Enter: `downloads.entermaya.com` (or your chosen subdomain).
4. Railway will show the target you must point the domain to, e.g.:
   - **CNAME target:** `maya-downloads-production-xxxx.up.railway.app`  
   or  
   - **A record target:** an IP (if Railway shows one).

Note the exact target Railway shows; you’ll use it in GoDaddy.

### 2. Point the domain in GoDaddy

1. Log in at [godaddy.com](https://www.godaddy.com) → **My Products**.
2. Find the domain (e.g. `entermaya.com`) and click **DNS** (or **Manage DNS**).
3. Add a record:

**If Railway gave you a CNAME:**

| Type  | Name    | Value (e.g. Railway hostname)     | TTL   |
|-------|---------|------------------------------------|-------|
| CNAME | downloads | `xxxx.up.railway.app` (from Railway) | 600 or default |

- **Name:** `downloads` (so the full name is `downloads.entermaya.com`).
- **Value:** the CNAME target from Railway (only the hostname, no `https://`).

**If Railway gave you an A record (IP):**

| Type | Name      | Value (IP) | TTL   |
|------|------------|------------|-------|
| A    | downloads  | x.x.x.x    | 600   |

4. Save. Remove any old A or CNAME for `downloads` if you’re replacing it.

### 3. Wait for DNS and SSL

- DNS can take from a few minutes up to 24–48 hours.
- Railway will issue an SSL certificate for `downloads.entermaya.com` once the domain points correctly.
- Check status: Railway dashboard → your service → **Domains**. It will show something like “Certificate provisioning” until SSL is ready.

### 4. Test

- Open `https://downloads.entermaya.com`. It should load your MAYA Downloads site.
- Open `https://downloads.entermaya.com/admin` and log in with `ADMIN_PASSWORD`.

---

## Part 3: Things people often miss

### 1. Root directory (monorepo)

If the repo has multiple projects (e.g. `maya-downloads` inside a bigger repo):

- In Railway → service → **Settings** → **Root Directory**, set it to the folder that contains `server.js` and `package.json` (e.g. `maya-downloads`).
- Redeploy after changing.

### 2. Port

The app uses `process.env.PORT` in `server.js`. Railway sets `PORT` automatically; you don’t need to set it.

### 3. Admin password

- Use a long, random password (e.g. from a password manager).
- Don’t commit `.env` or put the password in code. Only in Railway **Variables**.

### 4. Data (downloads.json)

- `data/downloads.json` is read/written by the server on the Railway filesystem.
- Redeploys can reset the filesystem. For production you may later move to a database or external storage; for now, adding assets via the admin after each deploy is fine, or back up `downloads.json` and re-upload if needed.

### 5. Assets (images/files)

- Files in `public/` (including `public/images/`) are served by the app and are part of the repo.
- To add new assets: add files under `public/` (e.g. `public/images/...`) and push to GitHub so Railway redeploys with the new files. You can also add new items (and point to existing URLs) from the admin without redeploying.

### 6. HTTPS

- Use `https://downloads.entermaya.com`. Railway handles HTTPS when the custom domain is set and DNS is correct.

### 7. GoDaddy “www” (optional)

- If you want `www.downloads.entermaya.com`, add another CNAME in GoDaddy: name `www.downloads` (or as GoDaddy suggests) pointing to the same Railway hostname, and add that domain in Railway **Custom Domain** as well.
- Most people use `downloads.entermaya.com` without `www`.

---

## Quick checklist

- [ ] Code pushed to GitHub.
- [ ] Railway project created from that repo.
- [ ] `ADMIN_PASSWORD` set in Railway Variables.
- [ ] Deploy successful; default Railway URL works.
- [ ] Custom domain `downloads.entermaya.com` added in Railway.
- [ ] CNAME (or A) record set in GoDaddy for `downloads`.
- [ ] Waited for DNS; `https://downloads.entermaya.com` loads.
- [ ] `/admin` login works with `ADMIN_PASSWORD`.

---

## Local run (no deployment)

```bash
cd "d:\Daksh's Backup\MAYA Downloads\maya-downloads"
```

Create a `.env` file (copy from `.env.example`) and set:

```
ADMIN_PASSWORD=your_password_here
```

Then:

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) and [http://localhost:3000/admin](http://localhost:3000/admin).
