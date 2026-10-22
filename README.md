# WFMicros — Windows Service

Single Windows x64 EXE with Node.js, Playwright, Chromium and WinSW.
VPN stays under the machine/user's control. The computer must remain awake and connected.

## Download / first install
GitHub Actions > latest successful **Build Windows EXE** run > Artifacts >
**WFMicros-windows-x64**. Extract WFMicros.exe into a permanent directory.
The EXE extracts its bundled runtime into .runtime/ on first use; retain that directory.

Open PowerShell as Administrator:
```powershell
.\WFMicros.exe init
```
Fill config.json URLs/selectors and accounts.local.json:
```json
[{"username":"your-user","password":"your-password","enabled":true}]
```
Then:
```powershell
.\WFMicros.exe install
.\WFMicros.exe start
.\WFMicros.exe dashboard
```
No separate Node.js, browser or .NET installation is required on the target machine.
Install automatically encrypts account passwords before the worker starts.
Use services.msc > WFMicros > Log On if the preconnected VPN requires a particular Windows account.
After changing Log On, run protect-accounts as Administrator to refresh account-file permissions.

## Upgrade / manage any older build
Run the NEW EXE as Administrator:
```powershell
.\WFMicros.exe upgrade
```
It finds the existing registered service and its data directory, stops it, extracts the new runtime,
updates the existing service path and preserves its Windows Log On account. A previously running
service resumes; a stopped service stays stopped. Settings and history are kept.
You may run the new EXE from a download folder: it copies itself to the existing installation folder.
install also upgrades an existing service. No manual uninstall/state deletion is needed.

```powershell
.\WFMicros.exe status
.\WFMicros.exe stop
.\WFMicros.exe start
.\WFMicros.exe restart
.\WFMicros.exe uninstall
.\WFMicros.exe protect-accounts
```
Management commands find the registered service independently of which EXE build you use.
run is a LIVE foreground worker; never use it alongside the service/Actions for the same accounts.
self-test uses only local fixtures and never connects to the real attendance website.
Unsigned binaries may display Windows SmartScreen. Keep installation/runtime write access restricted
to trusted administrators and the service identity. Closing the dashboard does not stop the service.

## Schedule and retries
Default timezone Asia/Ho_Chi_Minh, Monday–Friday:
- IN: independent random time per user from 07:20 to 08:30.
- OUT: independent random time per user from 17:40 to 18:35.
- off_days.json global/per-user holidays and weekend exclusions apply.
Selected times are saved in data/state.json before execution. Restart retains them.
Pending jobs may run late within their window; past-window jobs become missed.
Accounts run serially. Checks occur every pollSeconds (default 15).

Pre-click failures retry up to 3 times (4 attempts total), 60 seconds apart.
Other accounts proceed while retries wait. Attempts and retry times survive restart.
Once a punch click may have started, ambiguous outcomes never automatically repeat.
Legacy unknown jobs are retained. Manual replays require reviewing attendance first.
A manual replay begins a fresh retry budget while keeping total attempt numbers and old logs.

## Local dashboard
Open http://127.0.0.1:17840 on the Windows machine, or use the dashboard EXE command.
The service cannot open a desktop browser on its own.
- Monitor: readable IN/OUT due times, statuses, retry counts, connectivity and latest logs.
- Run now: one user, failed/missed users, or all accounts for the selected IN/OUT mode.
  Manual commands apply to today only and bypass that day's window/holidays.
  Running users are skipped. Repeating success/clicked/unknown users requires explicit confirmation.
- History: date picker and an individual record/log for each attempt.
- Settings: add/remove/enable/disable users; change passwords, windows, weekdays, holidays,
  retries, timeouts, URLs/selectors, connectivity checks and verification rules.
Blank password inputs preserve existing passwords; stored passwords/ciphertext never return to the browser.
Editors use file revisions to reject stale saves.
Already selected daily due times remain persisted; changed windows immediately act as limits and are
used for future daily plans. An already running disabled/removed user may finish its current attempt.

The dashboard listens on loopback only. Action requests require same-origin checks and a session token.
It has no separate user login; other users signed into this Windows machine may access it.
Set dashboard.enabled=false or change dashboard.port in config.json and restart if needed.

