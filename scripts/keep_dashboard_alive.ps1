# Tiene acceso il dev server, e con lui i poller.
#
# Perche' serve: il sito su Vercel non raccoglie niente da solo, legge solo
# quello che i poller sulla macchina locale scrivono su Supabase. Se il server
# locale e' spento, la giornata resta senza dati e la pagina mostra un errore.
#
# Due lavori, in un solo ciclo:
#   1. se `npm run dev` esce (crash, riavvio, chiusura del terminale che lo
#      ospitava) lo rifa' partire dopo 15 secondi;
#   2. ogni minuto chiede a /api/poller di assicurarsi che i due poller Python
#      siano vivi. La rotta non li duplica se gia' girano, quindi e' un
#      controllo a costo zero -- ma se TWS cade e un poller muore, questo e'
#      l'unico modo per farlo ripartire: instrumentation.ts gira solo all'avvio
#      del server.
#
# Si puo' lanciare a mano (doppio clic su start_dashboard.bat) oppure
# registrare come attivita' pianificata al logon:
#   schtasks /Create /TN "GregDashboard" /SC ONLOGON /F /TR "powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"<percorso>\scripts\keep_dashboard_alive.ps1\""
# Per fermarla:  schtasks /End /TN "GregDashboard"
# Per toglierla: schtasks /Delete /TN "GregDashboard" /F

$ErrorActionPreference = 'Continue'

$root     = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $root 'frontend'
$logDir   = Join-Path $root '.tmp'
$logFile  = Join-Path $logDir 'keepalive.log'
$urlBase  = 'http://localhost:3000'

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

function Scrivi($testo) {
    $riga = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $testo"
    Add-Content -Path $logFile -Value $riga -Encoding utf8
    Write-Host $riga
}

# Il server risponde gia'? Vale sia contro il doppio avvio (Next andrebbe a
# occupare la 3001 e il sito finirebbe su una porta che nessuno guarda) sia
# per riagganciare un server avviato a mano.
function ServerVivo {
    try {
        Invoke-RestMethod -Uri "$urlBase/api/poller" -Method Get -TimeoutSec 5 | Out-Null
        return $true
    } catch {
        return $false
    }
}

function ControllaPoller {
    try {
        $r = Invoke-RestMethod -Uri "$urlBase/api/poller" -Method Post -TimeoutSec 30
        if ($r.started) { Scrivi "poller ripartiti: $($r.message)" }
    } catch {
        Scrivi "controllo poller fallito: $($_.Exception.Message)"
    }
}

Scrivi "supervisore avviato (root: $root)"

while ($true) {
    if (ServerVivo) {
        # Un altro processo tiene su la 3000: non se ne avvia un secondo, ma il
        # controllo dei poller resta utile.
        Start-Sleep -Seconds 60
        ControllaPoller
        continue
    }

    Scrivi 'avvio dev server'
    $p = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', 'dev' `
                       -WorkingDirectory $frontend -PassThru -NoNewWindow

    # WaitForExit con timeout invece di sleep + HasExited: se il server muore
    # se ne accorge subito, non al minuto successivo.
    while (-not $p.WaitForExit(60000)) {
        ControllaPoller
    }

    $codice = if ($null -ne $p.ExitCode) { $p.ExitCode } else { 'n/d' }
    Scrivi "dev server uscito con codice $codice, riparte fra 15 secondi"
    Start-Sleep -Seconds 15
}
