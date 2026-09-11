Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\Hai Dang\test-agentforge thoi"
WshShell.Run "cmd /c npm run dev", 0, False
