(* globe.ml — Haversine distance in OCaml (converted from TypeScript globe math)
 *
 * Run: ocaml tools/globe.ml
 *)

let earth_radius_km = 6371.0
let deg_to_rad = 3.141592653589793 /. 180.0

let haversine_km lat1 lng1 lat2 lng2 =
  let dlat = (lat2 -. lat1) *. deg_to_rad in
  let dlng = (lng2 -. lng1) *. deg_to_rad in
  let sin_dlat = sin (dlat /. 2.0) in
  let sin_dlng = sin (dlng /. 2.0) in
  let cos_lat1 = cos (lat1 *. deg_to_rad) in
  let cos_lat2 = cos (lat2 *. deg_to_rad) in
  let h = sin_dlat *. sin_dlat +. cos_lat1 *. cos_lat2 *. sin_dlng *. sin_dlng in
  2.0 *. earth_radius_km *. asin (sqrt h)

(* Project file check — converted from TypeScript prd-orchestrator.ts *)
let check_project_root () =
  let markers = ["package.json"; ".git"; "conductor"] in
  let rec walk dir depth =
    if depth >= 10 then false
    else if List.exists (fun m -> Sys.file_exists (Filename.concat dir m)) markers then true
    else walk (Filename.dirname dir) (depth + 1)
  in
  walk (Sys.getcwd ()) 0

(* ─── Main ──────────────────────────────────────────── *)
let () =
  let dist = haversine_km 37.77 (-122.42) 40.71 (-74.01) in
  let ratio = dist /. 4120.0 in
  Printf.printf "OCaml: SF → NYC = %.0f km\n" dist;
  if ratio > 0.95 && ratio < 1.05 then
    print_endline "✅ Haversine test PASSED"
  else
    print_endline "❌ Haversine test FAILED";
  Printf.printf "Project root found: %b\n" (check_project_root ());
  print_endline "Polyglot status: OCaml #28 in OpenCodeABs/UX"
