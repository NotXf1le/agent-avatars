param(
  [ValidateSet("hero", "gallery", "deterministic", "batch", "themes", "private")]
  [string[]] $Targets = @("hero", "gallery", "deterministic", "batch", "themes", "private")
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

function Paint-PaletteLabel($graphics, [string] $paletteId, [int] $x, [int] $y) {
  $surfaceBrush = [System.Drawing.SolidBrush]::new((Color "#FFFFFF"))
  $graphics.FillRectangle($surfaceBrush, $x, $y, 230, 22)
  $surfaceBrush.Dispose()

  $font = [System.Drawing.Font]::new(
    "Consolas",
    12,
    [System.Drawing.FontStyle]::Regular,
    [System.Drawing.GraphicsUnit]::Pixel
  )
  $textBrush = [System.Drawing.SolidBrush]::new((Color "#6E6A63"))
  $graphics.DrawString("palette: $paletteId", $font, $textBrush, $x, $y)
  $textBrush.Dispose()
  $font.Dispose()
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
  $path, $bitmap, $graphics = Open-Graphic "avatar-gallery.png"
  for ($i = 0; $i -lt $assets.gallery.Count; $i++) {
    $column = $i % 4
    $row = [Math]::Floor($i / 4)
    $x = 48 + $column * 276
    $y = 120 + $row * 208
    Paint-PaletteLabel $graphics $assets.gallery[$i].light.paletteId ($x + 20) ($y + 46)
    Paint-Avatar $graphics $assets.gallery[$i].light ($x + 86) ($y + 132) "#FFFFFF"
    Paint-Avatar $graphics $assets.gallery[$i].dark ($x + 194) ($y + 132) "#FFFFFF"
  }
  Save-Graphic $path $bitmap $graphics
}

function Apply-Deterministic {
  $path, $bitmap, $graphics = Open-Graphic "deterministic-output.png"
  foreach ($centerX in @(224, 600, 976)) {
    Paint-Avatar $graphics $assets.deterministic $centerX 270 "#FFFFFF"
  }
  Save-Graphic $path $bitmap $graphics
}

function Apply-Batch {
  $path, $bitmap, $graphics = Open-Graphic "batch-uniqueness.png"
  $centers = @(140, 324, 508, 692, 876, 1060)
  for ($i = 0; $i -lt $centers.Count; $i++) {
    Paint-Avatar $graphics $assets.batchNaive[$i] $centers[$i] 218 "#EFEDE8"
    Paint-Avatar $graphics $assets.batch[$i] $centers[$i] 432 "#FFFFFF"
  }
  Save-Graphic $path $bitmap $graphics
}

function Apply-Themes {
  $path, $bitmap, $graphics = Open-Graphic "light-dark-themes.png"
  for ($i = 0; $i -lt $assets.themes.Count; $i++) {
    $top = 228 + $i * 72
    $lightSurface = if ($i -eq 1) { "#E8F2FC" } else { "#FFFFFF" }
    $darkSurface = if ($i -eq 1) { "#1D2F40" } else { "#1C1C1E" }
    Paint-Avatar $graphics $assets.themes[$i].light 98 ($top + 27) $lightSurface
    Paint-Avatar $graphics $assets.themes[$i].dark 682 ($top + 27) $darkSurface
  }
  Save-Graphic $path $bitmap $graphics
}

function Apply-Private {
  $path, $bitmap, $graphics = Open-Graphic "private-seed-flow.png"
  Paint-Avatar $graphics $assets.private 1035 260 "#FFFFFF"
  Save-Graphic $path $bitmap $graphics
}

if ($Targets -contains "hero") { Apply-Hero }
if ($Targets -contains "gallery") { Apply-Gallery }
if ($Targets -contains "deterministic") { Apply-Deterministic }
if ($Targets -contains "batch") { Apply-Batch }
if ($Targets -contains "themes") { Apply-Themes }
if ($Targets -contains "private") { Apply-Private }

Write-Output "Applied official createAvatarPng/createAvatarPngFromDescriptor output to: $($Targets -join ', ')."
