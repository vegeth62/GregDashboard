@echo off
title Greg Dashboard - Start All
cd /d "%~dp0"

echo Avvio Frontend (Next.js) sotto supervisore...
echo I poller (tws_poller.py + tws_volumes_poller.py) partono da soli
echo insieme al server, via frontend\src\instrumentation.ts
echo.
echo Se il server esce, il supervisore lo rifa' partire da solo e ogni
echo minuto controlla che i poller siano ancora vivi. Log in .tmp\keepalive.log
echo Per fermare tutto: chiudi questa finestra.
echo.

start http://localhost:3000
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\keep_dashboard_alive.ps1"
