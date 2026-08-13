/**
 * Type declarations for cities.json
 */
export interface CityRecord {
  id: string;
  label: string;
  lat: number;
  lng: number;
}

export interface ArcRecord {
  from: string;
  to: string;
}

export interface GlobeConfig {
  autoRotateSpeed: number;
  dragSensitivity: number;
  friction: number;
  velocityThreshold: number;
  maxGlobeSize: number;
  minGlobeSize: number;
  resolutionScale: number;
  theta: number;
  dark: number;
  diffuse: number;
  mapSamples: number;
  mapBrightness: number;
  markerSize: number;
  selfMarkerSize: number;
  peerMarkerSize: number;
  arcWidth: number;
  arcHeight: number;
  markerElevation: number;
}

export interface ColorPalette {
  base: [number, number, number];
  marker: [number, number, number];
  glow: [number, number, number];
  arc: [number, number, number];
  self: [number, number, number];
  peerArc: [number, number, number];
}

export interface CityDataFile {
  cities: CityRecord[];
  arcs: ArcRecord[];
  globe: GlobeConfig;
  colors: ColorPalette;
}

declare const data: CityDataFile;
export default data;
