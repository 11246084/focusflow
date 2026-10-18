# 一鍵重建系統手冊：build_manual.py 把 chapters/*.md 組成暫存 DOCX，
# 再由 refresh_manual_word.ps1 讓 Word 更新目錄、圖表目錄與頁碼並匯出 DOCX + PDF。
# 約需 10～15 分鐘；執行前先關閉 Word 裡開著的手冊。
#   powershell -ExecutionPolicy Bypass -File rebuild_manual.ps1 [-Python python] [-CoverDate 115年12月29日] [-Log <file>]
param(
    [string] $Python = 'python',
    [string] $CoverDate = '',
    [string] $Log = '',
    [int] $PdfTimeoutSec = 600
)
$ErrorActionPreference = 'Stop'
$env:PYTHONIOENCODING = 'utf-8'
$tools = $PSScriptRoot
$output = Join-Path (Split-Path $tools) 'output'
$name = '四技第115413組-FocusFlow AI-系統手冊'
$stage = Join-Path ([IO.Path]::GetTempPath()) ('focusflow_stage_' + [guid]::NewGuid() + '.docx')

function Say($text) {
    $line = (Get-Date).ToString('HH:mm:ss') + ' ' + $text
    Write-Output $line
    if ($Log) { Add-Content -Path $Log -Value $line -Encoding utf8 }
}

try {
    Say 'building manual'
    $buildArgs = @('build_manual.py', $stage)
    if ($CoverDate) { $buildArgs += @('--cover-date', $CoverDate) }
    Push-Location $tools
    try { & $Python @buildArgs | ForEach-Object { Say $_ } } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw 'build_manual.py failed' }
    Say 'refreshing in Word'
    & (Join-Path $tools 'refresh_manual_word.ps1') -Source $stage `
        -OutDocx (Join-Path $output "$name.docx") -OutPdf (Join-Path $output "$name.pdf") `
        -PdfTimeoutSec $PdfTimeoutSec -PagesJson (Join-Path (Split-Path $tools) 'review/chapter_pages.json') |
        ForEach-Object { Say $_ }
    Say 'DONE'
} catch {
    Say ('FAILED: ' + $_.Exception.Message)
    throw
} finally {
    Remove-Item $stage -ErrorAction SilentlyContinue
}
