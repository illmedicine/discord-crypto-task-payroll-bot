#!/bin/bash
# This script updates the bot version and builds information
# It will be run by Railway on each deployment

# Get the current version from package.json
CURRENT_VERSION=$(jq -r '.version' package.json)

# Get the git commit hash (first 7 characters)
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# Get the git branch
GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

# Create a build info file
cat > build-info.json << EOF
{
  "version": "$CURRENT_VERSION",
  "buildDate": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
  "gitCommit": "$GIT_COMMIT",
  "gitBranch": "$GIT_BRANCH",
  "nodeVersion": "$(node -v)",
  "environment": "railway"
}
EOF

echo "✅ Build info updated:"
cat build-info.json
