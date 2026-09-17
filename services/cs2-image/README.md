# VultStrike CS2 Server Image

Production-ready CS2 dedicated server image with workshop map support and VultStrike reporter plugin.

## Features

- **Workshop Map Support**: Automatic download and caching of Steam Workshop maps
- **1v1 Maps Ready**: Pre-configured for Tirgo, Bluelines, and Newage 1v1 maps
- **CounterStrikeSharp**: Latest CSS runtime with VultStrike reporter plugin
- **Docker Optimized**: Minimal image size with efficient layer caching

## Building

```bash
cd /path/to/vultstrike
docker build -f services/cs2-image/Dockerfile -t vultstrike-cs2:latest .
```

## Environment Variables

### Required
- `VS_MATCH_ID` - Unique match identifier
- `VS_MAP` - Map name (e.g., "tirgo", "de_dust2")
- `VS_LOBBY_CODE` - Server password/lobby code
- `VS_REGION` - Server region (e.g., "eu-west", "us-east")

### Optional
- `VS_WORKSHOP_ID` - Steam Workshop ID for custom maps
- `VS_WEBHOOK_URL` - VultStrike API webhook URL
- `VS_WEBHOOK_SECRET` - Webhook authentication secret
- `VS_TARGET_WINS` - Rounds needed to win (default: 13)
- `VS_SIDE_SWAP_ROUND` - Side swap round (default: derived from `VS_TARGET_WINS`, e.g. `VS_TARGET_WINS=13` => swap after round 12)
- `STEAM_GSLT` - Steam Game Server Login Token
- `STEAM_API_KEY` - Steam API key for workshop downloads

## Workshop Maps

The following 1v1 workshop maps are supported:

| Map | Workshop ID | Description |
|-----|-------------|-------------|
| Tirgo 1v1 | 3070897497 | Compact 1v1 arena with multiple levels |
| Bluelines 1v1 | 3070210382 | Symmetrical 1v1 map with blue accents |
| Newage 1v1 | 3070308285 | Modern 1v1 arena design |

## Usage

### Basic Server Start

```bash
docker run -d \
  -e VS_MATCH_ID=match_123 \
  -e VS_MAP=tirgo \
  -e VS_WORKSHOP_ID=3070897497 \
  -e VS_LOBBY_CODE=secret123 \
  -e VS_REGION=eu-west \
  -p 27015:27015/tcp \
  -p 27015:27015/udp \
  vultstrike-cs2:latest
```

### With Workshop Cache

```bash
# Pre-download maps
docker-compose -f docker-compose.maps.yml run --rm workshop-cache

# Start server with cached maps
docker-compose -f docker-compose.maps.yml up cs2-server
```

## Map Cache Volume

Workshop maps are cached in a Docker volume for faster server startup:

```bash
# View cached maps
docker run --rm -v vultstrike_workshop-cache:/workshop-cache alpine ls -la /workshop-cache

# Clear cache
docker volume rm vultstrike_workshop-cache
```

## Production Deployment

### Prerequisites

1. Docker and Docker Compose installed
2. Steam API key (for workshop downloads)
3. Steam GSLT (for public server registration)

### Setup

1. **Build the image**:
   ```bash
   docker build -f services/cs2-image/Dockerfile -t vultstrike-cs2:latest .
   ```

2. **Cache workshop maps** (optional but recommended):
   ```bash
   docker-compose -f docker-compose.maps.yml run --rm workshop-cache
   ```

3. **Start the orchestrator** (API will spawn containers automatically):
   ```bash
   # API must have CS2_MOCK_MODE=false
   # Matchmaking worker will provision servers as needed
   ```

### Ports

- `27015/tcp` - RCON and query
- `27015/udp` - Game traffic
- `27020/udp` - SourceTV (optional)

## Troubleshooting

### Workshop Map Not Loading

1. Check Steam API key is set
2. Verify workshop ID is correct
3. Check container logs: `docker logs <container_id>`
4. Ensure map files exist in cache: `docker exec <container_id> ls /home/steam/cs2-dedicated/game/csgo/maps/workshop`

### Server Not Appearing in Browser

1. Set `STEAM_GSLT` environment variable
2. Ensure ports are forwarded correctly
3. Check firewall rules

### High Memory Usage

CS2 servers require significant RAM:
- Minimum: 2GB per server
- Recommended: 4GB per server

## Development

### Testing Locally

```bash
# Run with mock mode (no actual CS2 server)
export CS2_MOCK_MODE=true

# Run with real CS2 server
export CS2_MOCK_MODE=false
export CS2_IMAGE=vultstrike-cs2:latest
```

### Adding New Workshop Maps

1. Add map to [`apps/api/src/config/maps.config.ts`](/apps/api/src/config/maps.config.ts:1)
2. Update `WORKSHOP_MAPS` in [`docker-compose.maps.yml`](/docker-compose.maps.yml:1)
3. Rebuild cache: `docker-compose -f docker-compose.maps.yml run --rm workshop-cache`

## Security Notes

- Never commit Steam API keys or GSLT tokens
- Use environment variables for sensitive data
- Keep Docker images updated for security patches
- Run containers with non-root user (steam)

## License

Part of the VultStrike platform. See main repository for license details.
