#!/bin/bash
# Exit immediately if a command exits with a non-zero status
set -e

# Target Configuration
PROJECT_ID="bugsnap-ai-dev"
ACCOUNT="admin@yvesboudreau.altostrat.com"
SERVICE_NAME="bugsnap-ai"
REGION="us-central1"

echo "==========================================="
echo "Deploying $SERVICE_NAME to Google Cloud Run"
echo "Project: $PROJECT_ID"
echo "Account: $ACCOUNT"
echo "==========================================="

# Check if the desired account is already logged in
echo "Checking authenticated accounts..."
if ! gcloud auth list --format="value(account)" | grep -Fxq "$ACCOUNT"; then
  echo "Account $ACCOUNT not authenticated. Launching login flow..."
  gcloud auth login "$ACCOUNT"
else
  echo "Account $ACCOUNT is already authenticated."
fi

# Set the active account and project configuration
echo "Setting gcloud active account to $ACCOUNT..."
gcloud config set account "$ACCOUNT"

echo "Setting gcloud project to $PROJECT_ID..."
gcloud config set project "$PROJECT_ID"

# Load environment variables from .env if it exists
BUILD_ENV=""
if [ -f .env ]; then
  echo "Reading .env file for build configuration..."
  while IFS= read -r line || [ -n "$line" ]; do
    line=$(echo "$line" | sed -e 's/\r//g' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    if [[ ! "$line" =~ ^# ]] && [[ -n "$line" ]]; then
      key=$(echo "$line" | cut -d'=' -f1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
      val=$(echo "$line" | cut -d'=' -f2- | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
      if [ "$key" = "GEMINI_API_KEY" ] || [[ "$key" =~ ^FIREBASE_ ]]; then
        if [ -n "$BUILD_ENV" ]; then
          BUILD_ENV="$BUILD_ENV,$key=$val"
        else
          BUILD_ENV="$key=$val"
        fi
      fi
    fi
  done < .env
fi

# Build locally to verify compilation before uploading
echo "Building project locally..."
if [ -n "$BUILD_ENV" ]; then
  # Set them locally for the build verification step
  export $(echo "$BUILD_ENV" | tr ',' ' ')
fi
corepack npm run build

# Deploy to Cloud Run using source code build (Buildpacks)
echo "Deploying source code to Cloud Run..."
if [ -n "$BUILD_ENV" ]; then
  gcloud run deploy "$SERVICE_NAME" \
    --source . \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --set-build-env-vars "$BUILD_ENV" \
    --set-env-vars "$BUILD_ENV" \
    --allow-unauthenticated
else
  gcloud run deploy "$SERVICE_NAME" \
    --source . \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --allow-unauthenticated
fi

echo "Deployment complete!"

