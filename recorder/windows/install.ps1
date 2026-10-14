<#
.SYNOPSIS
Builds the recorder on this Windows machine and has Task Scheduler start it when the current user signs in.

.DESCRIPTION
Checks Node.js (22.15 or newer), runs `npm ci` and `npm run build` in the recorder's folder (the one above this
script), and registers a task that runs windows\run.cmd with the given env file when the current user signs in.
run.cmd writes the log to logs\recorder-<date>.log and starts the recorder again a minute after a crash.

The env file holds the settings and the worker token. This script does not read it: it only checks that it is there
and passes its path on, so no secret ends up in the task or in this script. Run the script again after an update of
the recorder (git pull, or a new copy of the folder): it builds again and replaces the task.

.PARAMETER EnvFile
The env file of the recorder, KEY=value lines (see windows\recorder.env.example), such as C:\csfaceit\recorder.env.

.PARAMETER TaskName
The name of the task in Task Scheduler. "CsFaceIt recorder" by default.

.PARAMETER StartNow
Starts the task as soon as it is registered.

.PARAMETER NoTask
Only builds; registers no task.

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File .\windows\install.ps1 -EnvFile C:\csfaceit\recorder.env -StartNow
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$EnvFile,
    [string]$TaskName = 'CsFaceIt recorder',
    [switch]$StartNow,
    [switch]$NoTask
)

$ErrorActionPreference = 'Stop'
$recorder = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'run.cmd'

function Stop-WithMessage([string]$message) {
    Write-Host $message -ForegroundColor Red
    exit 1
}

# Node.js 22.15 or newer: the recorder unpacks the demos with the zstd stream of node:zlib, which came with it.
if ($null -eq (Get-Command node -ErrorAction SilentlyContinue)) {
    Stop-WithMessage ('Node.js is not installed or not on the PATH: install Node.js 22 LTS from https://nodejs.org, ' +
        'then open a new PowerShell window and run this again.')
}
$version = (& node --version).Trim().TrimStart('v')
$numbers = @($version.Split('.') | ForEach-Object { [int]$_ })
if ($numbers[0] -lt 22 -or ($numbers[0] -eq 22 -and $numbers[1] -lt 15)) {
    Stop-WithMessage "Node.js $version is too old: the recorder needs 22.15 or newer (Node.js 22 LTS from https://nodejs.org)."
}

$EnvFile = [System.IO.Path]::GetFullPath($EnvFile)
if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    Stop-WithMessage "There is no env file at ${EnvFile}: copy windows\recorder.env.example there and fill it in."
}

Write-Host "Building the recorder in $recorder (Node.js $version)"
Push-Location $recorder
try {
    & npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage 'npm ci failed: see its output above.' }
    & npm run build
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage 'npm run build failed: see its output above.' }
}
finally {
    Pop-Location
}

if ($NoTask) {
    Write-Host 'Built. No task was registered (-NoTask). By hand: windows\run.cmd <env file>'
    exit 0
}

# cmd.exe takes what follows /c with its first and last quote removed, so both quoted paths stay quoted.
$arguments = '/d /c ""{0}" "{1}""' -f $launcher, $EnvFile
$action = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\cmd.exe') -Argument $arguments `
    -WorkingDirectory $recorder
$user = "$env:USERDOMAIN\$env:USERNAME"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
# Only while the user is signed in, on his desktop: the game needs one. Without administrator rights.
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
# No time limit (by default a task is stopped after 3 days), normal priority (the default, 7, is below normal, and the
# game and ffmpeg would inherit it), on battery too, and no second copy while one runs. run.cmd restarts a crash itself.
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -Priority 4 -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
    -Description 'Records the clips of CsFaceIt with CS2 and CS Demo Manager (recorder\windows\run.cmd)' -Force | Out-Null

Write-Host "Task '$TaskName' registered: the recorder starts when $user signs in."
Write-Host "Its log: $(Join-Path $recorder 'logs')\recorder-<date>.log"
if ($StartNow) {
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Task '$TaskName' started."
}
Write-Host "Start it:  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Stop it:   Stop-ScheduledTask -TaskName '$TaskName'   (or Ctrl+C in its window, which gives the clip back)"
Write-Host "Remove it: Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
