using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
internal static class DashboardLan
{
    private static string Password(string prompt)
    {
        Console.Write(prompt);
        if(Console.IsInputRedirected)return Console.ReadLine()??"";
        var value=new StringBuilder();
        while(true){
            var key=Console.ReadKey(true);
            if(key.Key==ConsoleKey.Enter){Console.WriteLine();return value.ToString();}
            if(key.Key==ConsoleKey.Backspace){if(value.Length>0)value.Length--;continue;}
            if(!char.IsControl(key.KeyChar))value.Append(key.KeyChar);
        }
    }
    private static int Firewall(params string[] args)
    {
        var info=new ProcessStartInfo(Path.Combine(Environment.SystemDirectory,"netsh.exe")){UseShellExecute=false};
        foreach(var arg in args)info.ArgumentList.Add(arg);
        using var process=Process.Start(info)!;process.WaitForExit();return process.ExitCode;
    }
    internal static void Configure(string home)
    {
        var file=Path.Combine(home,"config.json");
        var config=JsonNode.Parse(File.ReadAllText(file))!.AsObject();
        var dashboard=config["dashboard"] as JsonObject ?? new JsonObject();
        int port=dashboard["port"]?.GetValue<int>()??17840;
        if(port<1 || port>65535)throw new Exception("Invalid dashboard port.");
        string password=Password("New dashboard password (at least 12 characters): ");
        if(password.Length<12 || password.Length>512)throw new Exception("Dashboard password must contain 12..512 characters.");
        if(password!=Password("Confirm password: "))throw new Exception("Passwords do not match.");
        var salt=RandomNumberGenerator.GetBytes(16);
        var hash=Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password),salt,210000,HashAlgorithmName.SHA256,32);
        dashboard["enabled"]=true;dashboard["host"]="0.0.0.0";dashboard["port"]=port;
        dashboard["auth"]=new JsonObject{
            ["username"]="admin",["salt"]=Convert.ToHexString(salt).ToLowerInvariant(),
            ["passwordHash"]=Convert.ToHexString(hash).ToLowerInvariant(),["iterations"]=210000
        };
        if(config["dashboard"]==null)config["dashboard"]=dashboard;
        if(Firewall("advfirewall","firewall","set","rule","name=WFMicros Dashboard","new","dir=in","action=allow","protocol=TCP","localport="+port,"remoteip=LocalSubnet","profile=private")!=0 &&
           Firewall("advfirewall","firewall","add","rule","name=WFMicros Dashboard","dir=in","action=allow","protocol=TCP","localport="+port,"remoteip=LocalSubnet","profile=private")!=0)
            throw new Exception("Could not configure the Private/LocalSubnet firewall rule. Configuration was not saved.");
        var temp=file+".lan.tmp";
        File.WriteAllText(temp,config.ToJsonString(new System.Text.Json.JsonSerializerOptions{WriteIndented=true}));
        File.Move(temp,file,true);
        Console.WriteLine("LAN dashboard configured. Login: admin. Restart the service to apply.");
        Console.WriteLine("Open http://<this-PC-LAN-IP>:"+port+" on the same trusted LAN. Use HTTPS tunnel for untrusted networks.");
    }
}
