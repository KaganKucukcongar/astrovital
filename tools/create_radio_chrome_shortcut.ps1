$ErrorActionPreference = 'Stop'
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path $chrome)) { throw 'Chrome kurulu değil' }
$profile = Join-Path $env:LOCALAPPDATA 'AstroVitalX\TelsizChrome'
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'AstroVital X - Mikrofonlu Telsiz.lnk'
$trustedOrigins = 'http://192.168.10.1:5173,http://192.168.4.1:5173'
# Trust ONLY two LAN origins, in a dedicated Chrome session.
# This does not auto-grant microphone consent.
$args = '--no-first-run --no-default-browser-check --new-window --user-data-dir="' + $profile + '" --unsafely-treat-insecure-origin-as-secure=' + $trustedOrigins + ' http://192.168.10.1:5173/'
$wshell = New-Object -ComObject WScript.Shell
$shortcut = $wshell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $chrome
$shortcut.Arguments = $args
$shortcut.WorkingDirectory = Split-Path $chrome
$shortcut.IconLocation = $chrome + ',0'
$shortcut.Description = 'AstroVital telsiz; iki yerel IP adresinde mikrofon izni isteyebilir'
$shortcut.Save()
$check = $wshell.CreateShortcut($shortcutPath)
if($check.Arguments -notmatch 'unsafely-treat-insecure-origin-as-secure=') { throw 'Shortcut argümanları yazılamadı' }
Write-Output ('SHORTCUT_CREATED=' + $shortcutPath)
Write-Output ('TARGET=' + $check.TargetPath)
Write-Output ('ORIGINS=' + $trustedOrigins)
Write-Output ('SEPARATE_PROFILE=' + $profile)
Write-Output ('MICROPHONE_AUTOGRANT=FALSE')
