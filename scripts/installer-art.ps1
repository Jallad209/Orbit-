# Draw the NSIS installer art from the app icon, so the welcome and finish pages look like
# Orbit rather than a generic setup wizard. NSIS wants 24-bit BMPs at fixed sizes: the sidebar
# beside the welcome/finish text is 164x314, the header on the inner pages is 150x57.
#
#   powershell -ExecutionPolicy Bypass -File scripts\installer-art.ps1
#
# Re-run it if the icon changes; the outputs are committed next to the installer hooks.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$icon = Join-Path $root 'apps\orbit\src-tauri\icons\128x128@2x.png'
$out = Join-Path $root 'apps\orbit\src-tauri\windows'

$ink = [System.Drawing.Color]::FromArgb(0x1C, 0x1B, 0x1A)    # theme_color
$cream = [System.Drawing.Color]::FromArgb(0xF5, 0xF1, 0xEA)  # background_color
$lime = [System.Drawing.Color]::FromArgb(0xC4, 0xEA, 0x3A)   # the icon's ring
$muted = [System.Drawing.Color]::FromArgb(0xB9, 0xB3, 0xA8)

function New-Canvas([int] $w, [int] $h, [System.Drawing.Color] $fill) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.Clear($fill)
  return @($bmp, $g)
}

function Draw-Centered($g, [string] $text, [System.Drawing.Font] $font, [System.Drawing.Color] $color, [int] $width, [float] $y) {
  $size = $g.MeasureString($text, $font)
  $brush = New-Object System.Drawing.SolidBrush $color
  $g.DrawString($text, $font, $brush, [float](($width - $size.Width) / 2), $y)
  $brush.Dispose()
}

$art = [System.Drawing.Image]::FromFile($icon)
try {
  # Sidebar, 164x314: the icon on the app's own dark, the name, one line of what it is for.
  $bmp, $g = New-Canvas 164 314 $ink
  $g.DrawImage($art, 34, 64, 96, 96)
  Draw-Centered $g 'Orbit' (New-Object System.Drawing.Font 'Segoe UI Semibold', 20) $cream 164 174
  Draw-Centered $g 'Plan your days,' (New-Object System.Drawing.Font 'Segoe UI', 9) $muted 164 214
  Draw-Centered $g 'keep your promises.' (New-Object System.Drawing.Font 'Segoe UI', 9) $muted 164 232
  $accent = New-Object System.Drawing.SolidBrush $lime
  $g.FillRectangle($accent, 70, 268, 24, 3)
  $accent.Dispose()
  $g.Dispose()
  $bmp.Save((Join-Path $out 'installer-sidebar.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
  $bmp.Dispose()

  # Header, 150x57: sits at the top right of the inner pages. Windows draws that band white,
  # so the art is white too; a cream box would show its edge.
  $bmp, $g = New-Canvas 150 57 ([System.Drawing.Color]::White)
  $g.DrawImage($art, 104, 10, 37, 37)
  $font = New-Object System.Drawing.Font 'Segoe UI Semibold', 13
  $brush = New-Object System.Drawing.SolidBrush $ink
  $size = $g.MeasureString('Orbit', $font)
  $g.DrawString('Orbit', $font, $brush, [float](98 - $size.Width), [float]((57 - $size.Height) / 2))
  $brush.Dispose()
  $g.Dispose()
  $bmp.Save((Join-Path $out 'installer-header.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
  $bmp.Dispose()
} finally {
  $art.Dispose()
}
Get-ChildItem $out -Filter 'installer-*.bmp' | ForEach-Object { "$($_.Name)  $([math]::Round($_.Length / 1KB)) KB" }
