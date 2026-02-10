# Push to GitHub

**Repo:** [https://github.com/Mayaverse-dev/MAYA-Downloads](https://github.com/Mayaverse-dev/MAYA-Downloads)

**Easiest:** Double-click **`push-to-github.bat`** in this folder. It will add, commit, and push to `Mayaverse-dev/MAYA-Downloads`. If the remote already has different history, run in Command Prompt:

```bash
git push -u origin main --force
```
(Only if you want to replace the repo content with this project.)

**Manual:**

```bash
cd "d:\Daksh's Backup\MAYA Downloads\maya-downloads"
git init
git remote add origin https://github.com/Mayaverse-dev/MAYA-Downloads.git
git add .
git commit -m "Plain HTML/CSS/JS: three-box homepage, category pages with preview"
git branch -M main
git push -u origin main
```
