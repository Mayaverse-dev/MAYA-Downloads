@echo off
cd /d "%~dp0"
set REPO=https://github.com/Mayaverse-dev/MAYA-Downloads.git

if not exist .git (
  echo Initializing git...
  git init
  git remote add origin %REPO%
  git branch -M main
)

git add .
git status
echo.
set /p confirm="Commit and push to Mayaverse-dev/MAYA-Downloads? (y/n): "
if /i not "%confirm%"=="y" exit /b 0

git commit -m "Plain HTML/CSS/JS: three-box homepage, category pages with preview, fixed download links"
if errorlevel 1 (
  echo Nothing to commit or commit failed.
  pause
  exit /b 1
)

git push -u origin main 2>nul
if errorlevel 1 (
  echo.
  echo Push failed. If the repo already has different history, overwrite with:
  echo   git push -u origin main --force
  echo (Only do this if you want to replace GitHub content with this folder.)
)
echo.
pause
