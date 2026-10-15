@echo off
chcp 65001 >nul
title ASPREEN TV - المراقب الذكي لقنوات أوسكار (AI Passive Sniffer)
cd /d "%~dp0"
python scripts\ai_stream_sniffer.py
pause
