param(
  [ValidateSet("hero", "gallery")]
  [string[]] $Targets = @("hero", "gallery")
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Examples = Join-Path $Root "examples"
$AssetScript = Join-Path $Root "scripts\readme-avatar-assets.mjs"
$assets = (& node $AssetScript) | ConvertFrom-Json

if ($assets.provenance.renderer -ne "src/png.mjs#createAvatarPng/createAvatarPngFromDescriptor") {
  throw "Unexpected avatar renderer provenance."
}

function Color([string] $hex) {
  return [System.Drawing.ColorTranslator]::FromHtml($hex)
}

function Open-Graphic([string] $name) {
  $path = Join-Path $Examples $name
  $source = [System.Drawing.Image]::FromFile($path)
  try {
    $bitmap = [System.Drawing.Bitmap]::new($source)
  } finally {
    $source.Dispose()
  }
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  return @($path, $bitmap, $graphics)
}

function Save-Graphic([string] $path, $bitmap, $graphics) {
  $tempPath = "$path.official-avatar-render.png"
  if ([System.IO.File]::Exists($tempPath)) { [System.IO.File]::Delete($tempPath) }
  $graphics.Dispose()
  $bitmap.Save($tempPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
  [System.IO.File]::Copy($tempPath, $path, $true)
  [System.IO.File]::Delete($tempPath)
}

function Paint-Avatar($graphics, $asset, [int] $centerX, [int] $centerY, [string] $surface) {
  $size = [int]$asset.size
  $x = [int]($centerX - $size / 2)
  $y = [int]($centerY - $size / 2)

  $surfaceBrush = [System.Drawing.SolidBrush]::new((Color $surface))
  $graphics.FillRectangle($surfaceBrush, $x, $y, $size, $size)
  $surfaceBrush.Dispose()

  $bytes = [Convert]::FromBase64String([string]$asset.png)
  $stream = [System.IO.MemoryStream]::new($bytes, $false)
  try {
    $avatar = [System.Drawing.Image]::FromStream($stream)
    try {
      if ($avatar.Width -ne $size -or $avatar.Height -ne $size) {
        throw "Official avatar PNG has an unexpected size for seed $($asset.seed)."
      }
      $graphics.DrawImageUnscaled($avatar, $x, $y)
    } finally {
      $avatar.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Apply-Hero {
  $path, $bitmap, $graphics = Open-Graphic "hero-agent-dashboard.png"
  for ($i = 0; $i -lt $assets.hero.Count; $i++) {
    $top = 196 + $i * 76
    $surface = if ($i -eq 1) { "#E8F2FC" } else { "#FFFFFF" }
    Paint-Avatar $graphics $assets.hero[$i] 94 ($top + 28) $surface
  }
  for ($i = 0; $i -lt $assets.heroChat.Count; $i++) {
    Paint-Avatar $graphics $assets.heroChat[$i] 484 (266 + $i * 100) "#FFFFFF"
  }
  Save-Graphic $path $bitmap $graphics
}

function Apply-Gallery {
  $path = Join-Path $Examples "avatar-gallery.png"
  $bitmap = [System.Drawing.Bitmap]::new(1200, 440)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear((Color "#FFFFFF"))
  for ($i = 0; $i -lt $assets.gallery.Count; $i++) {
    $column = $i % 4
    $row = [Math]::Floor($i / 4)
    $x = 180 + $column * 280
    $y = 120 + $row * 200
    Paint-Avatar $graphics $assets.gallery[$i].light ($x - 56) $y "#FFFFFF"
    Paint-Avatar $graphics $assets.gallery[$i].dark ($x + 56) $y "#FFFFFF"
  }
  Save-Graphic $path $bitmap $graphics
}

if ($Targets -contains "hero") { Apply-Hero }
if ($Targets -contains "gallery") { Apply-Gallery }

Write-Output "Applied official createAvatarPng/createAvatarPngFromDescriptor output to: $($Targets -join ', ')."
