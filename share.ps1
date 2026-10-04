# 为了明日 · 打包分享脚本（由 打包分享.bat 调用）
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$stage = Join-Path $env:TEMP 'fortomorrow-share'
$desktop = [Environment]::GetFolderPath('Desktop')
$zip = Join-Path $desktop '为了明日-分享包.zip'

Write-Output '正在整理文件（不含你的个人数据）...'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

# 复制项目（排除 node_modules、个人数据 data、git）
robocopy $project $stage /E /XD node_modules data .git /XF 打包分享.bat share.ps1 使用说明.txt | Out-Null
if ($LASTEXITCODE -ge 8) { throw '复制文件失败' }

# 附上接收方说明
Copy-Item (Join-Path $project '使用说明-接收方.txt') (Join-Path $stage '使用说明.txt') -Force

Write-Output '正在压缩到桌面...'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
Remove-Item $stage -Recurse -Force

$size = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Output ''
Write-Output "完成！分享包在桌面：为了明日-分享包.zip（$size MB）"
Write-Output ''
Write-Output '发给朋友后，对方只需要：'
Write-Output '  1. 安装 Node.js（nodejs.org，一路下一步）'
Write-Output '  2. 解压压缩包'
Write-Output '  3. 双击 启动学习助手.bat'
Write-Output '对方的数据保存在对方电脑里，与你的互不影响。'
