param(
    [Parameter(Mandatory)][string]$Serial,
    [Parameter(Mandatory)][string]$Output
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
# Optional readings: a denied node or missing property is an explicit null.
function Read-ShellOptional([string[]]$Command) {
    $value = (& adb -s $Serial shell @Command) -join "`n"
    if ($LASTEXITCODE -ne 0) { return $null }
    $value.Trim()
}

$properties = [ordered]@{
    'system.patch' = @('ro.build.version.security_patch', '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    'system.vendorSpl' = @('ro.vendor.build.security_patch', '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
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
    'system.device' = @('ro.product.device', '^[A-Za-z0-9._-]{1,80}$')
    'system.initialSdk' = @('ro.product.first_api_level', '^[1-9][0-9]?$')
}
$connection = & adb -s $Serial get-state
if ($LASTEXITCODE -ne 0 -or $connection -cne 'device') { throw 'Select a connected ADB test device.' }
$started = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$model = Read-ShellOptional @('getprop', 'ro.product.model')
if (!$model -or $model.Length -gt 100 -or $model -match '^(unknown|null)$|[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]') {
    $model = $null
}
$readings = [ordered]@{}
foreach ($field in $properties.Keys) {
    $spec = $properties[$field]
    $value = Read-ShellOptional @('getprop', $spec[0])
    # "unknown"/"null" are placeholders, not readings (the App normalizes them away).
    $readings[$field] = if ($value -and $value -cmatch $spec[1] -and $value -notmatch '^(unknown|null)$') { $value } else { $null }
}
$mode = Read-ShellOptional @('getenforce')
$readings['system.selinux'] = if ($mode -cin @('Enforcing','Permissive','Disabled')) { $mode } else { $null }
$battery = Read-ShellOptional @('dumpsys', 'battery')
$batteryLimits = @{ temperature = @(-500, 1200); voltage = @(1000, 15000) }
foreach ($field in $batteryLimits.Keys) {
    $readings["battery.$field"] = $null
    if ($battery -and $battery -notmatch 'UPDATES STOPPED') {
        $matchesForField = [regex]::Matches($battery, '(?m)^\s*' + $field + ':\s*(-?[0-9]{1,5})\s*$')
        if ($matchesForField.Count -eq 1) {
            $number = [int]$matchesForField[0].Groups[1].Value
            $bounds = $batteryLimits[$field]
            if ($number -ge $bounds[0] -and $number -le $bounds[1]) {
                $readings["battery.$field"] = [string]$number
            }
        }
    }
}
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
    schema = 'sigmark-adb-evidence/6'
    observer = 'ADB_SHELL'
    observedAtEpochMs = $started
    model = $model
    readings = $readings
}
$target = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Output)
if (Test-Path -LiteralPath $target) { throw 'Output already exists. Choose a new output filename.' }
$document | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $target -Encoding utf8NoBOM
