#!/usr/bin/env bash
set -euo pipefail
read -r -p "Correo del administrador: " ADMIN_SETUP_EMAIL
read -r -s -p "Contraseña (mínimo 12 caracteres): " ADMIN_SETUP_PASSWORD
echo
export ADMIN_SETUP_EMAIL ADMIN_SETUP_PASSWORD
node scripts/create-admin.js
unset ADMIN_SETUP_PASSWORD ADMIN_SETUP_EMAIL
