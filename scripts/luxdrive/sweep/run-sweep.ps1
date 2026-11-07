# Lux Drive sweeps on the MSI (Windows).  Start detached:  powershell -File run-sweep.ps1 -Which drive|look -Args "<arguments of the script>" [-Name tag]
# Logs to C:\luxdrive\sweep-out\<tag>.log; the script itself is started with Start-Process so it survives the ssh session.
param([string]$Which = 'drive', [string]$ScriptArgs = '', [string]$Name = '', [switch]$Inner)
$Out = 'C:\luxdrive\sweep-out'
if ($Name -eq '') { $Name = $Which }
New-Item -ItemType Directory -Force $Out | Out-Null
if (-not $Inner) {
  $a = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Inner -Which $Which -Name $Name -ScriptArgs `"$ScriptArgs`""
  Start-Process powershell -ArgumentList $a -WindowStyle Hidden
  "started $Name"
  exit 0
}
Set-Location C:\luxdrive\ian-site
$env:PATH = "C:\luxdrive\node-v24.11.0-win-x64;$env:PATH"
$env:PW_HOME = 'C:\luxdrive\node-tools'
$script = if ($Which -eq 'drive') { 'scripts\luxdrive\sweep\sweep-drive.mjs' } else { 'scripts\luxdrive\sweep\sweep-look.mjs' }
$sw = [Diagnostics.Stopwatch]::StartNew()
"[run-sweep] $(Get-Date -Format s) start: node $script $ScriptArgs" | Out-File "$Out\$Name.log" -Encoding utf8
cmd /c "node $script $ScriptArgs >> $Out\$Name.log 2>&1"
"[run-sweep] $(Get-Date -Format s) exit code $LASTEXITCODE after $([math]::Round($sw.Elapsed.TotalMinutes,1)) min" | Out-File "$Out\$Name.log" -Append -Encoding utf8
