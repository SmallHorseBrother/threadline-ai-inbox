[CmdletBinding()]
param(
  [string]$SyncRoot,
  [ValidateRange(5, 1440)]
  [int]$IntervalMinutes = 15,
  [ValidateSet("账号1", "账号2")]
  [string]$AccountAlias = "账号1",
  [switch]$RedactTitles
)

$ErrorActionPreference = "Stop"
$taskName = "Threadline Codex Snapshot - $AccountAlias"

if (-not $SyncRoot) {
  if ($env:OneDrive) {
    $SyncRoot = Join-Path $env:OneDrive "CodexTaskBoard"
  } else {
    throw "OneDrive was not detected. Pass -SyncRoot for another synchronized directory."
  }
}

$python = Get-Command python -ErrorAction Stop
$toolDir = Join-Path $SyncRoot "tool"
$snapshotDir = Join-Path $SyncRoot "snapshots"
$sourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$deviceId = ($env:COMPUTERNAME -replace "[^A-Za-z0-9._-]", "-").ToLowerInvariant()
$accountFileKey = if ($AccountAlias -eq "账号2") { "account2" } else { "account1" }

New-Item -ItemType Directory -Path $toolDir -Force | Out-Null
New-Item -ItemType Directory -Path $snapshotDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceDir "codex_task_sync.py") -Destination $toolDir -Force
Copy-Item -LiteralPath (Join-Path $sourceDir "render_board.py") -Destination $toolDir -Force
Copy-Item -LiteralPath (Join-Path $sourceDir "snapshot.schema.json") -Destination $toolDir -Force

$runnerPath = Join-Path $toolDir "run-threadline-sync.ps1"
$redactFlag = if ($RedactTitles) { " --redact-titles" } else { "" }
$runner = @"
`$ErrorActionPreference = "Stop"
`$python = "$($python.Source)"
`$tool = "$toolDir\codex_task_sync.py"
`$renderer = "$toolDir\render_board.py"
`$snapshots = "$snapshotDir"
`$own = Join-Path `$snapshots "$accountFileKey-$deviceId.json"
& `$python `$tool export --device-id "$deviceId" --account-alias "$AccountAlias" --output `$own$redactFlag
if (`$LASTEXITCODE -ne 0) { exit `$LASTEXITCODE }
& `$python `$tool merge `$snapshots --output "$SyncRoot\board.json"
if (`$LASTEXITCODE -ne 0) { exit `$LASTEXITCODE }
& `$python `$renderer "$SyncRoot\board.json" --output "$SyncRoot\board.html"
exit `$LASTEXITCODE
"@
Set-Content -LiteralPath $runnerPath -Value $runner -Encoding utf8

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runnerPath`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Read-only Codex metadata export and cross-device Threadline board merge." -Force | Out-Null

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runnerPath
if ($LASTEXITCODE -ne 0) { throw "Initial synchronization failed with exit code $LASTEXITCODE" }

[pscustomobject]@{
  Installed = $true
  TaskName = $taskName
  DeviceId = $deviceId
  AccountAlias = $AccountAlias
  SyncRoot = $SyncRoot
  Snapshot = Join-Path $snapshotDir "$accountFileKey-$deviceId.json"
  Board = Join-Path $SyncRoot "board.json"
  OfflineBoard = Join-Path $SyncRoot "board.html"
  IntervalMinutes = $IntervalMinutes
  TitlesRedacted = [bool]$RedactTitles
}
