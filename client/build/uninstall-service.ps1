# Mythclass 客户端卸载脚本（需要管理员权限）
# 用法：以管理员身份运行 → .\uninstall-service.ps1

$ErrorActionPreference = 'Continue'

function Assert-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Host '[X] 请用管理员身份运行。' -ForegroundColor Red
        exit 1
    }
}

Assert-Admin

$appName     = 'MythclassClient'
$guardName   = 'MythclassGuard'
$installRoot = Join-Path $env:ProgramFiles 'Mythclass'
$appData     = Join-Path $env:APPDATA 'Mythclass'

Write-Host ''
Write-Host '  Mythclass 客户端卸载' -ForegroundColor Yellow
Write-Host '  ------------------------------------------------'

# 1. 停任务
Write-Host '[1/5] 停计划任务…'
Stop-ScheduledTask -TaskName $appName -ErrorAction SilentlyContinue
Stop-ScheduledTask -TaskName $guardName -ErrorAction SilentlyContinue
schtasks /Delete /TN $appName /F 2>$null | Out-Null
schtasks /Delete /TN $guardName /F 2>$null | Out-Null

# 2. 结束进程
Write-Host '[2/5] 结束进程…'
Get-Process -Name 'Mythclass' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# 3. 恢复任务管理器
Write-Host '[3/5] 放开任务管理器…'
$policyKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\System'
if (Test-Path $policyKey) {
    Remove-ItemProperty -Path $policyKey -Name 'DisableTaskMgr' -ErrorAction SilentlyContinue
}

# 4. 清自启
Write-Host '[4/5] 清自启项…'
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'Mythclass' -ErrorAction SilentlyContinue

# 5. 删文件（保留配置，问一句）
Write-Host '[5/5] 删安装目录…'
Remove-Item $installRoot -Recurse -Force -ErrorAction SilentlyContinue

$answer = Read-Host "要不要连本地记录一起删掉？($appData) [y/N]"
if ($answer -eq 'y' -or $answer -eq 'Y') {
    Remove-Item $appData -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host '  记录也删了。'
} else {
    Write-Host "  记录留着：$appData"
}

Write-Host ''
Write-Host '  卸完了。' -ForegroundColor Green
Write-Host ''
