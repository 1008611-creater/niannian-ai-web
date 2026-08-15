param(
  [Parameter(Mandatory = $true)]
  [string]$WorkbookPath,

  [Parameter(Mandatory = $true)]
  [string]$Email,

  [Parameter(Mandatory = $true)]
  [string]$Channel,

  [string]$SheetName = "账号表"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $WorkbookPath)) {
  throw "Workbook not found: $WorkbookPath"
}

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
  $wb = $excel.Workbooks.Open($WorkbookPath, 0, $false)

  try {
    $ws = $wb.Worksheets.Item($SheetName)
  } catch {
    $ws = $wb.Worksheets.Item(1)
  }

  $used = $ws.UsedRange
  $lastRow = $used.Rows.Count + $used.Row - 1
  $lastCol = $used.Columns.Count + $used.Column - 1

  $headers = @{}
  for ($col = 1; $col -le $lastCol; $col++) {
    $name = ([string]$ws.Cells.Item(1, $col).Text).Trim()
    if ($name) {
      $headers[$name] = $col
    }
  }

  $accountCol = $null
  if ($headers.ContainsKey("账号")) {
    $accountCol = $headers["账号"]
  } else {
    $accountCol = 1
  }

  if ($headers.ContainsKey($Channel)) {
    $channelCol = $headers[$Channel]
  } else {
    $channelCol = $lastCol + 1
    $ws.Cells.Item(1, $channelCol).Value2 = $Channel
  }

  $target = $Email.Trim().ToLowerInvariant()
  $updatedRow = $null

  for ($row = 2; $row -le $lastRow; $row++) {
    $raw = ([string]$ws.Cells.Item($row, $accountCol).Text).Trim()
    $current = (($raw -split "----")[0]).Trim().ToLowerInvariant()

    if ($current -eq $target) {
      $cell = $ws.Cells.Item($row, $channelCol)
      $cell.NumberFormat = "@"
      $cell.Value2 = "1"
      $updatedRow = $row
      break
    }
  }

  if ($null -eq $updatedRow) {
    throw "Email not found in workbook: $Email"
  }

  $sheetNameUsed = $ws.Name
  $wb.Save()
  $wb.Close($true)

  [pscustomobject]@{
    status = "updated"
    workbook = $WorkbookPath
    sheet = $sheetNameUsed
    row = $updatedRow
    channel = $Channel
  } | ConvertTo-Json -Depth 3
} finally {
  if ($wb) {
    try { $wb.Close($false) } catch {}
  }

  if ($excel) {
    $excel.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
  }
}
