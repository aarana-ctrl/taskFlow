#!/bin/bash
# TaskFlow — Deploy to Vercel
# Run this from the taskflow-deploy/ folder

echo "🚀 Deploying TaskFlow to Vercel..."

# Check for vercel CLI, install if missing
if ! command -v vercel &> /dev/null; then
  echo "Installing Vercel CLI..."
  npm install -g vercel
fi

# Deploy
vercel --prod --yes

echo "✅ Done! Your app is live."
