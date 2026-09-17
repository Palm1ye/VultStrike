import { Injectable, Logger } from '@nestjs/common';
import { 
  MAPS, 
  MapConfig, 
  getMapsByType, 
  getRandomMap, 
  getMapById,
  isWorkshopMap 
} from '../../config/maps.config';

/**
 * Map pool configuration by game mode
 */
interface MapPool {
  mode: '1v1' | '2v2' | '3v3';
  maps: string[]; // Map IDs
  selectionMode: 'random' | 'vote' | 'admin';
}

@Injectable()
export class MapsService {
  private readonly logger = new Logger(MapsService.name);
  private mapPools: Map<string, MapPool> = new Map();
  private currentMapIndex: Map<string, number> = new Map();

  constructor() {
    this.initializeMapPools();
  }

  /**
   * Initialize default map pools
   */
  private initializeMapPools(): void {
    this.mapPools.set('1v1', {
      mode: '1v1',
      maps: this.resolvePool('1v1', process.env.CS2_MAP_POOL_ONE_V_ONE, ['tirgo', 'bluelines', 'newage']),
      selectionMode: 'random'
    });

    this.mapPools.set('2v2', {
      mode: '2v2',
      maps: this.resolvePool('2v2', process.env.CS2_MAP_POOL_TWO_V_TWO, ['de_dust2', 'de_mirage']),
      selectionMode: 'random'
    });

    this.mapPools.set('3v3', {
      mode: '3v3',
      maps: this.resolvePool('3v3', process.env.CS2_MAP_POOL_THREE_V_THREE, ['de_dust2', 'de_mirage']),
      selectionMode: 'random'
    });

    this.logger.log(
      `Map pools initialized: 1v1=[${this.mapPools.get('1v1')?.maps.join(', ')}], 2v2=[${this.mapPools.get('2v2')?.maps.join(', ')}], 3v3=[${this.mapPools.get('3v3')?.maps.join(', ')}]`
    );
  }

  private resolvePool(mode: '1v1' | '2v2' | '3v3', raw: string | undefined, fallback: string[]): string[] {
    const configured = (raw ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const requested = configured.length > 0 ? configured : fallback;
    const eligible = new Set(getMapsByType(mode).map((map) => map.id));
    const valid = requested.filter((mapId) => eligible.has(mapId));
    const invalid = requested.filter((mapId) => !eligible.has(mapId));

    if (invalid.length > 0) {
      this.logger.warn(`Ignoring invalid ${mode} map pool entries: ${invalid.join(', ')}`);
    }

    if (valid.length === 0) {
      this.logger.warn(`No valid ${mode} map pool entries found; falling back to ${fallback.join(', ')}`);
      return fallback.filter((mapId) => eligible.has(mapId));
    }

    return valid;
  }

  /**
   * Get all available maps
   */
  getAllMaps(): MapConfig[] {
    return MAPS;
  }

  /**
   * Get maps filtered by type
   */
  getMapsByType(type: MapConfig['type']): MapConfig[] {
    return getMapsByType(type);
  }

  /**
   * Get map pool for a specific mode
   */
  getMapPool(mode: '1v1' | '2v2' | '3v3'): MapPool | undefined {
    return this.mapPools.get(mode);
  }

  /**
   * Select a map for a match
   * Uses random selection from the map pool
   */
  selectMapForMatch(mode: '1v1' | '2v2' | '3v3'): MapConfig {
    const pool = this.mapPools.get(mode);
    
    if (!pool || pool.maps.length === 0) {
      this.logger.warn(`No map pool found for mode ${mode}, using fallback`);
      return getRandomMap(mode);
    }

    // Get current rotation index
    const indexKey = mode;
    let currentIndex = this.currentMapIndex.get(indexKey) || 0;
    
    // Select map from pool
    const mapId = pool.maps[currentIndex % pool.maps.length];
    const map = getMapById(mapId);
    
    if (!map) {
      this.logger.warn(`Map ${mapId} not found in configuration, using fallback`);
      return getRandomMap(mode);
    }

    // Increment index for next selection
    this.currentMapIndex.set(indexKey, currentIndex + 1);

    this.logger.log(`Selected map ${map.name} (${map.id}) for ${mode} match`);
    return map;
  }

  /**
   * Get map by ID
   */
  getMap(id: string): MapConfig | undefined {
    return getMapById(id);
  }

  /**
   * Check if a map requires workshop download
   */
  isWorkshopMap(map: MapConfig): boolean {
    return isWorkshopMap(map);
  }

  /**
   * Update map pool for a mode
   */
  updateMapPool(mode: '1v1' | '2v2' | '3v3', mapIds: string[]): void {
    const existing = this.mapPools.get(mode);
    if (existing) {
      existing.maps = mapIds;
      this.logger.log(`Updated ${mode} map pool with ${mapIds.length} maps`);
    } else {
      this.mapPools.set(mode, {
        mode,
        maps: mapIds,
        selectionMode: 'random'
      });
      this.logger.log(`Created ${mode} map pool with ${mapIds.length} maps`);
    }
  }

  /**
   * Get workshop IDs for pre-caching
   * Returns all workshop map IDs that should be cached
   */
  getWorkshopIdsForCaching(): string[] {
    return MAPS
      .filter(m => isWorkshopMap(m))
      .map(m => m.workshopId);
  }

  /**
   * Get map configuration for orchestrator
   * Returns the necessary config to start a server with this map
   */
  getMapServerConfig(map: MapConfig): {
    mapId: string;
    workshopId?: string;
    gameMode: string;
    maxPlayers: number;
  } {
    return {
      mapId: map.id,
      workshopId: isWorkshopMap(map) ? map.workshopId : undefined,
      gameMode: map.gameMode,
      maxPlayers: map.maxPlayers
    };
  }
}
