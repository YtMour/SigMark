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
# Optional readings: a denied node or missing property is an explicit null.
function Read-ShellOptional([string[]]$Command) {
    $value = (& adb -s $Serial shell @Command) -join "`n"
    if ($LASTEXITCODE -ne 0) { return $null }
    $value.Trim()
}

$properties = [ordered]@{
    'system.patch' = @('ro.build.version.security_patch', '^\d{4}-\d{2}-\d{2}$')
    'system.vendorSpl' = @('ro.vendor.build.security_patch', '^\d{4}-\d{2}-\d{2}$')
    'environment.verifiedBoot' = @('ro.boot.verifiedbootstate', '^(green|yellow|orange|red)$')
    'environment.flashLock' = @('ro.boot.flash.locked', '^(0|1)$')
    'environment.vbmetaState' = @('ro.boot.vbmeta.device_state', '^(locked|unlocked)$')
    # Shell-domain readings for the field-set-17 keys the app is often refused.
    'system.bootloader' = @('ro.bootloader', '^[A-Za-z0-9._+\- ]{1,80}$')
    'environment.verityMode' = @('ro.boot.veritymode', '^[a-z0-9_.-]{1,32}$')
    'environment.buildDebuggable' = @('ro.debuggable', '^(0|1)$')
    'system.boardPlatform' = @('ro.board.platform', '^[a-z0-9_.-]{1,32}$')
    'system.bootHardware' = @('ro.boot.hardware', '^[a-z0-9_.-]{1,32}$')
    'system.hardwareSku' = @('ro.boot.hardware.sku', '^[A-Za-z0-9._-]{1,32}$')
}
$started = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$model = Read-Shell @('getprop', 'ro.product.model')
if (!$model) { throw 'ADB did not report a device model.' }
$readings = [ordered]@{}
foreach ($field in $properties.Keys) {
    $spec = $properties[$field]
    $value = Read-ShellOptional @('getprop', $spec[0])
    # "unknown"/"null" are placeholders, not readings (the App normalizes them away).
    $readings[$field] = if ($value -and $value -match $spec[1] -and $value -notmatch '^(?i)(unknown|null)$') { $value } else { $null }
}
$mode = Read-Shell @('getenforce')
$readings['system.selinux'] = if ($mode -cin @('Enforcing','Permissive','Disabled')) { $mode } else { $null }
# Power-supply node: 0.1 °C. The app is denied this node; shell may or may not read it.
$readings['battery.sysBatteryTemp'] = $null
foreach ($node in @('/sys/class/power_supply/battery/temp', '/sys/class/power_supply/bms/temp')) {
    $raw = Read-ShellOptional @('cat', $node)
    if ($raw -and $raw -match '^(0|-?[1-9][0-9]{0,3})$') {
        $tenths = [int]$raw
        if ($tenths -ge -500 -and $tenths -le 1200) { $readings['battery.sysBatteryTemp'] = "$tenths"; break }
    }
}
$document = [ordered]@{
    schema = 'sigmark-adb-evidence/4'
    observer = 'ADB_SHELL'
    observedAtEpochMs = $started
    model = $model
    readings = $readings
}
$target = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Output)
if (Test-Path -LiteralPath $target) { throw 'Output already exists. Choose a new output filename.' }
$document | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $target -Encoding utf8NoBOM
