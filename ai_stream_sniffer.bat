@echo off
chcp 65001 >nul
title ASPREEN TV - AI Passive Stream Sniffer
cd /d "%~dp0"
python scripts\ai_stream_sniffer.py
pause
