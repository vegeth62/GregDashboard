@echo off
title Greg Dashboard - Start All
cd /d "%~dp0"

echo [1/3] Avvio tws_poller.py (VIX e ES=F)...
start /B python execution\tws_poller.py

echo [2/3] Avvio tws_volumes_poller.py (SPX Volumes)...
start /B python execution\tws_volumes_poller.py

echo [3/3] Avvio Frontend (Next.js)...
cd frontend
start http://localhost:3000
npm run dev
