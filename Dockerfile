# syntax=docker/dockerfile:1

FROM eclipse-temurin:21-jdk

LABEL maintainer="itsnotwebby"
LABEL modpack="All the Mons"
LABEL version="1.0.0-rc4"
LABEL description="Docker container for running the All the Mons Minecraft server on Unraid"

# Install required tools and clean up apt cache
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
        unzip \
        jq && \
    rm -rf /var/lib/apt/lists/* && \
    adduser --uid 99 --gid 100 --home /data --disabled-password minecraft

# Copy launch script
COPY launch.sh /launch.sh
RUN chmod +x /launch.sh

# Switch to unraid-compatible user
USER minecraft

# Persistent server directory
VOLUME ["/data"]
WORKDIR /data

# Minecraft default port
EXPOSE 25565/tcp

# Start the server
CMD ["/launch.sh"]
