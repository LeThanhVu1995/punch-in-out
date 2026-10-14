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
