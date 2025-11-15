#!/bin/bash
# Script to push to GitHub with token authentication

echo "Pushing to GitHub..."
echo ""
echo "If prompted for credentials:"
echo "  Username: TGALLOWAY1"
echo "  Password: Use your Personal Access Token (not your GitHub password)"
echo ""
echo "To create a token: https://github.com/settings/tokens"
echo ""

git push -u origin main
