
# Run in an elevated PowerShell. Install Node.js first.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
if (!(Test-Path "config.json")) { throw "Copy config.example.json to config.json and configure it first." }
if (!(Test-Path "accounts.local.json")) { throw "Create accounts.local.json first (see README)." }
$node = (Get-Command node -ErrorAction Stop).Source
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
# Use a common browser location accessible to the service account.
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $root "browsers"
npx playwright install chromium
if ($LASTEXITCODE -ne 0) { throw "Chromium installation failed" }
$exe = Join-Path $root "WFMicros.exe"
if (!(Test-Path $exe)) {
  throw "Download WinSW-x64.exe v2.12.0 from https://github.com/winsw/winsw/releases/tag/v2.12.0 and save it as WFMicros.exe in the repository folder."
}
$nodeXml = [System.Security.SecurityElement]::Escape($node)
@"
<service>
  <id>PunchInOut</id>
  <name>WFMicros</name>
  <description>Weekday punch scheduler. VPN managed externally.</description>
  <executable>$nodeXml</executable>
  <arguments>"%BASE%\service\worker.js"</arguments>
  <workingdirectory>%BASE%</workingdirectory>
  <env name="PLAYWRIGHT_BROWSERS_PATH" value="%BASE%\browsers"/>
  <startmode>Automatic</startmode>
  <logpath>%BASE%\logs</logpath>
  <log mode="roll"/>
  <onfailure action="restart" delay="30 sec"/>
  <stoptimeout>20 sec</stoptimeout>
</service>
"@ | Set-Content -Path (Join-Path $root "WFMicros.xml") -Encoding UTF8
& $exe install
if ($LASTEXITCODE -ne 0) { throw "Service installation failed" }
Write-Host "Installed. In services.msc, configure the Log On account if your VPN is user-scoped, then start WFMicros."
