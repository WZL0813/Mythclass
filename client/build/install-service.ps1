# Mythclass 客户端安装脚本（需要管理员权限运行）
# 用法：右键 PowerShell → 以管理员身份运行 → .\install-service.ps1

$ErrorActionPreference = 'Stop'

function Assert-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Host '[X] 请用管理员身份运行这个脚本。' -ForegroundColor Red
        exit 1
    }
}

Assert-Admin

$appName     = 'MythclassClient'
$guardName   = 'MythclassGuard'
$clientDir   = Split-Path -Parent $PSScriptRoot          # client/
$repoDir     = Split-Path -Parent $clientDir             # 仓库根目录
$installRoot = Join-Path $env:ProgramFiles 'Mythclass'
$exePath     = Join-Path $installRoot 'Mythclass.exe'
$devMode     = -not (Test-Path $exePath)

Write-Host ''
Write-Host '  Mythclass 若思班级一体机管理系统 · 客户端安装' -ForegroundColor Green
Write-Host '  ------------------------------------------------'

# 1. 拷文件
if (-not (Test-Path $installRoot)) {
    New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
}
if (-not $devMode) {
    Copy-Item $exePath (Join-Path $installRoot 'Mythclass.exe') -Force
    Write-Host "[1/5] 已使用已打包的 exe：$exePath"
} else {
    Write-Host '[1/5] 没找到打包好的 exe，按开发模式装（依赖本机 Python）' -ForegroundColor Yellow
    Copy-Item (Join-Path $clientDir 'mythclass') (Join-Path $installRoot 'mythclass') -Recurse -Force
    $pythonw = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
    if (-not $pythonw) {
        Write-Host '[X] 找不到 pythonw.exe，请先装 Python 3.10+ 并勾选 Add to PATH。' -ForegroundColor Red
        exit 1
    }
    Write-Host "      Python：$pythonw"
}

# 2. 准备配置
$appData = Join-Path $env:APPDATA 'Mythclass'
if (-not (Test-Path $appData)) { New-Item -ItemType Directory -Path $appData -Force | Out-Null }
$configPath = Join-Path $appData 'config.json'
if (-not (Test-Path $configPath)) {
    $example = Join-Path $clientDir 'config.example.json'
    if (Test-Path $example) {
        Copy-Item $example $configPath -Force
        Write-Host "[2/5] 配置已生成：$configPath"
    }
} else {
    Write-Host "[2/5] 配置已存在，没动它：$configPath"
}

# 3. 决定启动命令
if ($devMode) {
    $launch = "`"$((Get-Command pythonw.exe).Source)`" -m mythclass"
} else {
    $launch = "`"$exePath`""
}

# 4. 建计划任务（SYSTEM 权限，登录即起）
Write-Host '[3/5] 建计划任务（SYSTEM 权限）…'
schtasks /Create /TN $appName /TR $launch /SC ONLOGON /RL HIGHEST /RU SYSTEM /F | Out-Null
schtasks /Create /TN $guardName /TR "$launch --guard 0" /SC ONSTART /RL HIGHEST /RU SYSTEM /F | Out-Null

# 5. 保险起见，当前用户 Run 键也写一份
Write-Host '[4/5] 写当前用户自启…'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
Set-ItemProperty -Path $runKey -Name 'Mythclass' -Value $launch

# 6. 收紧权限：普通用户不能删安装目录、不能停任务
Write-Host '[5/5] 收紧权限…'
icacls $installRoot /inheritance:r | Out-Null
icacls $installRoot /grant 'SYSTEM:(OI)(CI)F' | Out-Null
icacls $installRoot /grant 'Administrators:(OI)(CI)F' | Out-Null
icacls $installRoot /grant 'Users:(OI)(CI)RX' | Out-Null

# 7. 起进程
Start-ScheduledTask -TaskName $appName

Write-Host ''
Write-Host '  装好了。' -ForegroundColor Green
Write-Host "  安装目录：$installRoot"
Write-Host "  配置文件：$configPath"
Write-Host "  日志文件：$appData\client.log"
Write-Host ''
Write-Host '  托盘里应该出现绿色小图标。左键看机器 ID，右键进设置。'
Write-Host '  默认管理员密码 admin123，第一次进去请改掉。'
Write-Host ''
