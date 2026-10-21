using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Security;
using System.Security.Principal;
using System.Text.Json;

internal static class Program
{
    private static int Run(string exe,string cwd,params string[] args)
    {
        var info=new ProcessStartInfo(exe){WorkingDirectory=cwd,UseShellExecute=false};
        foreach(var arg in args)info.ArgumentList.Add(arg);
        using var process=Process.Start(info) ?? throw new Exception("Cannot start process.");
        process.WaitForExit();return process.ExitCode;
    }
    private static string Xml(string text)=>SecurityElement.Escape(text) ?? "";
    private static void RequireAdmin()
    {
        if(!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))
            throw new Exception("Open PowerShell as Administrator for installation, upgrade and service management.");
    }
    public static int Main(string[] args)
    {
        try
        {
            string command=args.Length==0?"help":args[0].ToLowerInvariant();
            // Credential subprocesses never extract a runtime or put passwords in command-line arguments.
            if(command=="credential-protect"){Console.Write(CredentialProtection.Protect(Console.In.ReadToEnd()));return 0;}
            if(command=="credential-unprotect"){Console.Write(CredentialProtection.Unprotect(Console.In.ReadToEnd()));return 0;}
            if(command=="credential-lock" && args.Length==2){CredentialProtection.LockFile(args[1]);return 0;}
            var allowed=new[]{"install","upgrade","start","stop","restart","status","uninstall","run","self-test","init","help","protect-accounts","dashboard"};
            if(args.Length>1 || !allowed.Contains(command))throw new Exception("Unknown command; use help.");
            if(command=="help")
            {
                Console.WriteLine("PunchService.exe init|install|upgrade|start|stop|restart|status|uninstall|run|self-test|protect-accounts|dashboard");
                Console.WriteLine("install automatically upgrades an existing service and keeps its Windows Log On account.");
                return 0;
            }
            string? installed=ServiceTools.ImagePath();
            string home=installed!=null?ServiceTools.Home(installed):AppContext.BaseDirectory;
            if(command=="status"){Console.WriteLine("State="+ServiceTools.State()+" (0=not installed, 1=stopped, 4=running)");Console.WriteLine("Path="+(installed ?? "not installed"));return 0;}
            if(command is "start" or "stop" or "restart" or "uninstall")
            {
                RequireAdmin();if(installed==null)throw new Exception("Service not installed. Run install.");
                if(command is "stop" or "restart" or "uninstall")ServiceTools.Stop();
                if(command is "start" or "restart")ServiceTools.Start();
                if(command=="uninstall")
                {
                    if(ServiceTools.Sc("delete",ServiceTools.Name)!=0)throw new Exception("Service deletion failed.");
                    ServiceTools.Wait(0);
                }
                return 0;
            }
            if(command=="dashboard")
            {
                using var cfg=JsonDocument.Parse(File.ReadAllText(Path.Combine(home,"config.json")));
                int port=cfg.RootElement.TryGetProperty("dashboard",out var dash)&&dash.TryGetProperty("port",out var p)?p.GetInt32():17840;
                Process.Start(new ProcessStartInfo("http://127.0.0.1:"+port){UseShellExecute=true});return 0;
            }
            if(command=="protect-accounts")
            {
                RequireAdmin();
                using var cfg=JsonDocument.Parse(File.ReadAllText(Path.Combine(home,"config.json")));
                CredentialProtection.Migrate(Path.GetFullPath(cfg.RootElement.GetProperty("accountsFile").GetString()!,home));return 0;
            }
            if(command is "install" or "upgrade")RequireAdmin();
            // Self-tests use their own distribution folder, never a previously installed production service folder.
            if(command=="self-test")home=AppContext.BaseDirectory;
            using var resource=Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip") ?? throw new Exception("Embedded runtime missing.");
            string hash=Convert.ToHexString(SHA256.HashData(resource)).Substring(0,16);resource.Position=0;
            string runtime=Path.Combine(home,".runtime",hash);
            using var mutex=new Mutex(false,"Local\\PunchServicePayload-"+hash);
            if(!mutex.WaitOne(TimeSpan.FromMinutes(5)))throw new Exception("Runtime extraction busy.");
            try
            {
                if(!File.Exists(Path.Combine(runtime,".complete")))
                {
                    if(Directory.Exists(runtime))Directory.Delete(runtime,true);
                    Directory.CreateDirectory(runtime);
                    using var zip=new ZipArchive(resource,ZipArchiveMode.Read,leaveOpen:true);
                    zip.ExtractToDirectory(runtime);
                    File.WriteAllText(Path.Combine(runtime,".complete"),hash);
                }
            }finally{mutex.ReleaseMutex();}
            string node=Path.Combine(runtime,"node.exe"),wrapper=Path.Combine(runtime,"wrapper.exe");
            Environment.SetEnvironmentVariable("PUNCH_HELPER_EXE",Environment.ProcessPath);
            if(command=="self-test")
            {
                var secret="fixture-dpapi-test";
                if(CredentialProtection.Unprotect(CredentialProtection.Protect(secret))!=secret)throw new Exception("DPAPI roundtrip failed.");
                var testFile=Path.GetTempFileName();try{CredentialProtection.LockFile(testFile);}finally{File.Delete(testFile);}
                int result=Run(node,runtime,"--test","test/schedule.test.js","test/retry.test.js","test/dashboard.test.js","test/upgrades.test.js");
                if(result!=0)return result;
                return Run(node,runtime,"packaging/smoke.cjs");
            }
            void CopyTemplate(string source,string target){var destination=Path.Combine(home,target);if(!File.Exists(destination))File.Copy(Path.Combine(runtime,source),destination);}
            if(command is "init" or "install" or "upgrade")
            {
                CopyTemplate("config.example.json","config.json");CopyTemplate("accounts.example.json","accounts.local.json");
                CopyTemplate("off_days.example.json","off_days.json");CopyTemplate("THIRD-PARTY-NOTICES.txt","THIRD-PARTY-NOTICES.txt");
                if(command=="init"){Console.WriteLine("Configuration templates created; existing settings preserved.");return 0;}
            }
            if(command is "install" or "upgrade" or "run")
            {
                using var cfg=JsonDocument.Parse(File.ReadAllText(Path.Combine(home,"config.json")));
                foreach(string key in new[]{"LOGIN_URL","TARGET_URL","USERNAME_SELECTOR","PASSWORD_SELECTOR","SUBMIT_SELECTOR","BUTTON_IN_SELECTOR","BUTTON_OUT_SELECTOR"})
                    if(!cfg.RootElement.GetProperty("environment").TryGetProperty(key,out var value)||string.IsNullOrWhiteSpace(value.GetString()))throw new Exception("Fill config.json environment."+key);
                string file=Path.GetFullPath(cfg.RootElement.GetProperty("accountsFile").GetString()!,home);
                using var accounts=JsonDocument.Parse(File.ReadAllText(file));
                if(accounts.RootElement.GetArrayLength()==0)throw new Exception("Add at least one account.");
                foreach(var account in accounts.RootElement.EnumerateArray())
                {
                    if(string.IsNullOrWhiteSpace(account.GetProperty("username").GetString()))throw new Exception("Account username is empty.");
                    if(account.TryGetProperty("passwordProtected",out var encrypted))CredentialProtection.Unprotect(encrypted.GetString()!);
                    else if(!account.TryGetProperty("password",out var plain)||string.IsNullOrEmpty(plain.GetString()))throw new Exception("Account password missing.");
                }
            }
            if(command=="run")
            {
                Environment.SetEnvironmentVariable("PUNCH_ROOT",home);
                Environment.SetEnvironmentVariable("PLAYWRIGHT_BROWSERS_PATH",Path.Combine(runtime,"browsers"));
                return Run(node,home,Path.Combine(runtime,"service","worker.js"));
            }
            string xmlPath=Path.Combine(runtime,"wrapper.xml");
            if(command is "install" or "upgrade")
            {
                bool wasRunning=ServiceTools.State()==4;
                ServiceTools.Stop();
                string configFile=Path.Combine(home,"config.json");
                using var accountConfig=JsonDocument.Parse(File.ReadAllText(configFile));
                string credentialsFile=Path.GetFullPath(accountConfig.RootElement.GetProperty("accountsFile").GetString()!,home);
                byte[] originalCredentials=File.ReadAllBytes(credentialsFile);
                string launcher=Path.Combine(home,"PunchService.exe");
                if(!Path.GetFullPath(Environment.ProcessPath!).Equals(Path.GetFullPath(launcher),StringComparison.OrdinalIgnoreCase))
                    File.Copy(Environment.ProcessPath!,launcher,true);
                Directory.CreateDirectory(Path.Combine(home,"logs"));
                string xml=$"""
                <service>
                  <id>PunchInOut</id><name>Punch In Out</name>
                  <description>Verified daily punch scheduler with local dashboard</description>
                  <executable>{Xml(node)}</executable>
                  <arguments>"{Xml(Path.Combine(runtime,"service","worker.js"))}"</arguments>
                  <workingdirectory>{Xml(home)}</workingdirectory>
                  <env name="PUNCH_ROOT" value="{Xml(home)}"/>
                  <env name="PUNCH_HELPER_EXE" value="{Xml(launcher)}"/>
                  <env name="PLAYWRIGHT_BROWSERS_PATH" value="{Xml(Path.Combine(runtime,"browsers"))}"/>
                  <startmode>Automatic</startmode>
                  <logpath>{Xml(Path.Combine(home,"logs"))}</logpath><log mode="roll"/>
                  <onfailure action="restart" delay="30 sec"/><stoptimeout>20 sec</stoptimeout>
                </service>
                """;
                string? oldXml=File.Exists(xmlPath)?File.ReadAllText(xmlPath):null;
                File.WriteAllText(xmlPath,xml);
                if(installed==null)
                {
                    if(Run(wrapper,runtime,"install")!=0)throw new Exception("Service installation failed.");
                }
                else
                {
                    if(ServiceTools.Sc("config",ServiceTools.Name,"binPath=","\""+wrapper+"\"")!=0)
                    {
                        if(oldXml!=null)File.WriteAllText(xmlPath,oldXml);
                        throw new Exception("Service upgrade failed; existing service registration retained.");
                    }
                }
                try {CredentialProtection.Migrate(credentialsFile);if(wasRunning)ServiceTools.Start();}
                catch
                {
                    File.WriteAllBytes(credentialsFile,originalCredentials);CredentialProtection.LockFile(credentialsFile);
                    if(installed!=null){ServiceTools.Sc("config",ServiceTools.Name,"binPath=",installed);if(oldXml!=null)File.WriteAllText(xmlPath,oldXml);}
                    throw new Exception("Upgrade credential migration/start failed. Original credentials and registration restored; inspect logs before starting.");
                }
                Console.WriteLine(installed==null?"Installed. Use start when ready.":"Upgraded. Windows Log On account, settings and history preserved.");
                Console.WriteLine("Dashboard: http://127.0.0.1:17840 (or configured port)");return 0;
            }
            return 0;
        }
        catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
    }
}
