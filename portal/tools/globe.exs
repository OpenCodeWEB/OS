#!/usr/bin/env elixir
# globe.exs — Haversine distance in Elixir (converted from TypeScript globe math)
#
# Run: elixir tools/globe.exs

defmodule Globe do
  @earth_radius_km 6371.0
  @deg_to_rad :math.pi() / 180.0

  @doc """
  Great-circle distance between two lat/lng points using Haversine formula.
  Converted from rswasm-globe-physics/src/lib.rs (TypeScript → Rust → Elixir)
  """
  def haversine_km(lat1, lng1, lat2, lng2) do
    dlat = (lat2 - lat1) * @deg_to_rad
    dlng = (lng2 - lng1) * @deg_to_rad
    sin_dlat = :math.sin(dlat / 2)
    sin_dlng = :math.sin(dlng / 2)
    cos_lat1 = :math.cos(lat1 * @deg_to_rad)
    cos_lat2 = :math.cos(lat2 * @deg_to_rad)

    h = sin_dlat * sin_dlat + cos_lat1 * cos_lat2 * sin_dlng * sin_dlng
    2.0 * @earth_radius_km * :math.asin(:math.sqrt(h))
  end

  @doc """
  Validate a project directory exists (mimics TypeScript ensurePRDDirectory).
  """
  def prd_directory_exists? do
    File.dir?("OpenCodeWEBsPRD")
  end
end

# ─── Main ────────────────────────────────────────────────

dist = Globe.haversine_km(37.77, -122.42, 40.71, -74.01)
ratio = dist / 4120.0
IO.puts("Elixir: SF → NYC = #{round(dist)} km")
IO.puts(if ratio > 0.95 and ratio < 1.05, do: "✅ Haversine test PASSED", else: "❌ Haversine test FAILED")
IO.puts("PRD directory exists: #{Globe.prd_directory_exists?()}")
IO.puts("Polyglot status: Elixir #27 in OpenCodeABs/UX")
