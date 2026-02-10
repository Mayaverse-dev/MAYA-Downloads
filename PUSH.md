# Push to GitHub

From the project folder run:

```bash
cd "d:\Daksh's Backup\MAYA Downloads\maya-downloads"

git init
git add .
git commit -m "Three-box homepage, category pages with preview, download links fixed"

git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

Replace `YOUR_USERNAME` and `YOUR_REPO` with your GitHub repo URL. If the repo already exists and you already have a remote, use:

```bash
git add .
git commit -m "Three-box homepage, category pages with preview, download links fixed"
git push
```
