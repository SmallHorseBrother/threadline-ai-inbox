[CmdletBinding()]
param(
  [ValidateSet("账号1", "账号2")]
  [string]$AccountAlias = "账号1"
)

$ErrorActionPreference = "Stop"
$taskName = "Threadline Codex Snapshot - $AccountAlias"
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

[pscustomobject]@{
  Removed = [bool]$existing
  TaskName = $taskName
  Note = "同步目录和历史快照已保留，便于恢复或手工删除。"
}
