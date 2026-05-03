#!/bin/bash
set -e
set -x

# ==============================
# All the Mons Configuration
# ==============================

SERVER_VERSION="0.0.12"
SERVER_FILE_ID=8027958
SERVER_FILE_NAME="ServerFiles-${SERVER_VERSION}.zip"

# Extract prefix/suffix from file ID dynamically
SERVER_FILE_ID_PREFIX="${SERVER_FILE_ID:0:4}"
SERVER_FILE_ID_SUFFIX="${SERVER_FILE_ID: -3}"

FORGE_CDN_URL="https://mediafilez.forgecdn.net/files/${SERVER_FILE_ID_PREFIX}/${SERVER_FILE_ID_SUFFIX}/${SERVER_FILE_NAME}"

cd /data || exit 1

# ==============================
# EULA Check
# ==============================

if ! [[ "$EULA" = "false" ]]; then
    echo "eula=true" > eula.txt
else
    echo "You must accept the EULA to install."
    exit 99
fi

# ==============================
# Install Server Files (First Run Only)
# ==============================

if ! [[ -f "$SERVER_FILE_NAME" ]]; then
    echo "First run detected. Installing All the Mods11..."

    rm -fr config defaultconfigs kubejs mods packmenu ServerFiles-* neoforge*

    echo "Downloading from ForgeCDN..."
    curl -L -o "$SERVER_FILE_NAME" "$FORGE_CDN_URL" || exit 9

    echo "Extracting server files..."
    unzip -u -o "$SERVER_FILE_NAME" -d /data

    DIR_TEST="ServerFiles-${SERVER_VERSION}"

    if [[ -d "$DIR_TEST" ]]; then
        cd "$DIR_TEST" || exit 1
        find . -type d -exec chmod 755 {} +
        mv -f * /data
        cd /data || exit 1
        rm -fr "$DIR_TEST"
    fi
fi

# ==============================
# JVM Options (if file exists)
# ==============================

if [[ -n "$JVM_OPTS" ]] && [[ -f user_jvm_args.txt ]]; then
    sed -i '/-Xm[s,x]/d' user_jvm_args.txt
    for j in ${JVM_OPTS}; do
        echo "$j" >> user_jvm_args.txt
    done
fi

# ==============================
# Server Properties (only if file exists)
# ==============================

if [[ -f server.properties ]]; then

    if [[ -n "$MOTD" ]]; then
        sed -i "s/^motd=.*/motd=$MOTD/" server.properties
    fi

    if [[ -n "$ENABLE_WHITELIST" ]]; then
        sed -i "s/white-list=.*/white-list=$ENABLE_WHITELIST/" server.properties
    fi

    if [[ -n "$ALLOW_FLIGHT" ]]; then
        sed -i "s/allow-flight=.*/allow-flight=$ALLOW_FLIGHT/" server.properties
    fi

    if [[ -n "$MAX_PLAYERS" ]]; then
        sed -i "s/max-players=.*/max-players=$MAX_PLAYERS/" server.properties
    fi

    if [[ -n "$ONLINE_MODE" ]]; then
        sed -i "s/online-mode=.*/online-mode=$ONLINE_MODE/" server.properties
    fi

    sed -i 's/server-port=.*/server-port=25565/g' server.properties
fi

# ==============================
# Whitelist Setup
# ==============================

if [[ ! -f whitelist.json ]]; then
    echo "[]" > whitelist.json
fi

IFS=',' read -ra USERS <<< "$WHITELIST_USERS"
for raw_username in "${USERS[@]}"; do
    username=$(echo "$raw_username" | xargs)

    if [[ -z "$username" ]] || ! [[ "$username" =~ ^[a-zA-Z0-9_]{3,16}$ ]]; then
        echo "Whitelist: Invalid username '$username'. Skipping..."
        continue
    fi

    UUID=$(curl -s "https://playerdb.co/api/player/minecraft/$username" | jq -r '.data.player.id')

    if [[ "$UUID" != "null" ]]; then
        if jq -e ".[] | select(.uuid == \"$UUID\")" whitelist.json > /dev/null; then
            echo "Whitelist: $username already added."
        else
            jq ". += [{\"uuid\": \"$UUID\", \"name\": \"$username\"}]" whitelist.json > tmp.json && mv tmp.json whitelist.json
            echo "Whitelist: Added $username"
        fi
    fi
done

# ==============================
# Ops Setup
# ==============================

if [[ ! -f ops.json ]]; then
    echo "[]" > ops.json
fi

IFS=',' read -ra OPS <<< "$OP_USERS"
for raw_username in "${OPS[@]}"; do
    username=$(echo "$raw_username" | xargs)

    if [[ -z "$username" ]] || ! [[ "$username" =~ ^[a-zA-Z0-9_]{3,16}$ ]]; then
        echo "Ops: Invalid username '$username'. Skipping..."
        continue
    fi

    UUID=$(curl -s "https://playerdb.co/api/player/minecraft/$username" | jq -r '.data.player.id')

    if [[ "$UUID" != "null" ]]; then
        if jq -e ".[] | select(.uuid == \"$UUID\")" ops.json > /dev/null; then
            echo "Ops: $username already added."
        else
            jq ". += [{\"uuid\": \"$UUID\", \"name\": \"$username\", \"level\": 4, \"bypassesPlayerLimit\": false}]" ops.json > tmp.json && mv tmp.json ops.json
            echo "Ops: Added $username"
        fi
    fi
done

# ==============================
# Start Server
# ==============================

if [[ -f startserver.sh ]]; then
    echo "Starting All the Mods server..."
    chmod +x startserver.sh
    exec ./startserver.sh
else
    echo "ERROR: startserver.sh not found."
    ls -la
    exit 1
fi
