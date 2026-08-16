' start-supervisor.vbs — launch gun relay+bridge supervisor hidden at logon.
' Placed in the user Startup folder; requires no admin rights.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "D:\OpenCodeWEB\OS\gun-relay"
sh.Run "node supervisor.js", 0, False
