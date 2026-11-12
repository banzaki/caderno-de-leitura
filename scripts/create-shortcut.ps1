# Creates (or updates) the "Caderno de Leitura" shortcut on the Windows desktop.
# Run with: npm run shortcut
$ErrorActionPreference = 'Stop'

$projectDir = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Caderno de Leitura.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $projectDir 'start.cmd'
$shortcut.WorkingDirectory = $projectDir
$shortcut.WindowStyle = 7  # start the console window minimized
$shortcut.IconLocation = Join-Path $projectDir 'public\icon.ico'
$shortcut.Description = 'Open the Caderno de Leitura reading notebook'
$shortcut.Save()

Write-Output "Shortcut created: $shortcutPath"
