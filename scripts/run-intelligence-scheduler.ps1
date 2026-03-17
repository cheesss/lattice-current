[CmdletBinding()]
param(
  [switch]$Once,
  [int]$PollMinutes = 5,
  [string]$RegistryPath,
  [string]$StatePath,
  [string]$EnvFile = ".env.local"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logRoot = Join-Path $repoRoot "data\\automation\\logs"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

function Import-SimpleEnvFile {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return
  }

  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) {
      return
    }

    $separator = $line.IndexOf("=")
    if ($separator -lt 1) {
      return
    }

    $name = $line.Substring(0, $separator).Trim()
    $value = $line.Substring($separator + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    Set-Item -Path ("Env:{0}" -f $name) -Value $value
  }
}

$nodeCommand = Get-Command node -ErrorAction Stop
$nodePath = $nodeCommand.Source

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stdoutPath = Join-Path $logRoot "scheduler-$timestamp.out.log"
$stderrPath = Join-Path $logRoot "scheduler-$timestamp.err.log"
$baseArguments = @("--import", "tsx", "scripts/intelligence-scheduler.mjs", "--once")
if ($RegistryPath) {
  $baseArguments += @("--registry", $RegistryPath)
}
if ($StatePath) {
  $baseArguments += @("--state", $StatePath)
}

Set-Location $repoRoot

function Invoke-SchedulerCycle {
  Import-SimpleEnvFile -Path (Join-Path $repoRoot $EnvFile)
  Import-SimpleEnvFile -Path (Join-Path $repoRoot ".env")
  "[$([DateTime]::UtcNow.ToString('o'))] starting intelligence scheduler cycle ($($baseArguments -join ' '))" | Out-File -FilePath $stdoutPath -Encoding utf8 -Append
  & $nodePath @baseArguments 1>> $stdoutPath 2>> $stderrPath
}

if ($Once) {
  Invoke-SchedulerCycle
  exit $LASTEXITCODE
}

while ($true) {
  try {
    Invoke-SchedulerCycle
  } catch {
    "[$([DateTime]::UtcNow.ToString('o'))] scheduler wrapper error: $($_.Exception.Message)" | Out-File -FilePath $stderrPath -Encoding utf8 -Append
  }
  Start-Sleep -Seconds ([Math]::Max(60, $PollMinutes * 60))
}
