# Sets up or updates the Windows Compute server from this machine: uploads setup.ps1, plugins.json and the local
# plugin files to the VM's storage account, runs setup.ps1 on the VM, then restarts it. Run again after
# changing plugins.json or pushing the fork's compute branch.
#   pwsh infra/compute/azure/deploy.ps1 [-SkipRestart]
param ([switch] $SkipRestart)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot

# ============================================================================
# Settings
# ============================================================================

$envFile = "$here\.env"
if (-not (Test-Path $envFile)) { throw "Copy .env.example to .env and fill it in." }
$settings = @{}
foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*?)\s*$') { $settings[$Matches[1]] = $Matches[2] }
}
foreach ($required in "RHINO_TOKEN", "RHINO_COMPUTE_KEY", "EMAIL_ADDRESS") {
    if (-not $settings[$required]) { throw "$required is empty in $envFile." }
}
if (-not (Test-Path "$here\plugins.json")) { throw "Copy plugins.example.json to plugins.json and list this server's plugins." }

Push-Location $here
try { $tf = terraform output -json | ConvertFrom-Json }
finally { Pop-Location }
if (-not $tf.vm_name) { throw "No Terraform outputs: run terraform apply in $here first." }
$rg = $tf.resource_group.value
$vm = $tf.vm_name.value
$account = $tf.storage_account.value
$domain = if ($tf.compute_url.value -like "https://*") { $tf.fqdn.value } else { "" }

# ============================================================================
# Upload
# ============================================================================

$staging = Join-Path ([System.IO.Path]::GetTempPath()) "selva-compute-azure"
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Path $staging | Out-Null
Copy-Item "$here\setup.ps1", "$here\plugins.json" $staging

$plugins = Get-Content "$here\plugins.json" -Raw | ConvertFrom-Json
$local = @($plugins.local)
if ($local.Count -gt 0) {
    $libraries = New-Item -ItemType Directory -Path "$staging\Libraries"
    foreach ($path in $local) {
        $source = if ([System.IO.Path]::IsPathRooted($path)) { $path } else { Join-Path $here $path }
        if (-not (Test-Path $source)) { throw "Local plugin $path doesn't exist." }
        Copy-Item -Recurse $source $libraries
    }
    Compress-Archive -Path "$libraries\*" -DestinationPath "$staging\local-plugins.zip"
}

$key = az storage account keys list -g $rg -n $account --query "[0].value" -o tsv
foreach ($file in Get-ChildItem $staging -File) {
    az storage blob upload --account-name $account --account-key $key -c setup -f $file.FullName -n $file.Name --overwrite --only-show-errors | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Uploading $($file.Name) failed." }
}
$expiry = (Get-Date).ToUniversalTime().AddHours(6).ToString("yyyy-MM-ddTHH:mmZ")
$sas = az storage container generate-sas --account-name $account --account-key $key -n setup --permissions r --expiry $expiry --https-only -o tsv
$base = "https://$account.blob.core.windows.net/setup"

# ============================================================================
# Run setup.ps1 on the VM
# ============================================================================

# A managed run command with an unchanged name and script doesn't run again, so it's replaced each time.
az vm run-command delete -g $rg --vm-name $vm --name selva-setup --yes --only-show-errors 2>$null | Out-Null
Write-Host "Running setup.ps1 on $vm. The first run installs Rhino and takes 30 to 60 minutes."
az vm run-command create -g $rg --vm-name $vm --name selva-setup --script-uri "$base/setup.ps1?$sas" `
    --timeout-in-seconds 7200 --only-show-errors `
    --parameters "BlobBase=$base" "EmailAddress=$($settings.EMAIL_ADDRESS)" "Domain=$domain" `
    --protected-parameters "SasToken=$sas" "RhinoToken=$($settings.RHINO_TOKEN)" "ApiKey=$($settings.RHINO_COMPUTE_KEY)" | Out-Null
$result = az vm run-command show -g $rg --vm-name $vm --name selva-setup --instance-view `
    --query "instanceView.{state: executionState, exitCode: exitCode, output: output, error: error}" -o json | ConvertFrom-Json
Write-Host $result.output
if ($result.error) { Write-Host $result.error -ForegroundColor Red }
if ($result.state -ne "Succeeded" -or $result.exitCode -ne 0) {
    throw "setup.ps1 ended $($result.state) (exit code $($result.exitCode)). Full log on the VM: C:\Rhino-Compute-Installation\bootstrap_log.txt."
}

if (-not $SkipRestart) {
    Write-Host "Restarting $vm"
    az vm restart -g $rg -n $vm --only-show-errors | Out-Null
}
Write-Host "Rhino.Compute: $($tf.compute_url.value) with RHINO_COMPUTE_KEY from .env" -ForegroundColor Green
