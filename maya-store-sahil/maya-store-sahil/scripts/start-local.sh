#!/bin/bash

# Start the app with local database configuration

# Add PostgreSQL to PATH
export PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH"

# Load local environment
if [ -f ".env.local" ]; then
    export $(cat .env.local | grep -v '^#' | xargs)
    echo "✓ Loaded .env.local"
else
    echo "⚠️  .env.local not found. Run ./scripts/setup-local-db.sh first"
    exit 1
fi

# Start the app
echo "Starting app with local database..."
echo "Database: $PGDATABASE @ $PGHOST:$PGPORT"
echo "App will run on: http://localhost:${PORT:-3000}"
echo ""
npm start
