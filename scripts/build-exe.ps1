
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
function Check-Exit($message) { if ($LASTEXITCODE -ne 0) { throw $message } }
$stage = Join-Path (Get-Location) "build\payload"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item $stage -ItemType Directory -Force | Out-Null
# Payload contains only explicitly selected code/templates, never real accounts or secrets.
Copy-Item run.js, package.json, config.example.json $stage
Copy-Item service, test $stage -Recurse
New-Item (Join-Path $stage "packaging") -ItemType Directory | Out-Null
Copy-Item packaging\smoke.cjs (Join-Path $stage "packaging")
'[]' | Set-Content (Join-Path $stage "accounts.example.json") -Encoding ASCII
'{"timezone":"Asia/Ho_Chi_Minh","skipWeekends":true,"global":[],"users":{}}' | Set-Content (Join-Path $stage "off_days.example.json") -Encoding ASCII
Copy-Item (Get-Command node).Source (Join-Path $stage "node.exe")
Push-Location $stage
try {
  npm install --omit=dev --ignore-scripts
  Check-Exit "Dependency installation failed"
  $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $stage "browsers"
  npx playwright install chromium
  Check-Exit "Browser installation failed"
  node --test test/schedule.test.js test/retry.test.js
  Check-Exit "Scheduler tests failed"
  node packaging/smoke.cjs
  Check-Exit "Browser smoke test failed"
} finally { Pop-Location }
Invoke-WebRequest "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe" -OutFile (Join-Path $stage "wrapper.exe")
Invoke-WebRequest "https://raw.githubusercontent.com/winsw/winsw/v2.12.0/LICENSE.txt" -OutFile (Join-Path $stage "WinSW-LICENSE.txt")
$nodeExe = (Get-Command node).Source
$nodeLicense = Join-Path (Split-Path $nodeExe) "LICENSE"
if (!(Test-Path $nodeLicense)) {
  Invoke-WebRequest "https://raw.githubusercontent.com/nodejs/node/$(node -p 'process.version')/LICENSE" -OutFile (Join-Path $stage "Node-LICENSE.txt")
} else { Copy-Item $nodeLicense (Join-Path $stage "Node-LICENSE.txt") }
@'
This distribution includes Node.js, Playwright, Chromium and WinSW.
WinSW: MIT; see WinSW-LICENSE.txt.
Node.js and bundled third parties: see Node-LICENSE.txt.
Playwright: Apache-2.0; licenses included under node_modules.
Chromium: BSD and third-party licenses; licenses distributed with the browser runtime.
Sources: https://nodejs.org/ https://github.com/microsoft/playwright https://www.chromium.org/ https://github.com/winsw/winsw
'@ | Set-Content (Join-Path $stage "THIRD-PARTY-NOTICES.txt") -Encoding UTF8
$zip = Join-Path (Get-Location) "packaging\payload.zip"
if (Test-Path $zip) {Remove-Item $zip}
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip)
dotnet publish packaging/PunchService.csproj -c Release -o dist
Check-Exit "EXE publishing failed"
& .\dist\PunchService.exe self-test
Check-Exit "Packaged EXE self-test failed"
(Get-FileHash .\dist\PunchService.exe -Algorithm SHA256).Hash | Set-Content dist\PunchService.exe.sha256
Write-Host "Created dist\PunchService.exe"
