using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Xml.Linq;
using Microsoft.Win32;

internal static class ServiceTools
{
    internal const string Name="PunchInOut";
    internal static string? ImagePath()
    {
        using var key=Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\PunchInOut");
        return key?.GetValue("ImagePath") as string;
    }
    internal static string Binary(string image)
    {
        image=Environment.ExpandEnvironmentVariables(image.Trim());
        if(image.StartsWith('"'))return image.Split('"')[1];
        int end=image.IndexOf(".exe",StringComparison.OrdinalIgnoreCase);
        if(end<0)throw new Exception("Cannot parse registered service executable.");
        return image.Substring(0,end+4);
    }
    internal static string Home(string image)
    {
        string exe=Binary(image),dir=Path.GetDirectoryName(exe)!;
        string xml=Path.ChangeExtension(exe,".xml");
        if(File.Exists(xml))
        {
            var document=XDocument.Load(xml);
            var configured=document.Root?.Elements("env").FirstOrDefault(e=>(string?)e.Attribute("name")=="PUNCH_ROOT")?.Attribute("value")?.Value
                ?? document.Root?.Element("workingdirectory")?.Value;
            if(!string.IsNullOrWhiteSpace(configured))return Path.GetFullPath(Environment.ExpandEnvironmentVariables(configured.Replace("%BASE%",dir)));
        }
        if(Path.GetFileName(Path.GetDirectoryName(dir))==".runtime")return Directory.GetParent(dir)!.Parent!.FullName;
        return dir;
    }
    [StructLayout(LayoutKind.Sequential)]private struct Status {public uint Type,State,Accepted,WinExit,ServiceExit,Checkpoint,WaitHint;}
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]private static extern IntPtr OpenSCManager(string? machine,string? database,uint access);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]private static extern IntPtr OpenService(IntPtr manager,string name,uint access);
    [DllImport("advapi32.dll",SetLastError=true)]private static extern bool QueryServiceStatus(IntPtr service,out Status status);
    [DllImport("advapi32.dll")]private static extern bool CloseServiceHandle(IntPtr handle);
    internal static uint State()
    {
        var manager=OpenSCManager(null,null,1);if(manager==IntPtr.Zero)throw new Exception("Cannot access Service Manager.");
        var service=OpenService(manager,Name,4);
        try {if(service==IntPtr.Zero)return 0;if(!QueryServiceStatus(service,out var status))throw new Exception("Cannot query service status.");return status.State;}
        finally {if(service!=IntPtr.Zero)CloseServiceHandle(service);CloseServiceHandle(manager);}
    }
    internal static int Sc(params string[] args)
    {
        var info=new ProcessStartInfo(Path.Combine(Environment.SystemDirectory,"sc.exe")) {UseShellExecute=false};
        foreach(var arg in args)info.ArgumentList.Add(arg);
        using var process=Process.Start(info)!;process.WaitForExit();return process.ExitCode;
    }
    internal static void Wait(uint state)
    {
        var end=DateTime.UtcNow.AddSeconds(45);
        while(DateTime.UtcNow<end){if(State()==state)return;Thread.Sleep(250);}
        throw new Exception("Service did not reach the expected state; check logs and services.msc.");
    }
    internal static void Stop(){if(State()!=0 && State()!=1){if(Sc("stop",Name)!=0 && State()!=1)throw new Exception("Could not stop service.");Wait(1);}}
    internal static void Start(){if(State()!=4){if(Sc("start",Name)!=0 && State()!=4)throw new Exception("Could not start service.");Wait(4);}}
}
