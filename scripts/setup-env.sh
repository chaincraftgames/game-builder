#!/bin/bash

# Export all variables from .env
while read -r line; do export "$line"; done < ~/.env
