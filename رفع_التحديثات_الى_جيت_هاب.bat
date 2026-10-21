@echo off
chcp 65001 >nul
echo ========================================================
echo     جاري رفع التحديثات الجديدة إلى GitHub (Railway Auto-Deploy)
echo ========================================================
cd /d "%~dp0"

echo [+] Adding modified files...
git add .

echo [+] Committing changes...
git commit -m "feat: beIN max 2-channel limit enforcement, broadcast toggle button & no-event status"

echo [+] Pushing to GitHub main branch...
git push origin main

echo ========================================================
echo     تم رفع التحديثات إلى GitHub بنجاح!
echo     سيبدأ خادم Railway بنشر التحديث فوراً.
echo ========================================================
pause
