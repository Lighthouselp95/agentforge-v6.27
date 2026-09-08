using System;
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
        int parentPid = int.Parse(args[0]);
        int targetPid = int.Parse(args[1]);

        try {
            string jobName = "AgentForge_ChildJob_" + parentPid;
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
                hTargetProc = OpenProcess(0x1F0FFF /* PROCESS_ALL_ACCESS */, false, targetPid);
            }
            if (hTargetProc == IntPtr.Zero) { CloseHandle(hJob); return 4; }

            bool assignOk = AssignProcessToJobObject(hJob, hTargetProc);
            CloseHandle(hTargetProc);

            IntPtr hParent = OpenProcess(PROCESS_DUP_HANDLE, false, parentPid);
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
