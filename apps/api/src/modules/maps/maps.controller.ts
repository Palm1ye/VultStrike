import { Controller, Get, Param, Inject } from '@nestjs/common';
import { MapsService } from './maps.service';
import { MapConfig } from '../../config/maps.config';

@Controller('maps')
export class MapsController {
  constructor(@Inject(MapsService) private readonly mapsService: MapsService) {}

  /**
   * Get all available maps
   */
  @Get()
  getAllMaps(): MapConfig[] {
    return this.mapsService.getAllMaps();
  }

  /**
   * Get maps by type (1v1, 2v2, 3v3, all)
   */
  @Get('type/:type')
  getMapsByType(@Param('type') type: '1v1' | '2v2' | '3v3' | 'all'): MapConfig[] {
    return this.mapsService.getMapsByType(type);
  }

  /**
   * Get map pool for a specific mode
   */
  @Get('pool/:mode')
  getMapPool(@Param('mode') mode: '1v1' | '2v2' | '3v3'): { mode: string; maps: string[]; selectionMode: string } | undefined {
    return this.mapsService.getMapPool(mode);
  }

  /**
   * Get a specific map by ID
   */
  @Get(':id')
  getMap(@Param('id') id: string): MapConfig | undefined {
    return this.mapsService.getMap(id);
  }
}
