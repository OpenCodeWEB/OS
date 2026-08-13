(* globe.pas — Haversine distance in Pascal (converted from TypeScript globe math)
 *
 * Compile & run: fpc tools/globe.pas && ./globe
 *)
program GlobeMath;

{$mode objfpc}{$H+}

uses
  Math, SysUtils;

const
  EarthRadiusKm = 6371.0;
  DegToRad = Pi / 180.0;

function HaversineKm(lat1, lng1, lat2, lng2: Double): Double;
var
  dlat, dlng, sinDlat, sinDlng, cosLat1, cosLat2, h: Double;
begin
  dlat := (lat2 - lat1) * DegToRad;
  dlng := (lng2 - lng1) * DegToRad;
  sinDlat := Sin(dlat / 2.0);
  sinDlng := Sin(dlng / 2.0);
  cosLat1 := Cos(lat1 * DegToRad);
  cosLat2 := Cos(lat2 * DegToRad);
  h := sinDlat * sinDlat + cosLat1 * cosLat2 * sinDlng * sinDlng;
  Result := 2.0 * EarthRadiusKm * ArcSin(Sqrt(h));
end;

(* Check directory exists — converted from TypeScript prd-orchestrator.ts *)
function PrdDirExists: Boolean;
begin
  Result := DirectoryExists('OpenCodeWEBsPRD');
end;

(* ─── Main ─────────────────────────────────────────────── *)
var
  dist, ratio: Double;
begin
  dist := HaversineKm(37.77, -122.42, 40.71, -74.01);
  ratio := dist / 4120.0;
  WriteLn(Format('Pascal: SF → NYC = %.0f km', [dist]));
  if (ratio > 0.95) and (ratio < 1.05) then
    WriteLn('✅ Haversine test PASSED')
  else
    WriteLn('❌ Haversine test FAILED');
  WriteLn('PRD dir exists: ', PrdDirExists);
  WriteLn('Polyglot status: Pascal #36 in OpenCodeABs/UX');
end.
