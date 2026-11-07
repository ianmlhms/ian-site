# Lux Drive sweeps on the MSI (Windows).  Start detached:  powershell -File run-sweep.ps1 -Which drive|look -Args "<arguments of the script>" [-Name tag]
# ScriptArgs are written with '@@' for '--' (PowerShell reads a value that starts with dashes as a parameter name).
# Logs to C:\luxdrive\sweep-out\<tag>.log; the script itself is started with Start-Process so it survives the ssh session.
param([string]$Which = 'drive', [string]$ScriptArgs = '', [string]$Name = '', [switch]$Inner)
$Out = 'C:\luxdrive\sweep-out'
if ($Name -eq '') { $Name = $Which }
New-Item -ItemType Directory -Force $Out | Out-Null
if (-not $Inner) {
  # a scheduled task under the user: a plain Start-Process child dies with the ssh session
  $launcher = "$Out\run-$Name.cmd"
  "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Inner -Which $Which -Name $Name -ScriptArgs `"$ScriptArgs`"" | Out-File $launcher -Encoding ascii
  schtasks /create /tn "luxsweep-$Name" /tr $launcher /sc once /st 23:59 /f | Out-Null
  schtasks /run /tn "luxsweep-$Name"
  exit 0
}
Set-Location C:\luxdrive\ian-site
$env:PATH = "C:\luxdrive\node-v24.11.0-win-x64;$env:PATH"
$env:PW_HOME = 'C:\luxdrive\node-tools'
$script = if ($Which -eq 'drive') { 'scripts\luxdrive\sweep\sweep-drive.mjs' } else { 'scripts\luxdrive\sweep\sweep-look.mjs' }
$sw = [Diagnostics.Stopwatch]::StartNew()
$ScriptArgs = $ScriptArgs.Replace("@@", "--")
"[run-sweep] $(Get-Date -Format s) start: node $script $ScriptArgs" | Out-File "$Out\$Name.log" -Encoding utf8
cmd /c "node $script $ScriptArgs >> $Out\$Name.log 2>&1"
"[run-sweep] $(Get-Date -Format s) exit code $LASTEXITCODE after $([math]::Round($sw.Elapsed.TotalMinutes,1)) min" | Out-File "$Out\$Name.log" -Append -Encoding utf8
