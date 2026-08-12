@echo off
title Greg Dashboard - Start All
cd /d "%~dp0"

echo Avvio Frontend (Next.js)...
echo I poller (tws_poller.py + tws_volumes_poller.py) partono da soli
echo insieme al server, via frontend\src\instrumentation.ts
echo.

cd frontend
start http://localhost:3000
npm run dev
