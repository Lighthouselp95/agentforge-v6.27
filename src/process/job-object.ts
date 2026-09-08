/**
 * Windows Kernel Job Object Manager
 * 
 * Native Windows Job Object Kernel integration:
 * - Creates Job Object named 'AgentForge_ChildJob_' + process.pid
 * - Sets JobObjectExtendedLimitInformation with LimitFlags = 0x2000 (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE)
 * - Assigns child processes to the Job Object
 * - Duplicates job handle into parent process (AgentForge)
 * - Windows Kernel automatically, atomically terminates ALL processes in the Job Object
 *   when the parent process terminates or is killed.
 * - Zero polling loops, zero CPU overhead, no external watchdog processes.
 */
import { execFile, execFileSync, spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const isWin = process.platform === 'win32';
const parentPid = process.pid;

let helperExePath: string | null = null;
let initDone = false;

const CS_SOURCE = `using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public class Program {
    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetInformationJobObject(IntPtr hJob, int JobObjectInfoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint processAccess, bool bInheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool DuplicateHandle(IntPtr hSourceProcessHandle, IntPtr hSourceHandle, IntPtr hTargetProcessHandle, out IntPtr lpTargetHandle, uint dwDesiredAccess, bool bInheritHandle, uint dwOptions);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseHandle(IntPtr hObject);

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct IO_COUNTERS {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryLimit;
        public UIntPtr PeakJobMemoryLimit;
    }

    public const int JobObjectExtendedLimitInformation = 9;
    public const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
    public const uint PROCESS_DUP_HANDLE = 0x0040;
    public const uint PROCESS_SET_QUOTA = 0x0100;
    public const uint PROCESS_TERMINATE = 0x0001;
    public const uint DUPLICATE_SAME_ACCESS = 2;

    public static int Main(string[] args) {
        if (args.Length < 2) return 1;
        int pPid = int.Parse(args[0]);
        int targetPid = int.Parse(args[1]);

        try {
            string jobName = "AgentForge_ChildJob_" + pPid;
            IntPtr hJob = CreateJobObject(IntPtr.Zero, jobName);
            if (hJob == IntPtr.Zero) return 2;

            JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

            int length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            IntPtr pInfo = Marshal.AllocHGlobal(length);
            Marshal.StructureToPtr(info, pInfo, false);

            bool setOk = SetInformationJobObject(hJob, JobObjectExtendedLimitInformation, pInfo, (uint)length);
            Marshal.FreeHGlobal(pInfo);
            if (!setOk) { CloseHandle(hJob); return 3; }

            IntPtr hTargetProc = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, targetPid);
            if (hTargetProc == IntPtr.Zero) {
                hTargetProc = OpenProcess(0x1F0FFF, false, targetPid);
            }
            if (hTargetProc == IntPtr.Zero) { CloseHandle(hJob); return 4; }

            bool assignOk = AssignProcessToJobObject(hJob, hTargetProc);
            CloseHandle(hTargetProc);

            IntPtr hParent = OpenProcess(PROCESS_DUP_HANDLE, false, pPid);
            if (hParent != IntPtr.Zero) {
                IntPtr hTargetJob;
                DuplicateHandle(GetCurrentProcess(), hJob, hParent, out hTargetJob, 0, false, DUPLICATE_SAME_ACCESS);
                CloseHandle(hParent);
            }
            CloseHandle(hJob);
            return assignOk ? 0 : 5;
        } catch {
            return 6;
        }
    }
}
`;

function ensureHelper(): string | null {
  if (!isWin) return null;
  if (initDone && helperExePath) return helperExePath;
  initDone = true;

  try {
    const candidatePaths = [
      join(process.cwd(), 'scripts', 'bin', 'job-object-helper.exe'),
      join(process.cwd(), 'bin', 'job-object-helper.exe'),
      join(process.env.TEMP || 'C:\\Windows\\Temp', 'AgentForge', 'job-object-helper.exe')
    ];

    for (const p of candidatePaths) {
      if (existsSync(p)) {
        helperExePath = p;
        return helperExePath;
      }
    }

    // Nếu chưa có, tự động biên dịch bằng csc.exe native của Windows
    const targetDir = join(process.cwd(), 'scripts', 'bin');
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }
    const csPath = join(targetDir, 'job-object-helper.cs');
    const exePath = join(targetDir, 'job-object-helper.exe');

    writeFileSync(csPath, CS_SOURCE, 'utf8');

    const cscCompiler = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
    if (existsSync(cscCompiler)) {
      execFileSync(cscCompiler, ['/nologo', '/optimize+', '/target:exe', `/out:${exePath}`, csPath], {
        windowsHide: true,
        stdio: 'ignore'
      });
      if (existsSync(exePath)) {
        helperExePath = exePath;
        console.log(`[JobObject] Compiled native Windows Kernel Job Object helper at: ${exePath}`);
        return helperExePath;
      }
    }
  } catch (err: any) {
    console.warn(`[JobObject] Failed to initialize compiled helper: ${err?.message || err}`);
  }
  return helperExePath;
}

/**
 * Gán tiến trình con vào Windows Kernel Job Object của cha (AgentForge).
 * Khi cha bị kill đột ngột, Kernel tự động quét sạch toàn bộ tiến trình trong Job Object.
 */
export function assignProcessToJob(childPid: number): void {
  if (!isWin || !childPid || childPid <= 0) return;

  try {
    const exe = ensureHelper();
    if (exe && existsSync(exe)) {
      execFile(exe, [String(parentPid), String(childPid)], { windowsHide: true }, (err) => {
        if (err) {
          console.warn(`[JobObject] assignProcessToJob failed for PID ${childPid}: ${err.message}`);
        } else {
          // Thành công gán vào Job Object
        }
      });
      return;
    }

    // Fallback: PowerShell inline P/Invoke nếu không có exe
    const psCmd = `
      $parentPid = ${parentPid};
      $targetPid = ${childPid};
      $code = @'
${CS_SOURCE}
'@;
      Add-Type -TypeDefinition $code -Language CSharp -ErrorAction SilentlyContinue;
      [Program]::Main(@("$parentPid", "$targetPid"));
    `;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psCmd], {
      windowsHide: true,
      stdio: 'ignore'
    });
    child.unref();
  } catch (e: any) {
    console.warn(`[JobObject] Error in assignProcessToJob: ${e?.message || e}`);
  }
}
