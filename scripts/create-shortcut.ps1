# Creates (or updates) the "Caderno de Leitura" shortcuts on the desktop and in the Start menu.
# They open the notebook as an app: its own window, no console. Run with: npm run shortcut
# Windows does not let programs pin themselves to the taskbar: right-click the shortcut in the
# Start menu and choose "Pin to taskbar".
$ErrorActionPreference = 'Stop'

$projectDir = Split-Path -Parent $PSScriptRoot
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Caderno de Leitura.lnk'
$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Caderno de Leitura.lnk'

$shell = New-Object -ComObject WScript.Shell
foreach ($path in @($desktop, $startMenu)) {
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $shortcut.Arguments = '"' + (Join-Path $projectDir 'app.vbs') + '"'
  $shortcut.WorkingDirectory = $projectDir
  $shortcut.IconLocation = Join-Path $projectDir 'public\icon.ico'
  $shortcut.Description = 'Open the Caderno de Leitura reading notebook'
  $shortcut.Save()
  Write-Output "Shortcut created: $path"
}
