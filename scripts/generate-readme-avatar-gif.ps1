param(
  [ValidateRange(2, 500)]
  [int] $DelayHundredths = 70
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Examples = Join-Path $Root "examples"
$AssetScript = Join-Path $Root "scripts\readme-avatar-assets.mjs"
$assets = (& node $AssetScript) | ConvertFrom-Json
$FrameSize = 512
$FrameCenter = $FrameSize / 2
$OutlineRadius = 200

if ($assets.provenance.renderer -ne "src/png.mjs#createAvatarPng/createAvatarPngFromDescriptor") {
  throw "Unexpected avatar renderer provenance."
}
if ($assets.cycle.Count -lt 2) {
  throw "At least two official avatar frames are required."
}

$encoder = [System.Windows.Media.Imaging.GifBitmapEncoder]::new()
foreach ($asset in $assets.cycle) {
  if ($asset.size -ne $FrameSize) { throw "Avatar GIF frames must be $FrameSize by $FrameSize pixels." }
  $bytes = [Convert]::FromBase64String([string]$asset.png)
  $stream = [System.IO.MemoryStream]::new($bytes, $false)
  try {
    $decoder = [System.Windows.Media.Imaging.PngBitmapDecoder]::new(
      $stream,
      [System.Windows.Media.Imaging.BitmapCreateOptions]::PreservePixelFormat,
      [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
    )
    $source = $decoder.Frames[0]

    # GitHub-achievement-style outline: an 8 px white ring behind the
    # official 384 px avatar circle. README displays the 512 px GIF at 224 px,
    # so browser downsampling smooths the binary-transparency GIF edge.
    $visual = [System.Windows.Media.DrawingVisual]::new()
    $drawing = $visual.RenderOpen()
    $drawing.DrawEllipse(
      [System.Windows.Media.Brushes]::White,
      $null,
      [System.Windows.Point]::new($FrameCenter, $FrameCenter),
      $OutlineRadius,
      $OutlineRadius
    )
    $drawing.DrawImage($source, [System.Windows.Rect]::new(0, 0, $FrameSize, $FrameSize))
    $drawing.Close()
    $composited = [System.Windows.Media.Imaging.RenderTargetBitmap]::new(
      $FrameSize,
      $FrameSize,
      96,
      96,
      [System.Windows.Media.PixelFormats]::Pbgra32
    )
    $composited.Render($visual)

    $metadata = [System.Windows.Media.Imaging.BitmapMetadata]::new("gif")
    $metadata.SetQuery("/grctlext/Delay", [UInt16]$DelayHundredths)
    $metadata.SetQuery("/grctlext/Disposal", [byte]2)
    $frame = [System.Windows.Media.Imaging.BitmapFrame]::Create($composited, $null, $metadata, $null)
    $encoder.Frames.Add($frame)
  } finally {
    $stream.Dispose()
  }
}

$target = Join-Path $Examples "avatar-cycle.gif"
$temporary = "$target.new"
if ([System.IO.File]::Exists($temporary)) { [System.IO.File]::Delete($temporary) }

$output = [System.IO.File]::Open($temporary, [System.IO.FileMode]::CreateNew)
try {
  $encoder.Save($output)
} finally {
  $output.Dispose()
}

# WPF writes the frames and delays but not an infinite-loop application block.
# Insert the standard NETSCAPE2.0 extension after the global color table.
$gif = [System.IO.File]::ReadAllBytes($temporary)
if ($gif.Length -lt 13 -or [Text.Encoding]::ASCII.GetString($gif, 0, 3) -ne "GIF") {
  throw "The generated file is not a valid GIF."
}

# GifBitmapEncoder keeps transparency but may omit the requested frame delay.
# Enforce the delay and restore-to-background disposal in every graphics-control block.
$graphicsControlCount = 0
for ($index = 0; $index -lt $gif.Length - 7; $index++) {
  if ($gif[$index] -eq 0x21 -and $gif[$index + 1] -eq 0xF9 -and $gif[$index + 2] -eq 0x04) {
    $gif[$index + 3] = [byte](($gif[$index + 3] -band 0xE3) -bor 0x08)
    $gif[$index + 4] = [byte]($DelayHundredths -band 0xFF)
    $gif[$index + 5] = [byte](($DelayHundredths -shr 8) -band 0xFF)
    $graphicsControlCount++
  }
}
if ($graphicsControlCount -ne $assets.cycle.Count) {
  throw "Unexpected number of GIF graphics-control blocks: $graphicsControlCount."
}

$packed = $gif[10]
$globalTableBytes = if (($packed -band 0x80) -ne 0) {
  3 * [Math]::Pow(2, (($packed -band 0x07) + 1))
} else {
  0
}
$insertAt = 13 + [int]$globalTableBytes
$loopExtension = [byte[]]@(
  0x21, 0xFF, 0x0B,
  0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30,
  0x03, 0x01, 0x00, 0x00, 0x00
)
$loopingGif = [byte[]]::new($gif.Length + $loopExtension.Length)
[Array]::Copy($gif, 0, $loopingGif, 0, $insertAt)
[Array]::Copy($loopExtension, 0, $loopingGif, $insertAt, $loopExtension.Length)
[Array]::Copy($gif, $insertAt, $loopingGif, $insertAt + $loopExtension.Length, $gif.Length - $insertAt)
[System.IO.File]::WriteAllBytes($temporary, $loopingGif)

[System.IO.File]::Copy($temporary, $target, $true)
[System.IO.File]::Delete($temporary)

Write-Output "Generated examples/avatar-cycle.gif from $($assets.cycle.Count) official createAvatarPng frames."
