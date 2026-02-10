#!/bin/bash

# Setup Local PostgreSQL Database for MAYA Pledge Manager
# This script creates a local database copy for development

set -e

# Add PostgreSQL to PATH if installed via Homebrew
export PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH"

DB_NAME="maya_pledge_local"
DB_USER="maya_dev"
DB_PASSWORD="maya_dev_password"
DB_HOST="localhost"
DB_PORT="5432"

echo "=========================================="
echo "  MAYA Pledge Manager - Local DB Setup"
echo "=========================================="
echo ""

# Check if PostgreSQL is installed
if ! command -v psql &> /dev/null; then
    echo "⚠️  PostgreSQL not found. Installing via Homebrew..."
    brew install postgresql@15
    export PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH"
    brew services start postgresql@15
    sleep 3
    echo "✓ PostgreSQL installed"
else
    echo "✓ PostgreSQL found: $(psql --version)"
fi

# Check if PostgreSQL service is running
PG_ISREADY="/opt/homebrew/opt/postgresql@15/bin/pg_isready"
if [ -f "$PG_ISREADY" ]; then
    if ! "$PG_ISREADY" -h localhost &> /dev/null; then
        echo "⚠️  PostgreSQL service not running. Starting..."
        brew services start postgresql@15 2>/dev/null || true
        sleep 3
    fi
else
    if ! pg_isready -h localhost &> /dev/null; then
        echo "⚠️  PostgreSQL service not running. Starting..."
        brew services start postgresql@15 2>/dev/null || true
        sleep 3
    fi
fi

echo "✓ PostgreSQL service is running"
echo ""

# Create database and user
echo "Creating database and user..."
psql postgres <<EOF
-- Create user if not exists
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_user WHERE usename = '$DB_USER') THEN
        CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';
    END IF;
END
\$\$;

-- Create database if not exists
SELECT 'CREATE DATABASE $DB_NAME OWNER $DB_USER'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB_NAME')\gexec

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
EOF

echo "✓ Database '$DB_NAME' created"
echo "✓ User '$DB_USER' created"
echo ""

# Create .env.local file
ENV_FILE=".env.local"
cat > "$ENV_FILE" <<EOF
# Local Development Database Configuration
# This file is for local development only - DO NOT commit to git

# PostgreSQL Local Connection
PGHOST=$DB_HOST
PGPORT=$DB_PORT
PGUSER=$DB_USER
PGPASSWORD=$DB_PASSWORD
PGDATABASE=$DB_NAME

# Alternative: Connection String Format
# DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME

# App Configuration
NODE_ENV=development
PORT=3000

# Stripe (use test keys for local)
STRIPE_SECRET_KEY=sk_test_your_test_key_here
STRIPE_PUBLISHABLE_KEY=pk_test_your_test_key_here

# Email (optional for local)
RESEND_API_KEY=your_resend_key_here

# Admin
ADMIN_EMAIL=admin@localhost
ADMIN_PASSWORD=admin123
EOF

echo "✓ Created $ENV_FILE"
echo ""
echo "=========================================="
echo "  Setup Complete!"
echo "=========================================="
echo ""
echo "Database Details:"
echo "  Host:     $DB_HOST"
echo "  Port:     $DB_PORT"
echo "  Database: $DB_NAME"
echo "  User:     $DB_USER"
echo ""
echo "Next Steps:"
echo "  1. Copy production data: ./scripts/import-prod-data.sh"
echo "  2. Load environment:     source .env.local"
echo "  3. Initialize schema:     node scripts/init-local-schema.js"
echo "  4. Run app:               npm start"
echo ""
