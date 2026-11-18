# Runs on the VM as SYSTEM, through deploy.ps1's run command. Safe to run again: each step skips what is done.
#   1. the VektorNode fork's Rhino.Compute build ($ComputeBranch), placed before the bootstrap so it skips McNeel's
#   2. compute.rhino3d's bootstrap.ps1: Rhino, IIS, hosting bundle, RhinoComputeUser, the IIS site on port 80
#   3. plugins.json: Yak packages and local plugin files, into RhinoComputeUser's profile, where compute's Rhino loads them
#   4. a Let's Encrypt certificate for $Domain through win-acme, renewed by its scheduled task
param (
    [Parameter(Mandatory = $true)][string] $BlobBase,
    [Parameter(Mandatory = $true)][string] $SasToken,
    [Parameter(Mandatory = $true)][string] $RhinoToken,
    [Parameter(Mandatory = $true)][string] $ApiKey,
    [Parameter(Mandatory = $true)][string] $EmailAddress,
    [string] $Domain,
    [string] $ComputeBranch = "8.x.selva",
    [string] $BootstrapBranch = "9.x.selva"
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$rhinoMajor = "8"
$repo = "VektorNode/compute.rhino3d"
$installPath = "C:\Rhino-Compute-Installation"
$work = "$installPath\Selva"
$computeRoot = "C:\inetpub\wwwroot\aspnet_client\system_web\4_0_30319"
$computeMarker = "$work\compute-artifact.txt"
$userName = "RhinoComputeUser"
# Pinned to a release more than two weeks old; v2.4 changed its command line.
$winAcmeUrl = "https://github.com/win-acme/win-acme/releases/download/v2.2.9.1701/win-acme.v2.2.9.1701.x64.trimmed.zip"

function Write-Step { Write-Output ""; Write-Output "===> $($args[0])" }
function Get-Blob {
    param ([string] $name, [string] $output)
    Invoke-WebRequest -UseBasicParsing -Uri "$BlobBase/$name`?$SasToken" -OutFile $output
}

New-Item -ItemType Directory -Force -Path $work | Out-Null

# ============================================================================
# Rhino.Compute from the fork
# ============================================================================

Write-Step "Rhino.Compute: latest $ComputeBranch build of $repo"
$artifact = (Invoke-RestMethod "https://api.github.com/repos/$repo/actions/artifacts?name=rhino.compute&per_page=100").artifacts |
    Where-Object { -not $_.expired -and $_.workflow_run.head_branch -eq $ComputeBranch } | Select-Object -First 1
if (-not $artifact) { throw "No current $ComputeBranch build of $repo (GitHub keeps them 90 days): push to the branch to rebuild." }
$installed = if (Test-Path $computeMarker) { (Get-Content $computeMarker -Raw).Trim() } else { "" }
if ($installed -eq "$($artifact.id)") {
    Write-Output "Build $($artifact.id) is already installed"
} else {
    Write-Output "Build $($artifact.id), commit $($artifact.workflow_run.head_sha.Substring(0, 7)), built $($artifact.created_at)"
    $zip = "$work\compute.zip"
    Invoke-WebRequest -UseBasicParsing -Uri "https://nightly.link/$repo/actions/artifacts/$($artifact.id).zip" -OutFile $zip
    if ($artifact.digest -and ("sha256:" + (Get-FileHash $zip -Algorithm SHA256).Hash) -ne $artifact.digest) {
        throw "The downloaded build doesn't match GitHub's checksum for build $($artifact.id)."
    }
    # Unset until the bootstrap has installed IIS.
    $iis = Get-Service W3SVC -ErrorAction SilentlyContinue
    if ($iis) { Stop-Service W3SVC -Force }
    New-Item -ItemType Directory -Force -Path $computeRoot | Out-Null
    foreach ($folder in "rhino.compute", "compute.geometry") {
        if (Test-Path "$computeRoot\$folder") { Remove-Item -Recurse -Force "$computeRoot\$folder" }
    }
    Expand-Archive $zip -DestinationPath $computeRoot
    Remove-Item $zip
    if (-not (Test-Path "$computeRoot\rhino.compute\rhino.compute.exe")) { throw "The $ComputeBranch build has no rhino.compute\rhino.compute.exe." }
    # A fresh copy loses the app pool's grant; the bootstrap only sets it when it creates the site.
    if ($iis) {
        foreach ($folder in "rhino.compute", "compute.geometry") {
            icacls "$computeRoot\$folder" /grant "IIS AppPool\RhinoComputeAppPool:(OI)(CI)M" /t /c /q | Out-Null
        }
        Start-Service W3SVC
    }
    Set-Content $computeMarker "$($artifact.id)"
}

# ============================================================================
# Bootstrap
# ============================================================================

Write-Step "Bootstrap from $repo@$BootstrapBranch"
$bootstrap = "$work\bootstrap.ps1"
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/$repo/$BootstrapBranch/script/deploy/bootstrap.ps1" -OutFile $bootstrap
# The run command's output is kept in the VM's instance view: drop the RhinoComputeUser password the bootstrap prints.
$global:LASTEXITCODE = 0
& $bootstrap -RhinoVersion $rhinoMajor -EmailAddress $EmailAddress -ApiKey $ApiKey -RhinoToken $RhinoToken -SkipHopsInstall *>&1 |
    ForEach-Object { "$_" } | Where-Object { $_ -notmatch '^\s*Password:' }
if ($LASTEXITCODE -ne 0) { throw "The bootstrap failed; its log is $installPath\bootstrap_log.txt." }

# ============================================================================
# Plugins
# ============================================================================

# Dot-sourcing loads the bootstrap's functions without running it; New-UserProfile creates the profile headlessly.
# In a child scope: the bootstrap's params would reset $EmailAddress, $ApiKey and $RhinoToken here.
$userProfile = & { param ($script, $user) . $script; New-UserProfile $user } $bootstrap $userName
$packagesPath = "$userProfile\AppData\Roaming\McNeel\Rhinoceros\packages\$rhinoMajor.0"
$librariesPath = "$userProfile\AppData\Roaming\Grasshopper\Libraries"
$rhino = [Version](Get-ItemProperty "HKLM:\SOFTWARE\McNeel\Rhinoceros\$rhinoMajor.0\Install" -Name Version).Version

Get-Blob "plugins.json" "$work\plugins.json"
$plugins = Get-Content "$work\plugins.json" -Raw | ConvertFrom-Json

# Rank of a distribution this Rhino can load, higher is better, or -1. rh8_21 needs 8.21+; rh7_0 still loads in 8.
function Get-DistributionRank {
    param ($distribution)
    if ($distribution.platform -notin "win", "any") { return -1 }
    $platformBonus = if ($distribution.platform -eq "win") { 1 } else { 0 }
    if ($distribution.rhino_version -eq "any") { return $platformBonus }
    if ($distribution.rhino_version -notmatch '^rh(\d+)_(\d+)$') { return -1 }
    $major = [int]$Matches[1]; $minor = [int]$Matches[2]
    if ($major -gt $rhino.Major -or ($major -eq $rhino.Major -and $minor -gt $rhino.Minor)) { return -1 }
    return $major * 10000 + $minor * 10 + $platformBonus + 10
}

Write-Step "Yak packages for $userName (Rhino $rhino)"
foreach ($package in $plugins.yak) {
    $folder = "$packagesPath\$($package.name)"
    $manifest = "$folder\manifest.txt"
    if ((Test-Path $manifest) -and (Get-Content $manifest -Raw).Trim() -eq $package.version) {
        Write-Output "$($package.name) $($package.version) is already installed"
        continue
    }
    $release = (Invoke-RestMethod "https://yak.rhino3d.com/versions/$($package.name)") | Where-Object { $_.version -eq $package.version }
    if (-not $release) { throw "Yak has no $($package.name) $($package.version)." }
    $distribution = $release.distributions | Sort-Object { Get-DistributionRank $_ } -Descending | Select-Object -First 1
    if ((Get-DistributionRank $distribution) -lt 0) { throw "$($package.name) $($package.version) has no build for Rhino $rhino on Windows." }
    if (Test-Path $folder) { Remove-Item -Recurse -Force $folder }
    $target = "$folder\$($package.version)"
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    # Expand-Archive only takes .zip; a .yak is a zip.
    $zip = "$work\$($package.name).zip"
    Invoke-WebRequest -UseBasicParsing -Uri $distribution.url -OutFile $zip
    Expand-Archive $zip -DestinationPath $target
    Remove-Item $zip
    [System.IO.File]::WriteAllText($manifest, "$($package.version)`n")
    Write-Output "Installed $($package.name) $($package.version) ($($distribution.rhino_version)/$($distribution.platform))"
}

if (@($plugins.local).Count -gt 0) {
    Write-Step "Local plugins into $librariesPath"
    Get-Blob "local-plugins.zip" "$work\local-plugins.zip"
    New-Item -ItemType Directory -Force -Path $librariesPath | Out-Null
    Expand-Archive "$work\local-plugins.zip" -DestinationPath $librariesPath -Force
    Remove-Item "$work\local-plugins.zip"
    Get-ChildItem $librariesPath | ForEach-Object { Write-Output $_.Name }
}

# ============================================================================
# HTTPS
# ============================================================================

if ($Domain) {
    Write-Step "Let's Encrypt certificate for $Domain"
    $wacs = "$work\win-acme\wacs.exe"
    if (-not (Test-Path $wacs)) {
        Invoke-WebRequest -UseBasicParsing -Uri $winAcmeUrl -OutFile "$work\win-acme.zip"
        Expand-Archive "$work\win-acme.zip" -DestinationPath "$work\win-acme"
        Remove-Item "$work\win-acme.zip"
    }
    New-NetFirewallRule -DisplayName "HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow -ErrorAction SilentlyContinue | Out-Null
    # Self-hosting validation answers the challenge through http.sys beside IIS: rhino.compute's handler
    # would swallow a challenge file in the site's folder. A second run renews only when due.
    & $wacs --source manual --host $Domain --validation selfhosting --installation iis --installationsiteid 2 `
        --accepttos --emailaddress $EmailAddress --closeonfinish
    if ($LASTEXITCODE -ne 0) { throw "win-acme couldn't get a certificate for $Domain (exit code $LASTEXITCODE)." }
}

Write-Step "Done. Restart the VM so Rhino.Compute starts with the new plugins."
