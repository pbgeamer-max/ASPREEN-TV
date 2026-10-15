@echo off
chcp 65001 >nul
title ASPREEN TV - سحب وتحديث جميع قنوات ياسين تيفي
cd /d "%~dp0"
echo ===================================================
echo     ASPREEN TV - Yacine TV Master Harvester
echo ===================================================
python scripts\harvest_yacine_channels.py
pause
