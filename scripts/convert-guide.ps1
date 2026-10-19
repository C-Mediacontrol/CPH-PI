param(
    [string]$InputTextFile = "e:\copilot-web proxy\CPH-PI\docs\PowerShell-Agent-Guide.txt",
    [string]$OutputDocx = "e:\copilot-web proxy\CPH-PI\docs\PowerShell-Agent-Guide.docx",
    [string]$OutputPdf = "e:\copilot-web proxy\CPH-PI\docs\PowerShell-Agent-Guide.pdf"
)

$word = $null
try {
    Write-Output "Starting Word Automation..."
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0

    $doc = $word.Documents.Open($InputTextFile, $false, $true)
    
    # Save as DOCX (wdFormatXMLDocument = 16)
    Write-Output "Saving as DOCX: $OutputDocx"
    $doc.SaveAs2($OutputDocx, 16)
    
    # Save as PDF (wdFormatPDF = 17)
    Write-Output "Saving as PDF: $OutputPdf"
    $doc.SaveAs2($OutputPdf, 17)

    $doc.Close(0)
    Write-Output "Conversion completed successfully!"
} catch {
    Write-Output "Word conversion error: $($_.Exception.Message)"
} finally {
    if ($word -ne $null) {
        $word.Quit()
        [System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null
    }
}

