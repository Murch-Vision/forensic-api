Option Explicit

Dim shell, fso, launcher
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
launcher = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "start-windows.bat")

shell.Run Chr(34) & launcher & Chr(34), 0, False
