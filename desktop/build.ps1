<#
Builds desktop\dist\Closet.exe: the whole of Closet in one file, for people who just want to
double-click something. Needs Windows, Node 22 and an internet connection (the first time).

    powershell -ExecutionPolicy Bypass -File desktop\build.ps1 -Version 1.0.0

-LauncherOnly rebuilds just the launcher around the last build's app, for working on it.

Everything downloaded is pinned by SHA-256, so the same inputs make the same app. To move to a
newer Node 22, change $NodeVersion and $NodeSha256 (from nodejs.org/dist/<version>/SHASUMS256.txt).
#>
param([string]$Version = '0.0.0', [switch]$LauncherOnly)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$NodeVersion = '22.23.4'
$NodeSha256 = 'cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20'
$ModelUrl = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx'
$ModelSha256 = '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a'
# What onnxruntime.dll is linked against. A fresh Windows may not have these, so they ship with it.
$VcRuntime = 'msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_atomic_wait.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'

$Repo = Split-Path $PSScriptRoot -Parent
$Dist = Join-Path $PSScriptRoot 'dist'
$Cache = Join-Path $Dist 'cache'
$Stage = Join-Path $Dist 'stage'
$Compile = Join-Path $Dist 'compile'
$Csc = Join-Path $env:windir 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }

function Run {
  param([Parameter(Mandatory)][string]$Tool, [Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
  & $Tool @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Tool $Arguments failed ($LASTEXITCODE)" }
}

# npm ci empties node_modules first, which fails if an editor or antivirus is reading it.
function NpmCi {
  param([Parameter(ValueFromRemainingArguments)][string[]]$Options)
  foreach ($attempt in 1..4) {
    & npm ci --no-audit --no-fund @Options
    if ($LASTEXITCODE -eq 0) { return }
    if ($attempt -lt 4) { Write-Host 'npm ci failed; trying again shortly'; Start-Sleep -Seconds 5 }
  }
  throw "npm ci failed ($LASTEXITCODE)"
}

function Sha256($file) { (Get-FileHash $file -Algorithm SHA256).Hash.ToLowerInvariant() }

function Fetch($url, $sha256, $name) {
  $file = Join-Path $Cache $name
  if (-not ((Test-Path $file) -and (Sha256 $file) -eq $sha256)) {
    Write-Host "downloading $name"
    Invoke-WebRequest $url -OutFile $file -UseBasicParsing
    $got = Sha256 $file
    if ($got -ne $sha256) { Remove-Item $file; throw "$name has the wrong checksum: $got" }
  }
  $file
}

function NewFolder($path) {
  # Antivirus and the search indexer hold new files for a moment.
  foreach ($attempt in 1..20) {
    try { if (Test-Path $path) { Remove-Item $path -Recurse -Force }; break }
    catch { if ($attempt -eq 20) { throw }; Start-Sleep -Seconds 1 }
  }
  New-Item $path -ItemType Directory -Force | Out-Null
}

# Files nothing reads at run time. Licences stay.
function Prune($modules) {
  Get-ChildItem $modules -Recurse -File |
    Where-Object { $_.Name -match '\.(map|ts|tsx|md|markdown|c|cc|cpp|h|hpp|gyp|gypi|tsbuildinfo)$' -and $_.Name -notmatch '^licen[cs]e' } |
    Remove-Item -Force
}

Step 'Checking tools'
$nodeHere = (& node --version)
if ($nodeHere -notmatch '^v22\.') { throw "Build with Node 22 (native modules must match the bundled Node); found $nodeHere" }
if (-not (Test-Path $Csc)) { throw "No C# compiler at $Csc" }
New-Item $Cache -ItemType Directory -Force | Out-Null
NewFolder $Compile
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (-not $LauncherOnly) {
NewFolder $Stage

Step 'Building the web app'
Push-Location (Join-Path $Repo 'web')
NpmCi
Run npm run build
Pop-Location
Copy-Item (Join-Path $Repo 'web\dist') (Join-Path $Stage 'public') -Recurse

Step 'Building the server'
Push-Location (Join-Path $Repo 'server')
NpmCi
Run npm run build
Pop-Location
$stageServer = Join-Path $Stage 'server'
New-Item $stageServer -ItemType Directory | Out-Null
Copy-Item (Join-Path $Repo 'server\dist') $stageServer -Recurse
Copy-Item (Join-Path $Repo 'server\migrations') $stageServer -Recurse
Copy-Item (Join-Path $Repo 'server\package.json'), (Join-Path $Repo 'server\package-lock.json') $stageServer
Get-ChildItem (Join-Path $stageServer 'dist') -Filter '*.test.js' | Remove-Item
Push-Location $stageServer
NpmCi --omit=dev
Pop-Location
Prune (Join-Path $stageServer 'node_modules')
Get-ChildItem (Join-Path $stageServer 'node_modules\better-sqlite3') -Directory |
  Where-Object Name -in 'deps', 'src' | Remove-Item -Recurse -Force

Step 'Adding background removal'
$stageCutouts = Join-Path $Stage 'cutouts'
New-Item $stageCutouts -ItemType Directory | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'cutouts\server.mjs'), (Join-Path $PSScriptRoot 'cutouts\package.json'), (Join-Path $PSScriptRoot 'cutouts\package-lock.json') $stageCutouts
Push-Location $stageCutouts
NpmCi --omit=dev
Pop-Location
Prune (Join-Path $stageCutouts 'node_modules')
# Keep just the 64-bit Windows, CPU-only build of ONNX Runtime: the rest is over 200 MB.
$ort = Join-Path $stageCutouts 'node_modules\onnxruntime-node\bin'
Get-ChildItem $ort -Directory -Recurse | Where-Object { $_.Name -in 'darwin', 'linux', 'arm64' } | Remove-Item -Recurse -Force
Get-ChildItem $ort -File -Recurse | Where-Object Name -in 'DirectML.dll', 'dxcompiler.dll', 'dxil.dll' | Remove-Item -Force
# Beside the binding, because that's the first place Windows looks when Node loads it. It also
# means these win over any older copies in System32, which crash a newer ONNX Runtime.
$binding = (Get-ChildItem $ort -Filter 'onnxruntime_binding.node' -Recurse | Select-Object -First 1).DirectoryName
foreach ($dll in $VcRuntime) { Copy-Item (Join-Path $env:windir "System32\$dll") $binding }
Copy-Item (Fetch $ModelUrl $ModelSha256 'isnet-general-use.onnx') $stageCutouts

Step "Adding Node $NodeVersion"
$nodeZip = Fetch "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip" $NodeSha256 "node-v$NodeVersion-win-x64.zip"
$zip = [IO.Compression.ZipFile]::OpenRead($nodeZip)
try {
  foreach ($name in 'node.exe', 'LICENSE') {
    $entry = $zip.GetEntry("node-v$NodeVersion-win-x64/$name")
    $target = Join-Path $Stage $(if ($name -eq 'LICENSE') { 'NODE-LICENSE.txt' } else { $name })
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target)
  }
} finally { $zip.Dispose() }
Copy-Item (Join-Path $PSScriptRoot 'NOTICES.txt') $Stage

Step 'Trying it, using only what will ship'
$tryData = Join-Path $Dist 'try-data'
NewFolder $tryData
$node = Join-Path $Stage 'node.exe'
$env:PORT = '18531'; $env:CUTOUT_MODEL = Join-Path $stageCutouts 'isnet-general-use.onnx'
$cutouts = Start-Process $node 'server.mjs' -WorkingDirectory $stageCutouts -PassThru -WindowStyle Hidden
$env:PORT = '18530'; $env:HOST = '127.0.0.1'; $env:DATA_DIR = $tryData; $env:REMBG_URL = 'http://127.0.0.1:18531'
$env:WEB_DIR = Join-Path $Stage 'public'; $env:MIGRATIONS_DIR = Join-Path $stageServer 'migrations'
$server = Start-Process $node 'dist\index.js' -WorkingDirectory $stageServer -PassThru -WindowStyle Hidden
try {
  $sample = Join-Path $Repo 'web\public\icon-v2-512.png'
  $health = $null
  foreach ($attempt in 1..40) {
    Start-Sleep -Milliseconds 500
    try { $health = Invoke-RestMethod 'http://127.0.0.1:18530/api/health'; if ($health.rembg -eq 'up') { break } } catch { }
  }
  if (-not $health.ok -or $health.rembg -ne 'up') { throw 'The server or the cutout service did not start from the stage folder' }
  $code = & curl.exe -s -o NUL -w '%{http_code}' -F "file=@$sample" 'http://127.0.0.1:18531/api/remove'
  if ($code -ne '200') { throw "Background removal answered $code" }
  Write-Host 'server up, database migrated, background removed'
} finally {
  Stop-Process -Id $server.Id, $cutouts.Id -Force -ErrorAction SilentlyContinue
  'PORT', 'HOST', 'DATA_DIR', 'REMBG_URL', 'WEB_DIR', 'MIGRATIONS_DIR', 'CUTOUT_MODEL' | ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
}
Start-Sleep -Seconds 1
Remove-Item $tryData -Recurse -Force
}

