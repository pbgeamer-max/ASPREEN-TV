@echo off
chcp 65001 >nul
cd /d "%~dp0"
python scripts\harvest_all_oscar_channels.py
pause
