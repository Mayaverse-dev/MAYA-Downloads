#!/bin/bash

# Script to optimize images for web
# Requires ImageMagick: brew install imagemagick

echo "🖼️  Optimizing images for web..."
echo ""

# Create backup directory
mkdir -p public/images/backups
cp -r public/images/addons public/images/backups/
cp -r public/images/pledges public/images/backups/
echo "✅ Backups created in public/images/backups/"
echo ""

# Optimize addon images (target: 100KB max)
echo "📦 Optimizing addon images..."
for img in public/images/addons/*.{png,jpg,jpeg,webp}; do
    if [ -f "$img" ]; then
        filename=$(basename "$img")
        echo "   Optimizing $filename..."
        magick "$img" -strip -quality 85 -resize 800x800\> "$img"
    fi
done

# Optimize pledge images (target: 200KB max)
echo ""
echo "🎁 Optimizing pledge images..."
for img in public/images/pledges/*.{png,jpg,jpeg,webp}; do
    if [ -f "$img" ]; then
        filename=$(basename "$img")
        echo "   Optimizing $filename..."
        magick "$img" -strip -quality 85 -resize 1000x1000\> "$img"
    fi
done

echo ""
echo "✅ All images optimized!"
echo ""
echo "Before/After sizes:"
du -h public/images/addons/* public/images/pledges/* | sort -hr