Step 'Building the launcher'
$numeric = ($Version -replace '[^0-9.].*$', '').Trim('.')
$buildId = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss')
Set-Content (Join-Path $Compile 'BuildInfo.cs') -Encoding ASCII -Value @"
using System.Reflection;
[assembly: AssemblyVersion("$numeric.0")]
namespace Closet
{
    static class BuildInfo
    {
        public const string Id = "$buildId";
        public const string Version = "$Version";
    }
}
"@
$sources = @((Get-ChildItem (Join-Path $PSScriptRoot 'launcher') -Filter '*.cs').FullName) + (Join-Path $Compile 'BuildInfo.cs')
$launcher = Join-Path $PSScriptRoot 'launcher'
$cscOptions = @(
  '/nologo', '/target:winexe', '/platform:anycpu', '/optimize+',
  "/win32icon:$(Join-Path $launcher 'closet.ico')",
  "/win32manifest:$(Join-Path $launcher 'app.manifest')",
  "/resource:$(Join-Path $launcher 'closet.ico'),closet.ico",
  '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Core.dll', '/r:Microsoft.CSharp.dll',
  '/r:Microsoft.VisualBasic.dll', '/r:System.IO.Compression.dll'
)
Run $Csc @cscOptions "/out:$(Join-Path $Stage 'Closet.exe')" @sources

Step 'Packing it into one file'
$payload = Join-Path $Compile 'payload.zip'
[IO.Compression.ZipFile]::CreateFromDirectory($Stage, $payload, [IO.Compression.CompressionLevel]::Optimal, $false)
$out = Join-Path $Dist 'Closet.exe'
Run $Csc @cscOptions "/resource:$payload,payload.zip" "/out:$out" @sources

$size = [math]::Round((Get-Item $out).Length / 1MB)
Step "Done: $out ($size MB, version $Version, build $buildId)"
Write-Host "SHA-256: $(Sha256 $out)"
