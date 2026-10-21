using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Win32;

internal static class CredentialProtection
{
    [StructLayout(LayoutKind.Sequential)] private struct Blob { public int Length; public IntPtr Data; }
    [DllImport("crypt32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    private static extern bool CryptProtectData(ref Blob input, string? description, IntPtr entropy, IntPtr reserved, IntPtr prompt, uint flags, out Blob output);
    [DllImport("crypt32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    private static extern bool CryptUnprotectData(ref Blob input, IntPtr description, IntPtr entropy, IntPtr reserved, IntPtr prompt, uint flags, out Blob output);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr pointer);
    private static byte[] Transform(byte[] data, bool protect)
    {
        var memory=Marshal.AllocHGlobal(data.Length);
        var input=new Blob {Length=data.Length,Data=memory};
        Blob output=default;
        try
        {
            Marshal.Copy(data,0,memory,data.Length);
            bool ok=protect ? CryptProtectData(ref input,null,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,5,out output)
                : CryptUnprotectData(ref input,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,1,out output);
            if(!ok)throw new Exception("Windows DPAPI operation failed. Check machine and service identity.");
            var result=new byte[output.Length];Marshal.Copy(output.Data,result,0,result.Length);return result;
        }
        finally {for(int i=0;i<data.Length;i++)Marshal.WriteByte(memory,i,0);Marshal.FreeHGlobal(memory);if(output.Data!=IntPtr.Zero)LocalFree(output.Data);}
    }
    internal static string Protect(string value)=>Convert.ToBase64String(Transform(Encoding.UTF8.GetBytes(value),true));
    internal static string Unprotect(string value)=>Encoding.UTF8.GetString(Transform(Convert.FromBase64String(value),false));
    internal static void LockFile(string file)
    {
        var acl=new FileSecurity();acl.SetAccessRuleProtection(true,false);
        var identities=new HashSet<string>{"S-1-5-18","S-1-5-32-544",WindowsIdentity.GetCurrent().User!.Value};
        using var key=Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\PunchInOut");
        var account=key?.GetValue("ObjectName") as string;
        if(!string.IsNullOrWhiteSpace(account) && !account.Equals("LocalSystem",StringComparison.OrdinalIgnoreCase))
        {
            if(account.StartsWith(@".\"))account=Environment.MachineName+account.Substring(1);
            identities.Add(((SecurityIdentifier)new NTAccount(account).Translate(typeof(SecurityIdentifier))).Value);
        }
        foreach(var sid in identities)acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid),FileSystemRights.FullControl,AccessControlType.Allow));
        new FileInfo(file).SetAccessControl(acl);
    }
    internal static void Migrate(string file)
    {
        var rows=JsonNode.Parse(File.ReadAllText(file))?.AsArray() ?? throw new Exception("Accounts must be an array.");
        foreach(var row in rows)
        {
            if(row?["password"] is JsonValue password)
            {
                row["passwordProtected"]=Protect(password.GetValue<string>());
                row.AsObject().Remove("password");
            }
        }
        var temp=file+".protected.tmp";
        File.WriteAllText(temp,rows.ToJsonString(new System.Text.Json.JsonSerializerOptions {WriteIndented=true}));
        LockFile(temp);File.Move(temp,file,true);Console.WriteLine("Account passwords protected with Windows DPAPI.");
    }
}
