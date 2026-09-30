# One-command rebuild of the 10/13 review manual: assemble chapters into a staging
# DOCX, then let Word refresh indexes and export DOCX + PDF (see refresh_manual_word.ps1).
# Takes roughly 10-15 minutes. Close the manual in Word before running.
#   powershell -ExecutionPolicy Bypass -File rebuild_review_manual.ps1 [-Python <python.exe>] [-Log <file>]
param(
    [string] $Python = 'python',
    [string] $Log = '',
    [int] $PdfTimeoutSec = 600
)
$ErrorActionPreference = 'Stop'
$env:PYTHONIOENCODING = 'utf-8'
$tools = $PSScriptRoot
$output = Join-Path (Split-Path $tools) 'output'
$name = '四技第115413組-FocusFlow AI-系統手冊_1013複評全冊整合稿'
$stage = Join-Path ([IO.Path]::GetTempPath()) ('focusflow_stage_' + [guid]::NewGuid() + '.docx')

function Say($text) {
    $line = (Get-Date).ToString('HH:mm:ss') + ' ' + $text
    Write-Output $line
    if ($Log) { Add-Content -Path $Log -Value $line -Encoding utf8 }
}

try {
    Say 'assembling chapters'
    Push-Location $tools
    try { & $Python assemble_review_manual.py $stage | ForEach-Object { Say $_ } } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw 'assemble_review_manual.py failed' }
    Say 'refreshing in Word'
    & (Join-Path $tools 'refresh_manual_word.ps1') -Source $stage `
        -OutDocx (Join-Path $output "$name.docx") -OutPdf (Join-Path $output "${name}_預覽.pdf") `
        -PdfTimeoutSec $PdfTimeoutSec |
        ForEach-Object { Say $_ }
    Say 'DONE'
} catch {
    Say ('FAILED: ' + $_.Exception.Message)
    throw
} finally {
    Remove-Item $stage -ErrorAction SilentlyContinue
}
