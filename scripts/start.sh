#!/bin/bash
# Railway startup script - runs before the bot starts

echo "🚀 DisCryptoBank Bot - Starting up..."
echo "========================================="

# Update build information
if [ -f "scripts/update-build-info.sh" ]; then
  chmod +x scripts/update-build-info.sh
  bash scripts/update-build-info.sh
else
  echo "⚠️  Build info script not found"
fi

# Show startup information
echo ""
echo "📦 Node Version: $(node -v)"
echo "📦 NPM Version: $(npm -v)"
echo ""
echo "🔍 Environment:"
echo "   - CLUSTER: $CLUSTER"
echo "   - NODE_ENV: $NODE_ENV"
echo ""

# Start the bot
echo "▶️  Starting DisCryptoBank Bot..."
node index.js
