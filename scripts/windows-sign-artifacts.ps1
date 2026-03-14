param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('full', 'tech', 'finance')]
  [string]$Variant,

  [string]$Thumbprint = $env:TAURI_BUNDLE_WINDOWS_CERTIFICATE_THUMBPRINT,
  [string]$CertPath = $env:TAURI_BUNDLE_WINDOWS_CERTIFICATE,
  [string]$CertPassword = $env:TAURI_BUNDLE_WINDOWS_CERTIFICATE_PASSWORD,
  [string]$TimestampUrl = $env:TAURI_BUNDLE_WINDOWS_TIMESTAMP_URL
)

$ErrorActionPreference = 'Stop'

function Resolve-SigningCertificate {
  param(
    [string]$ThumbprintInput,
    [string]$CertFilePath,
    [string]$CertFilePassword
  )

  if ($ThumbprintInput) {
    $normalized = ($ThumbprintInput -replace '\s', '').ToUpperInvariant()
    $stores = @('Cert:\CurrentUser\My', 'Cert:\LocalMachine\My')
    foreach ($store in $stores) {
      $found = Get-ChildItem -Path $store -ErrorAction SilentlyContinue |
        Where-Object { $_.Thumbprint -eq $normalized } |
        Select-Object -First 1
      if ($found) {
        return $found
      }
    }
    throw "Signing certificate thumbprint not found in CurrentUser/My or LocalMachine/My: $normalized"
  }

  if ($CertFilePath) {
    if (-not (Test-Path -LiteralPath $CertFilePath)) {
      throw "Certificate file not found: $CertFilePath"
    }
    if (-not $CertFilePassword) {
      throw 'TAURI_BUNDLE_WINDOWS_CERTIFICATE_PASSWORD is required when TAURI_BUNDLE_WINDOWS_CERTIFICATE is used.'
    }
    $securePassword = ConvertTo-SecureString -String $CertFilePassword -AsPlainText -Force
    $flags = [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable
    return [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($CertFilePath, $securePassword, $flags)
  }

  throw 'No signing certificate configured. Set TAURI_BUNDLE_WINDOWS_CERTIFICATE_THUMBPRINT or TAURI_BUNDLE_WINDOWS_CERTIFICATE + TAURI_BUNDLE_WINDOWS_CERTIFICATE_PASSWORD.'
}

function Sign-File {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)]$Certificate,
    [string]$TimestampServer
  )

  if ($TimestampServer) {
    try {
      Set-AuthenticodeSignature -FilePath $FilePath -Certificate $Certificate -HashAlgorithm SHA256 -TimestampServer $TimestampServer | Out-Null
    } catch {
      Write-Warning "Timestamp signing failed for '$FilePath' with server '$TimestampServer'. Retrying without timestamp. Error: $($_.Exception.Message)"
      Set-AuthenticodeSignature -FilePath $FilePath -Certificate $Certificate -HashAlgorithm SHA256 | Out-Null
    }
  } else {
    Set-AuthenticodeSignature -FilePath $FilePath -Certificate $Certificate -HashAlgorithm SHA256 | Out-Null
  }

  $sig = Get-AuthenticodeSignature -FilePath $FilePath
  if ($sig.Status -ne 'Valid') {
    throw "Signature validation failed for $FilePath. Status=$($sig.Status), Message=$($sig.StatusMessage)"
  }
}

switch ($Variant) {
  'full' {
    $productName = 'World Monitor'
    $binaryName = 'world-monitor.exe'
  }
  'tech' {
    $productName = 'Tech Monitor'
    $binaryName = 'tech-monitor.exe'
  }
  'finance' {
    $productName = 'Finance Monitor'
    $binaryName = 'finance-monitor.exe'
  }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$releaseDir = Join-Path $repoRoot 'src-tauri\target\release'

$binaryPath = Join-Path $releaseDir $binaryName
if (-not (Test-Path -LiteralPath $binaryPath)) {
  throw "Binary not found: $binaryPath"
}

$nsisPattern = Join-Path $releaseDir ("bundle\nsis\{0}_*_x64-setup.exe" -f $productName)
$msiPattern = Join-Path $releaseDir ("bundle\msi\{0}_*_x64_en-US.msi" -f $productName)

$nsisPath = Get-ChildItem -Path $nsisPattern -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 -ExpandProperty FullName

$msiPath = Get-ChildItem -Path $msiPattern -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 -ExpandProperty FullName

$targets = @($binaryPath)
if ($nsisPath) { $targets += $nsisPath }
if ($msiPath) { $targets += $msiPath }

$certificate = Resolve-SigningCertificate -ThumbprintInput $Thumbprint -CertFilePath $CertPath -CertFilePassword $CertPassword

Write-Output "[windows-sign] Variant=$Variant"
Write-Output "[windows-sign] Targets:"
$targets | ForEach-Object { Write-Output "  - $_" }
$timestampLabel = if ([string]::IsNullOrWhiteSpace($TimestampUrl)) { '(none)' } else { $TimestampUrl }
Write-Output "[windows-sign] Timestamp=$timestampLabel"

foreach ($target in $targets) {
  Sign-File -FilePath $target -Certificate $certificate -TimestampServer $TimestampUrl
}

Write-Output '[windows-sign] All targets signed and verified.'
