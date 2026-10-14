# Punch In Out — Windows Service

Node.js + Playwright worker, wrapped as a Windows Service with WinSW.
VPN is managed by the machine; this application never connects or disconnects it.

## Schedule
- Asia/Ho_Chi_Minh, Monday–Friday.
- IN: random time per account each day, 07:20–08:30 inclusive.
- OUT: random time per account each day, 17:40–18:35 inclusive.
- Existing off_days.json global and per-user holidays are respected.
- Schedule is saved before executing. Restart keeps the selected times.
- A pending overdue job runs only while its window is still open. Past-window jobs are missed.
- Serial execution: other accounts may wait; the window is checked before every run.
- The old batch start/between-user delays are disabled for service jobs because times are selected individually.
- Changes to windows affect newly generated jobs; existing daily times remain persisted.
- Config and holiday files are reread on each polling cycle.

## Install (Windows x64)
1. Install Node.js 22 or newer. Clone/download this repository to a permanent directory.
2. Copy config.example.json to config.json. Fill URLs and selectors in environment using the values previously configured as GitHub Secrets. GitHub Secrets are not downloaded to this machine.
3. Create accounts.local.json with your accounts:
   ```json
   [{"username":"your-user","password":"your-password"}]
   ```
   Local configuration/accounts are gitignored. Restrict their Windows file permissions.
   The legacy accounts.json is kept for existing Actions compatibility; it is not the service default.
4. Download **WinSW-x64.exe v2.12.0** from https://github.com/winsw/winsw/releases/tag/v2.12.0, rename to PunchService.exe and put beside package.json.
5. Open PowerShell as Administrator in the repository:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\install-service.ps1
   ```
6. Open services.msc. If the preconnected VPN is user-scoped, set Punch In Out > Properties > Log On to the Windows account that can access the target via VPN. Confirm reachability under that account. Start the service:
   ```powershell
   .\PunchService.exe start
   .\PunchService.exe status
   ```
   Installation does not start the worker, allowing account/network configuration first.

Machine must be on and awake. A service cannot use a disconnected user VPN.
Chromium is installed into the repository browsers directory so the service account can access it.
Grant the service account read access to the repo/config/browser and write access to data/ and logs/.

## Manage
```powershell
.\PunchService.exe stop
.\PunchService.exe start
.\PunchService.exe restart
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-service.ps1
```

For foreground use: npm start. This is a LIVE worker that can punch; do not run it alongside Actions or another installation for the same accounts.
Do not schedule the old GitHub workflow in parallel with this service.

## Results and failure handling
- data/state.json stores selected times and statuses.
- data/runs/YYYY-MM-DD/<hex-username>-IN or OUT contains run.log, results.json, screenshots and debug HTML.
- logs/ contains wrapper/stdout/stderr logs. Periodically remove old run folders as needed.
- clicked means Playwright clicked the button, **not verified server acceptance**.
- running becomes unknown on restart. Failures/timeouts also become unknown; no automatic retry because the server may already have accepted the click.
- Inspect the website attendance record before any manual retry. Do not delete the state file merely to restart the service.
- The local PID lock prevents simultaneous workers using this folder. Separate clones/Actions are outside that protection.
- npm test checks scheduling without contacting the attendance website.
- Windows installation, VPN access and live attendance must be verified on the actual Windows machine.

## Single EXE (recommended)
Open GitHub Actions > Build Windows EXE > latest successful run > download
**PunchService-windows-x64** artifact. Extract PunchService.exe into a permanent writable folder.
No separate Node.js, WinSW, browser or .NET installation is needed on the target Windows x64 machine.

```powershell
.\PunchService.exe init
# Edit config.json, accounts.local.json and off_days.json beside the EXE.
# Then open an Administrator terminal:
.\PunchService.exe install
# Configure service Log On account in services.msc if needed for your preconnected VPN.
.\PunchService.exe start
.\PunchService.exe status
```

Commands: init, install, start, stop, restart, status, uninstall, run (LIVE foreground worker),
self-test (offline schedule/browser tests), help. Double-click shows help; use a terminal for commands.
The EXE embeds Node.js, dependencies, Chromium and WinSW. It extracts them to .runtime/
beside itself once; keep that folder and the EXE in place while installed.
This is a single distribution EXE, not a service that runs without extracted runtime files.
The browser makes the EXE large and first launch slower.
Service install intentionally does not start punching.
Generated templates contain no real credentials or personal holiday dates.
Keep config/accounts private and copy existing holidays if needed.
Restrict write access to the installation folder, configuration and runtime to trusted administrators
and the intended service account; grant the account access to data/log folders.

For upgrades: stop and uninstall with the OLD EXE, replace it, install and start the NEW EXE.
Configuration and data/state.json are preserved; never delete state to perform an upgrade.
Do not install this package alongside the earlier source-based service; both use service ID PunchInOut.
Unsigned builds may trigger Windows SmartScreen; code signing is not included.

To build locally on Windows x64, install Node.js 22 and .NET SDK 8, then:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-exe.ps1
```
The build embeds only an allowlist of code/templates and production dependencies.
It runs schedule tests and a Chromium smoke test from the final EXE.
CI also checks WinSW install/start/stop/uninstall with a harmless timer, without submitting attendance.
