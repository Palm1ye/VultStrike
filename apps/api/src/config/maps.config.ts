/**
 * CS2 1v1 Map Configuration
 * Maps are downloaded from Steam Workshop
 */

export interface MapConfig {
  id: string;
  name: string;
  workshopId: string;
  gameMode: string;
  maxPlayers: number;
  type: '1v1' | '2v2' | '3v3' | 'all';
  description?: string;
  imageUrl?: string;
}

/**
 * Workshop map configurations
 * These maps will be automatically downloaded when the server starts
 */
export const MAPS: MapConfig[] = [
  {
    id: 'tirgo',
    name: 'Tirgo 1v1',
    workshopId: '3070897497',
    gameMode: '1v1',
    maxPlayers: 2,
    type: '1v1',
    description: 'Compact 1v1 arena with multiple levels',
  },
  {
    id: 'bluelines',
    name: 'Bluelines 1v1',
    workshopId: '3070210382',
    gameMode: '1v1',
    maxPlayers: 2,
    type: '1v1',
    description: 'Symmetrical 1v1 map with blue accents',
  },
  {
    id: 'newage',
    name: 'Newage 1v1',
    workshopId: '3070308285',
    gameMode: '1v1',
    maxPlayers: 2,
    type: '1v1',
    description: 'Modern 1v1 arena design',
  },
  {
    id: 'aim_simplev2textured',
    name: 'Aim Simple v2 Textured',
    workshopId: '3503792144',
    gameMode: '2v2',
    maxPlayers: 4,
    type: '2v2',
    description: 'Compact 2v2 aim map with textured layout',
  },
  // Fallback maps for other modes
  {
    id: 'de_dust2',
    name: 'Dust II',
    workshopId: '', // Official map, no workshop needed
    gameMode: 'competitive',
    maxPlayers: 10,
    type: 'all',
    description: 'Classic competitive map',
  },
  {
    id: 'de_mirage',
    name: 'Mirage',
    workshopId: '',
    gameMode: 'competitive',
    maxPlayers: 10,
    type: 'all',
    description: 'Popular competitive map',
  },
];

/**
 * Get maps by type
 */
export function getMapsByType(type: MapConfig['type']): MapConfig[] {
  return MAPS.filter(m => m.type === type || m.type === 'all');
}

/**
 * Get a random map for the given mode
 */
export function getRandomMap(mode: '1v1' | '2v2' | '3v3'): MapConfig {
  const eligibleMaps = MAPS.filter(m => 
    m.type === mode || m.type === 'all'
  );
  
  if (eligibleMaps.length === 0) {
    // Fallback to dust2 if no maps configured
    return MAPS.find(m => m.id === 'de_dust2')!;
  }
  
  const randomIndex = Math.floor(Math.random() * eligibleMaps.length);
  return eligibleMaps[randomIndex];
}

/**
 * Get map by ID
 */
export function getMapById(id: string): MapConfig | undefined {
  return MAPS.find(m => m.id === id);
}

/**
 * Check if map requires workshop download
 */
export function isWorkshopMap(map: MapConfig): boolean {
  return map.workshopId.length > 0;
}

/**
 * Get SteamCMD workshop download command
 */
export function getWorkshopDownloadCommand(workshopId: string): string {
  return `+workshop_download_item 730 ${workshopId}`;
}

/**
 * Get the map load command for server.cfg
 * For workshop maps: workshop/3070897497/tirgo
 * For official maps: de_dust2
 */
export function getMapLoadCommand(map: MapConfig): string {
  if (isWorkshopMap(map)) {
    return `workshop/${map.workshopId}/${map.id}`;
  }
  return map.id;
}
