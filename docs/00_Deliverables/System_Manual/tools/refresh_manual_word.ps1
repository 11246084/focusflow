# Refresh TOC / figure / table indexes and page numbers with Microsoft Word, then export PDF.
# Used after assemble_review_manual.py.
#
# Word only ever saves the working copy in place (Documents.Open + Save). On 2026-09-30
# every call that writes to a named file (SaveAs2, ExportAsFixedFormat, PrintOut to file)
# hung on the build machine while in-place Save kept working, so the DOCX no longer
# depends on those calls. The PDF export still needs one; it runs in a child process with
# a time limit and is skipped (with a warning) when it does not finish.
param(
    [Parameter(Mandatory)] [string] $Source,
    [Parameter(Mandatory)] [string] $OutDocx,
    [Parameter(Mandatory)] [string] $OutPdf,
    [int] $PdfTimeoutSec = 600
)
$ErrorActionPreference = 'Stop'
$Source = (Resolve-Path $Source).Path
$OutDocx = [IO.Path]::GetFullPath($OutDocx)
$OutPdf = [IO.Path]::GetFullPath($OutPdf)

# Working copy next to the final file; the delivered DOCX is replaced only at the end,
# so nobody can open a half-written manual.
$token = [guid]::NewGuid()
$work = Join-Path (Split-Path $OutDocx) ("_building_$token.docx")
$workPdf = Join-Path (Split-Path $OutPdf) ("_building_$token.pdf")
Copy-Item $Source $work

# Drop w:updateFields so Word opens the file without the update-fields prompt.
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open($work, 'Update')
try {
    $entry = $zip.GetEntry('word/settings.xml')
    $reader = New-Object IO.StreamReader($entry.Open())
    $xml = $reader.ReadToEnd()
    $reader.Close()
    $entry.Delete()
    $writer = New-Object IO.StreamWriter($zip.CreateEntry('word/settings.xml').Open(), (New-Object Text.UTF8Encoding $false))
    $writer.Write(($xml -replace '<w:updateFields[^>]*/>', ''))
    $writer.Close()
} finally {
    $zip.Dispose()
}

function Update-Indexes($doc) {
    # Two passes: the first refresh changes index length, which shifts page numbers.
    for ($pass = 1; $pass -le 2; $pass++) {
        $doc.Repaginate()
        foreach ($toc in $doc.TablesOfContents) { [void]$toc.Update() }
        foreach ($tof in $doc.TablesOfFigures) { [void]$tof.Update() }
        [void]$doc.Fields.Update()
    }
    $doc.Repaginate()
    return $doc.ComputeStatistics(2)
}

$word = New-Object -ComObject Word.Application
try {
    $word.Visible = $false
    $word.DisplayAlerts = 0
    # Round 1: lay out the generated file, refresh indexes, save in place.
    $doc = $word.Documents.Open($work, $false, $false, $false)
    try {
        Write-Output 'round 1: opened'
        Write-Output ('round 1 pages: ' + (Update-Indexes $doc))
        $doc.Save()
        Write-Output 'round 1: saved'
    } finally {
        $doc.Close(0)
    }
    # Round 2: Word adds settings on save (e.g. East Asian line breaking) that change the
    # layout when the file is reopened. Reopen and refresh the indexes in that final
    # layout so the TOC page numbers match what readers see in Word.
    $doc = $word.Documents.Open($work, $false, $false, $false)
    try {
        Write-Output 'round 2: reopened'
        $pages = Update-Indexes $doc
        $doc.Save()
        Write-Output ("round 2 pages: $pages (saved)")
    } finally {
        $doc.Close(0)
    }
} finally {
    $word.Quit()
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
Move-Item $work $OutDocx -Force
Write-Output "saved: $OutDocx"

# PDF export in a child process with a time limit.
$export = @"
`$w = New-Object -ComObject Word.Application
`$w.Visible = `$false; `$w.DisplayAlerts = 0
`$d = `$w.Documents.Open('$($OutDocx -replace "'", "''")', `$false, `$true, `$false)
`$d.Repaginate()
`$d.ExportAsFixedFormat('$($workPdf -replace "'", "''")', 17, `$false, 0, 0, 1, 1, 0, `$true, `$true, 1, `$true, `$true, `$false)
`$d.Close(0); `$w.Quit()
"@
$exportScript = Join-Path ([IO.Path]::GetTempPath()) ("focusflow_pdf_$token.ps1")
Set-Content $exportScript $export -Encoding UTF8
$started = Get-Date
$child = Start-Process powershell -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$exportScript`"") -WindowStyle Hidden -PassThru
if ($child.WaitForExit($PdfTimeoutSec * 1000) -and (Test-Path $workPdf)) {
    Move-Item $workPdf $OutPdf -Force
    Write-Output "saved: $OutPdf"
} else {
    if (-not $child.HasExited) { $child.Kill() }
    # Stop only the automation Word started for this export.
    Get-CimInstance Win32_Process -Filter "Name='WINWORD.EXE'" |
        Where-Object { $_.CommandLine -match 'Automation' -and $_.CreationDate -ge $started } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Remove-Item $workPdf -ErrorAction SilentlyContinue
    Write-Output "WARNING: PDF export did not finish within $PdfTimeoutSec s; PDF not updated."
}
Remove-Item $exportScript -ErrorAction SilentlyContinue
