# MarsChat Components - 双远程推送脚本
# 用法: .\scripts\push-all.ps1 [-Message "commit message"]

param(
    [Parameter(Mandatory=$false)]
    [string]$Message = "chore: update components"
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path -Parent $PSScriptRoot

Set-Location $ROOT

# 检查是否有变更
$status = git status --porcelain
if ([string]::IsNullOrWhiteSpace($status)) {
    Write-Host "No changes to commit." -ForegroundColor Yellow
    exit 0
}

# 添加所有文件
Write-Host "Staging changes..." -ForegroundColor Cyan
git add -A

# 提交
Write-Host "Committing: $Message" -ForegroundColor Cyan
git commit -m $Message

# 推送到 Gitee
Write-Host "`nPushing to Gitee..." -ForegroundColor Yellow
git push gitee main

# 推送到 GitHub
Write-Host "Pushing to GitHub..." -ForegroundColor Yellow
git push github main

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  Pushed to both remotes successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
