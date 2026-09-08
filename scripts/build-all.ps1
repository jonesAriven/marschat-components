# MarsChat Components - 全量构建脚本
# 用法: .\scripts\build-all.ps1 [-SkipJava] [-SkipNpm]

param(
    [switch]$SkipJava,
    [switch]$SkipNpm
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path -Parent $PSScriptRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  MarsChat Components Build" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# === 前端 npm 包构建 ===
if (-not $SkipNpm) {
    Write-Host "`n[1/2] Building npm packages..." -ForegroundColor Yellow
    
    # 安装依赖
    Set-Location $ROOT
    pnpm install --frozen-lockfile 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "pnpm install failed, trying without --frozen-lockfile..."
        pnpm install
    }
    
    # 构建所有包
    foreach ($pkg in @("auth-components", "frontend-common")) {
        $pkgPath = Join-Path $ROOT "packages\$pkg"
        if (Test-Path $pkgPath) {
            Write-Host "  Building $pkg..." -ForegroundColor Green
            Set-Location $pkgPath
            pnpm run build
            Set-Location $ROOT
        }
    }
}

# === Java Maven 包构建 ===
if (-not $SkipJava) {
    Write-Host "`n[2/2] Building Java packages (Maven)..." -ForegroundColor Yellow
    
    $javaDir = Join-Path $ROOT "java"
    foreach ($module in @("common-core", "auth-core")) {
        $modPath = Join-Path $javaDir $module
        if (Test-Path $modPath) {
            Write-Host "  Building $module..." -ForegroundColor Green
            Set-Location $modPath
            mvn clean install -DskipTests -q
            Set-Location $javaDir
        }
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Build Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
