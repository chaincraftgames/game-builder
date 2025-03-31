#!/bin/bash

# Export all non-comment, non-blank variables from .env
while read -r line; do
    # Skip empty lines and comments
    [[ -z "${line}" || "${line}" =~ ^[[:space:]]*# ]] || export "$line"
done < ~/.env