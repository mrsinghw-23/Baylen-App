param(
  [string]$SourcePath = "assets\icon\logo.png"
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $SourcePath)) {
  Write-Error "Missing web icon source: $SourcePath"
  exit 1
}

function Save-IconPng {
  param(
    [System.Drawing.Image]$Source,
    [string]$Path,
    [int]$Size,
    [int]$Padding = 0
  )

  $bitmap = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([System.Drawing.Color]::Black)
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $available = $Size - ($Padding * 2)
  $scale = [Math]::Min($available / $Source.Width, $available / $Source.Height)
  $width = [int][Math]::Round($Source.Width * $scale)
  $height = [int][Math]::Round($Source.Height * $scale)
  $x = [int][Math]::Round(($Size - $width) / 2)
  $y = [int][Math]::Round(($Size - $height) / 2)

  $graphics.DrawImage($Source, $x, $y, $width, $height)
  $directory = Split-Path -Parent $Path
  if ($directory) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
  }
  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)

  $graphics.Dispose()
  $bitmap.Dispose()
}

$source = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $SourcePath))

Save-IconPng -Source $source -Path "web\favicon.png" -Size 32
Save-IconPng -Source $source -Path "web\icons\Icon-192.png" -Size 192
Save-IconPng -Source $source -Path "web\icons\Icon-512.png" -Size 512
Save-IconPng -Source $source -Path "web\icons\Icon-maskable-192.png" -Size 192 -Padding 20
Save-IconPng -Source $source -Path "web\icons\Icon-maskable-512.png" -Size 512 -Padding 52

$source.Dispose()
Write-Host "Generated web icons from $SourcePath"
