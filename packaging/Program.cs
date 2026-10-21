
using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Security;
using System.Text.Json;

internal static class Program
{
    private static int Run(string exe, string cwd, params string[] args)
    {
        var info = new ProcessStartInfo(exe) { WorkingDirectory = cwd, UseShellExecute = false };
        foreach (var arg in args) info.ArgumentList.Add(arg);
        using var process = Process.Start(info) ?? throw new Exception("Cannot start " + exe);
        process.WaitForExit();
        return process.ExitCode;
    }
    private static string Xml(string text) => SecurityElement.Escape(text) ?? "";
    public static int Main(string[] args)
    {
        try
        {
            var command = args.Length == 0 ? "help" : args[0].ToLowerInvariant();
            var allowed = new[] { "install", "start", "stop", "restart", "status", "uninstall", "run", "self-test", "init", "help" };
            if (args.Length > 1 || !allowed.Contains(command)) throw new Exception("Unknown command; use help.");
            if (command == "help")
            {
                Console.WriteLine("PunchService.exe init|install|start|stop|restart|status|uninstall|run|self-test");
                Console.WriteLine("Put EXE in a permanent writable folder. init creates configuration templates.");
                Console.WriteLine("install/management require an Administrator terminal. VPN is managed externally.");
                return 0;
            }
            var home = AppContext.BaseDirectory;
            using var resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip")
                ?? throw new Exception("Embedded runtime missing.");
            var hash = Convert.ToHexString(SHA256.HashData(resource)).Substring(0, 16);
            resource.Position = 0;
            var runtime = Path.Combine(home, ".runtime", hash);
            using var mutex = new Mutex(false, "Local\\PunchServicePayload-" + hash);
            if (!mutex.WaitOne(TimeSpan.FromMinutes(5))) throw new Exception("Runtime extraction is busy.");
            try
            {
                if (!File.Exists(Path.Combine(runtime, ".complete")))
                {
                    if (Directory.Exists(runtime)) Directory.Delete(runtime, true);
                    Directory.CreateDirectory(runtime);
                    using var zip = new ZipArchive(resource, ZipArchiveMode.Read, leaveOpen: true);
                    zip.ExtractToDirectory(runtime);
                    File.WriteAllText(Path.Combine(runtime, ".complete"), hash);
                }
            }
            finally { mutex.ReleaseMutex(); }
            var node = Path.Combine(runtime, "node.exe");
            var wrapper = Path.Combine(runtime, "wrapper.exe");
            if (command == "self-test")
            {
                var result = Run(node, runtime, "--test", "test/schedule.test.js", "test/retry.test.js");
                if (result != 0) return result;
                return Run(node, runtime, "packaging/smoke.cjs");
            }
            void CopyTemplate(string source, string target)
            {
                var destination = Path.Combine(home, target);
                if (!File.Exists(destination)) File.Copy(Path.Combine(runtime, source), destination);
            }
            if (command is "init" or "install")
            {
                CopyTemplate("config.example.json", "config.json");
                CopyTemplate("accounts.example.json", "accounts.local.json");
                CopyTemplate("off_days.example.json", "off_days.json");
                CopyTemplate("THIRD-PARTY-NOTICES.txt", "THIRD-PARTY-NOTICES.txt");
                Console.WriteLine("Configuration templates are beside the EXE. Existing files are preserved.");
                if (command == "init") return 0;
            }
            if (command is "install" or "run")
            {
                using var config = JsonDocument.Parse(File.ReadAllText(Path.Combine(home, "config.json")));
                var env = config.RootElement.GetProperty("environment");
                foreach (var key in new[] {"LOGIN_URL","TARGET_URL","USERNAME_SELECTOR","PASSWORD_SELECTOR","SUBMIT_SELECTOR","BUTTON_IN_SELECTOR","BUTTON_OUT_SELECTOR"})
                    if (!env.TryGetProperty(key, out var value) || string.IsNullOrWhiteSpace(value.GetString()))
                        throw new Exception("Fill config.json environment." + key + " before installation.");
                var accountsPath = Path.GetFullPath(config.RootElement.GetProperty("accountsFile").GetString()!, home);
                using var accounts = JsonDocument.Parse(File.ReadAllText(accountsPath));
                if (accounts.RootElement.GetArrayLength() == 0) throw new Exception("Fill accounts.local.json first.");
                foreach (var account in accounts.RootElement.EnumerateArray())
                    if (string.IsNullOrWhiteSpace(account.GetProperty("username").GetString()) ||
                        string.IsNullOrWhiteSpace(account.GetProperty("password").GetString()))
                        throw new Exception("Accounts require username and password.");
            }
            var xmlPath = Path.Combine(runtime, "wrapper.xml");
            if (command == "install")
            {
                Directory.CreateDirectory(Path.Combine(home, "logs"));
                var xml = $"""
                <service>
                  <id>PunchInOut</id><name>Punch In Out</name>
                  <description>Daily punch scheduler. VPN managed externally.</description>
                  <executable>{Xml(node)}</executable>
                  <arguments>"{Xml(Path.Combine(runtime, "service", "worker.js"))}"</arguments>
                  <workingdirectory>{Xml(home)}</workingdirectory>
                  <env name="PUNCH_ROOT" value="{Xml(home)}"/>
                  <env name="PLAYWRIGHT_BROWSERS_PATH" value="{Xml(Path.Combine(runtime, "browsers"))}"/>
                  <startmode>Automatic</startmode>
                  <logpath>{Xml(Path.Combine(home, "logs"))}</logpath><log mode="roll"/>
                  <onfailure action="restart" delay="30 sec"/><stoptimeout>20 sec</stoptimeout>
                </service>
                """;
                // Do not mutate a running or installed service's wrapper settings.
                if (File.Exists(xmlPath)) throw new Exception("Already initialized for install. Uninstall before reinstalling.");
                File.WriteAllText(xmlPath, xml);
                var code = Run(wrapper, runtime, "install");
                if (code != 0) { File.Delete(xmlPath); return code; }
                Console.WriteLine("Installed, not started. Configure Log On account in services.msc if your VPN is user-scoped, then use start.");
                return 0;
            }
            if (command == "run")
            {
                Environment.SetEnvironmentVariable("PUNCH_ROOT", home);
                Environment.SetEnvironmentVariable("PLAYWRIGHT_BROWSERS_PATH", Path.Combine(runtime, "browsers"));
                return Run(node, home, Path.Combine(runtime, "service", "worker.js"));
            }
            if (!File.Exists(xmlPath)) throw new Exception("Service not installed by this EXE. Use the original EXE for stop/uninstall.");
            if (command == "uninstall")
            {
                // stop may fail when already stopped; uninstall still verifies the final result.
                Run(wrapper, runtime, "stop");
                var code = Run(wrapper, runtime, "uninstall");
                if (code == 0) File.Delete(xmlPath);
                return code;
            }
            return Run(wrapper, runtime, command);
        }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
}
