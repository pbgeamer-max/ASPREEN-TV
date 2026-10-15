@echo off
chcp 65001 >nul
title ASPREEN TV - خادم البث المستمر 24/7 (Persistent Stream Proxy)
cd /d "%~dp0"

:loop
echo =====================================================================
echo       ASPREEN TV ▸ تشغيل خادم البث المستمر والتحديث التلقائي 24/7
echo =====================================================================
echo.
python scripts\aspreen_stream_proxy_daemon.py
echo.
echo [!] تم إيقاف الخادم أو إعادة التشغيل، جارٍ استئناف العمل خلال 3 ثوانٍ...
timeout /t 3 /nobreak >nul
goto loop
