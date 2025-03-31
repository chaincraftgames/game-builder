#!/bin/bash

# Export all variables from .env
while read -r line; do export "$line"; done < ~/.env

# Export CHAINCRAFT_DEV_DISCORD_BOT_TOKEN as CHAINCRAFT_DISCORD_BOT_TOKEN
export CHAINCRAFT_DISCORD_BOT_TOKEN=$CHAINCRAFT_DEV_DISCORD_BOT_TOKEN
export CHAINCRAFT_COMMAND_NAME=chaincraft_dev
