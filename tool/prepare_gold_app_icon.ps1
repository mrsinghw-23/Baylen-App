param(
  [string]$SourcePath = "assets\icon\logo.png",
  [string]$OutputPath = "assets\icon\logo.png",
  [int]$CanvasSize = 1024,
  [int]$SafePadding = 92
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $SourcePath)) {
  Write-Error "Missing source logo: $SourcePath"
  exit 1
}

function Get-VisibleBounds {
  param([System.Drawing.Bitmap]$Bitmap)

  $left = $Bitmap.Width
  $right = -1
  $top = $Bitmap.Height
  $bottom = -1

  for ($y = 0; $y -lt $Bitmap.Height; $y++) {
    for ($x = 0; $x -lt $Bitmap.Width; $x++) {
      $pixel = $Bitmap.GetPixel($x, $y)
      $brightness = [int]$pixel.R + [int]$pixel.G + [int]$pixel.B
      $isVisible = $pixel.A -gt 18 -and $brightness -gt 52

      if ($isVisible) {
        if ($x -lt $left) { $left = $x }
        if ($x -gt $right) { $right = $x }
        if ($y -lt $top) { $top = $y }
        if ($y -gt $bottom) { $bottom = $y }
      }
    }
  }

  if ($right -lt 0 -or $bottom -lt 0) {
    return New-Object System.Drawing.Rectangle 0, 0, $Bitmap.Width, $Bitmap.Height
  }

  return New-Object System.Drawing.Rectangle $left, $top, ($right - $left + 1), ($bottom - $top + 1)
}

$sourceImage = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $SourcePath))
$sourceBitmap = New-Object System.Drawing.Bitmap $sourceImage
$bounds = Get-VisibleBounds -Bitmap $sourceBitmap

$usableSize = $CanvasSize - ($SafePadding * 2)
$scale = [Math]::Min($usableSize / $bounds.Width, $usableSize / $bounds.Height)
$drawWidth = [int][Math]::Round($bounds.Width * $scale)
$drawHeight = [int][Math]::Round($bounds.Height * $scale)
$drawX = [int][Math]::Round(($CanvasSize - $drawWidth) / 2)
$drawY = [int][Math]::Round(($CanvasSize - $drawHeight) / 2)

$canvas = New-Object System.Drawing.Bitmap $CanvasSize, $CanvasSize, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($canvas)
$graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.Clear([System.Drawing.Color]::Black)

$goldOuter = [System.Drawing.Color]::FromArgb(255, 246, 190, 48)
$goldInner = [System.Drawing.Color]::FromArgb(255, 255, 224, 93)
$circleInset = 32
$circleSize = $CanvasSize - ($circleInset * 2)
$circleRect = New-Object System.Drawing.Rectangle $circleInset, $circleInset, $circleSize, $circleSize

$shadowPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(90, 246, 190, 48)), 16
$outerPen = New-Object System.Drawing.Pen $goldOuter, 8
$innerPen = New-Object System.Drawing.Pen $goldInner, 2
$graphics.DrawEllipse($shadowPen, $circleRect)
$graphics.DrawEllipse($outerPen, $circleRect)
$innerRect = New-Object System.Drawing.Rectangle ($circleInset + 11), ($circleInset + 11), ($circleSize - 22), ($circleSize - 22)
$graphics.DrawEllipse($innerPen, $innerRect)

$srcRect = New-Object System.Drawing.Rectangle $bounds.X, $bounds.Y, $bounds.Width, $bounds.Height
$destRect = New-Object System.Drawing.Rectangle $drawX, $drawY, $drawWidth, $drawHeight
$graphics.DrawImage($sourceImage, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)

$outDir = Split-Path -Parent $OutputPath
if ($outDir) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}
$tempPath = "$OutputPath.tmp.png"
$canvas.Save($tempPath, [System.Drawing.Imaging.ImageFormat]::Png)

$shadowPen.Dispose()
$outerPen.Dispose()
$innerPen.Dispose()
$graphics.Dispose()
$canvas.Dispose()
$sourceBitmap.Dispose()
$sourceImage.Dispose()

Move-Item -LiteralPath $tempPath -Destination $OutputPath -Force

Write-Host "Prepared centered gold app icon: $OutputPath"
