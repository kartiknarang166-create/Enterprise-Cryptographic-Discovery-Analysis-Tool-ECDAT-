# Creates a Windows Startup folder shortcut for the ECDAT API
# No admin rights needed — runs at user login automatically

$startupFolder = [System.Environment]::GetFolderPath('Startup')
Write-Host "Startup folder: $startupFolder"

$WshShell = New-Object -comObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$startupFolder\ECDAT_API.lnk")
$Shortcut.TargetPath     = 'd:\ECDAT\ecdat-monorepo\start_backend.bat'
$Shortcut.WorkingDirectory = 'd:\ECDAT\ecdat-monorepo\backend'
$Shortcut.WindowStyle    = 7   # 7 = Minimized window
$Shortcut.Description    = 'ECDAT FastAPI backend auto-start'
$Shortcut.Save()

Write-Host ""
Write-Host "Startup shortcut created successfully!" -ForegroundColor Green
Write-Host "Path: $startupFolder\ECDAT_API.lnk" -ForegroundColor Cyan
Write-Host ""
Write-Host "The ECDAT API will now auto-start minimized on every Windows login." -ForegroundColor Green
Write-Host "To remove: Delete the file '$startupFolder\ECDAT_API.lnk'" -ForegroundColor Gray
