# VultStrike CS2 server image - lightweight wrapper
# CS2 is mounted from host at /home/steam/cs2
# This image only adds our custom entrypoint for workshop map support

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Copy plugin source
COPY cs2-reporter/ ./cs2-reporter/

RUN dotnet restore ./cs2-reporter/VultStrikeReporter.csproj
RUN dotnet publish ./cs2-reporter/VultStrikeReporter.csproj -c Release -o /out

# Use lightweight Debian base - CS2 files come from volume mount
FROM debian:bookworm-slim

# Install minimal dependencies for CS2 and .NET runtime (CounterStrikeSharp)
RUN dpkg --add-architecture i386 && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        lib32gcc-s1 \
        lib32stdc++6 \
        libsdl2-2.0-0:i386 \
        libc6:i386 \
        libicu72 \
        curl \
        jq \
    && rm -rf /var/lib/apt/lists/*

# Create steam user to match host permissions
RUN useradd -m -u 1000 steam

# Create directories that will be used
RUN mkdir -p /home/steam/cs2-dedicated/game/csgo/addons/counterstrikesharp/plugins/VultStrikeReporter && \
    mkdir -p /home/steam/cs2-dedicated/game/csgo/cfg && \
    mkdir -p /home/steam/steamcmd && \
    mkdir -p /home/steam/Steam

# Copy plugin (will be overlaid on top of mounted CS2)
COPY --from=build /out/VultStrikeReporter.dll /opt/vultstrike/VultStrikeReporter.dll

# Copy our custom entrypoint
COPY entrypoint.sh /home/steam/entrypoint.sh
RUN chmod +x /home/steam/entrypoint.sh

# Ensure steam user owns its home
RUN chown -R steam:steam /home/steam /opt/vultstrike

USER steam
WORKDIR /home/steam

# Expose CS2 server ports
EXPOSE 27015/tcp 27015/udp 27020/udp

# Use our custom entrypoint
ENTRYPOINT ["/home/steam/entrypoint.sh"]
