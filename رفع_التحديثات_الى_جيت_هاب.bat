@echo off
cd /d "%~dp0"
echo ========================================================
echo    Uploading updates to GitHub (Railway Auto-Deploy)
echo ========================================================

echo [+] Adding modified files...
git add .

echo [+] Committing changes...
git commit -m "feat: add all Shahid live channels with multi-bitrate servers"

echo [+] Pushing to GitHub main branch...
git push origin main

echo ========================================================
echo Finished! Press any key to exit.
echo ========================================================
pause