## Verify actual attendance success
No website-specific success selector or API is guessed. Until configured, the worker reports
clicked (unverified), never success. Configure one of these in dashboard Settings:
1. **selector**: the success result's CSS selector plus expected success text. Visible content
   must change after the click; a stale success message is rejected.
2. **response**: URL substring, optional HTTP method, JSON path and exact expected JSON value.
   A matching 2xx response AND the business value are required. HTTP 200 alone is insufficient.
   Example data.accepted equals true is only appropriate if that is the site's actual response.

Provide the real success-message HTML or Network response from the attendance website to configure it.
Verification timeout or ambiguous response is not treated as a confirmed failure to be punched again.

| Status | Meaning |
| --- | --- |
| pending | Waiting for the due/retry time |
| running | Attempt in progress |
| success | Configured website success evidence matched |
| clicked | Button clicked; attendance still unverified |
| unknown | Interrupted/ambiguous after a click may have started |
| failed | Pre-click retries exhausted |
| missed | Window/day expired |

## Connectivity
Default preflight checks LOGIN_URL and TARGET_URL without logging in/punching.
DNS/TLS/timeout and HTTP 5xx failures count as pre-click failures and retry within the budget.
Reachable login/auth redirects prove network reachability, not successful login.
The dashboard's connection-check button performs the same read-only test.
VPN is never connected/disconnected by this app.

## Password protection
Windows DPAPI LocalMachine encrypts account passwords; the account file's ACL allows SYSTEM,
administrators, the service identity and the identity performing migration.
Machine-scope DPAPI relies on these file permissions to restrict other local users.
The helper receives secrets through stdin, never command-line arguments or plaintext temporary files.
Passwords are decrypted in process memory. Encrypted files require the same Windows machine.
Existing plaintext backups, copies and Git history are not automatically removed.

## Data / source build
- config.json, accounts.local.json, off_days.json: local settings (gitignored).
- data/state.json: persistent scheduling and retry state; do not delete to upgrade.
- data/history.jsonl: append-only attempts; dashboard reads the latest 20 MB.
- data/runs/<date>/<hex-user>-<mode>/attempt-N/: logs, screenshots and progress evidence.
- data/manual-actions.jsonl: manual-action audit without passwords.
- logs/: WinSW/worker stdout and stderr.
Old versions did not retain every attempt; imported historical rows are marked legacy.

Source mode: install Node.js >=22, npm install, npx playwright install chromium, npm start.
Source mode reads plaintext legacy accounts; Windows EXE is required to edit/protect passwords.
npm test runs local automated tests. On Windows with the helper, it also checks real DPAPI/ACLs.
To build the complete EXE on Windows with Node.js 22 and .NET SDK 8:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-exe.ps1
```
The build includes only explicit code/templates, never real config/accounts/holidays.
CI checks schedule/retry/dashboard/settings/history/connectivity/verification, DPAPI, browser UI,
service install/start/upgrade/stop/uninstall and management from a relocated EXE.
Production website/VPN behavior must still be verified on the target machine.

## Easier leave registration and paired history
The **Ngày nghỉ** tab has a monthly calendar, range-date form, multiple-account selection, notes
and an editable registration list. Existing global/per-user date lists are displayed as ranges
without changing the file on read. The first write stores registrations and rebuilds global/users,
so the scheduler stays compatible. Editing/deleting overlapping registrations preserves dates still
covered by another registration. Each registration is limited to 366 days. Stale edits are rejected.

The **Lịch sử** tab has its own Hôm nay / Hôm qua / 7 ngày shortcuts, from/to inputs (max 31 days),
account search, review-needed filter and one row per account/day with IN and OUT side by side.
Each cell shows scheduled/actual start times and status. Open details for per-attempt times/reasons/logs.
Manual retry is available for today only and still requires confirmation for ambiguous/completed clicks.

The Windows Services display name is **WFMicros**. The internal service ID remains `PunchInOut` for compatibility with existing installations and service-account permissions. Run `WFMicros.exe upgrade` as Administrator to update the existing installation without uninstalling; settings, accounts and history are retained.
