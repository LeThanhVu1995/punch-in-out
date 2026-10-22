
$ErrorActionPreference = "Stop"
$exe = Join-Path (Split-Path $PSScriptRoot -Parent) "WFMicros.exe"
& $exe stop
& $exe uninstall
if ($LASTEXITCODE -ne 0) { throw "Service uninstall failed" }
