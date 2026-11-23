param(
    [Parameter(Mandatory)][string]$Serial,
    [Parameter(Mandatory)][string]$Output
)

$ErrorActionPreference = 'Stop'
function Read-Shell([string[]]$Command) {
    $value = (& adb -s $Serial shell @Command) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'ADB observation failed. Check the device connection.' }
    $value.Trim()
}

$properties = [ordered]@{
    'system.patch' = 'ro.build.version.security_patch'
    'system.vendorSpl' = 'ro.vendor.build.security_patch'
    'environment.verifiedBoot' = 'ro.boot.verifiedbootstate'
    'environment.flashLock' = 'ro.boot.flash.locked'
}
$started = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$model = Read-Shell @('getprop', 'ro.product.model')
if (!$model) { throw 'ADB did not report a device model.' }
$readings = [ordered]@{}
foreach ($field in $properties.Keys) {
    $value = Read-Shell @('getprop', $properties[$field])
    $readings[$field] = if ($value) { $value } else { $null }
}
$mode = Read-Shell @('getenforce')
$readings['system.selinux'] = if ($mode -cin @('Enforcing','Permissive','Disabled')) { $mode } else { $null }
$document = [ordered]@{
    schema = 'sigmark-adb-evidence/1'
    observedAtEpochMs = $started
    model = $model
    readings = $readings
}
$target = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Output)
if (Test-Path -LiteralPath $target) { throw 'Output already exists. Choose a new output filename.' }
$document | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $target -Encoding utf8NoBOM
