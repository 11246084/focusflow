# Refresh TOC / figure / table indexes and page numbers with Microsoft Word, then export PDF.
# Used after assemble_review_manual.py. Works on a temp copy with w:updateFields removed so
# Word opens it without the update-fields prompt; the saved DOCX no longer carries the flag.
param(
    [Parameter(Mandatory)] [string] $Source,
    [Parameter(Mandatory)] [string] $OutDocx,
    [Parameter(Mandatory)] [string] $OutPdf
)
$ErrorActionPreference = 'Stop'
$Source = (Resolve-Path $Source).Path
$OutDocx = [IO.Path]::GetFullPath($OutDocx)
$OutPdf = [IO.Path]::GetFullPath($OutPdf)

$staged = Join-Path ([IO.Path]::GetTempPath()) ('focusflow_manual_' + [guid]::NewGuid() + '.docx')
Copy-Item $Source $staged
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open($staged, 'Update')
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

$word = New-Object -ComObject Word.Application
try {
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $doc = $word.Documents.Open($staged, $false, $false, $false)
    try {
        # Two passes: the first refresh changes index length, which shifts page numbers.
        for ($pass = 1; $pass -le 2; $pass++) {
            $doc.Repaginate()
            foreach ($toc in $doc.TablesOfContents) { [void]$toc.Update() }
            foreach ($tof in $doc.TablesOfFigures) { [void]$tof.Update() }
            [void]$doc.Fields.Update()
        }
        Write-Output ('pages: ' + $doc.ComputeStatistics(2))
        $doc.SaveAs2($OutDocx, 16)
        # 17 = wdExportFormatPDF; 1 = wdExportCreateHeadingBookmarks
        $doc.ExportAsFixedFormat($OutPdf, 17, $false, 0, 0, 1, 1, 0, $true, $true, 1, $true, $true, $false)
        Write-Output "saved: $OutDocx"
        Write-Output "saved: $OutPdf"
    } finally {
        $doc.Close(0)
    }
} finally {
    $word.Quit()
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
    Remove-Item $staged -ErrorAction SilentlyContinue
}
