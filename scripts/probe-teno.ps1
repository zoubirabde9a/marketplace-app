param(
    [string]$Url = 'https://teno-store.com/',
    [int]$TimeoutSec = 6,
    [string]$LogFile = "$env:USERPROFILE\teno-probe-bench.jsonl"
)

$ts = (Get-Date).ToUniversalTime().ToString('o')
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$status = $null
$err = $null
$bytes = $null
try {
    $resp = Invoke-WebRequest -Uri $Url -TimeoutSec $TimeoutSec -MaximumRedirection 5 -UseBasicParsing -ErrorAction Stop
    $status = [int]$resp.StatusCode
    $bytes = $resp.RawContentLength
} catch {
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    $err = $_.Exception.Message -replace "`r?`n", ' '
}
$sw.Stop()

$rec = [pscustomobject]@{
    ts          = $ts
    url         = $Url
    status      = $status
    duration_ms = [int]$sw.Elapsed.TotalMilliseconds
    bytes       = $bytes
    timeout_sec = $TimeoutSec
    error       = $err
} | ConvertTo-Json -Compress

Add-Content -Path $LogFile -Value $rec -Encoding utf8
Write-Output $rec
