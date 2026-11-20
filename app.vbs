' Opens Caderno de Leitura as an app: starts the server with no console window
' and shows the notebook in its own window. Closing that window stops the server.
' To see errors, use start.cmd instead.
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
If Not fso.FolderExists("node_modules") Then
  shell.Run "cmd /c npm install", 1, True
End If
shell.Run "node server.js --app", 0, False
