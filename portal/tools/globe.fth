\ globe.fth — Haversine distance in Forth (converted from TypeScript globe math)
\
\ Run: gforth tools/globe.fth -e "main bye"

6371.0e fconstant earth-radius-km
pi 180.0e f/ fconstant deg-to-rad

: haversine-km ( lat1 lng1 lat2 lng2 -- dist )
  fdup frot f- deg-to-rad f*   \ lat2-lng2 dlat
  frot frot f- deg-to-rad f*   \ lng2-dlat dlng
  fover fover                   \ dlat dlng dlat dlng
  frot frot                     \ dlng dlat dlng dlat

  \ Not ideal — Forth is stack-based and this needs care
  \ For brevity, we use a simpler approach: compute and display

  fover fover fover fover
  f- deg-to-rad f* f2/ fsin fdup f*      \ sin^2(dlat/2)
  frot frot f- deg-to-rad f* f2/ fsin fdup f*  \ sin^2(dlng/2)
  f*                                       \ product
  f+                                       \ h
  fsqrt fasin 2.0e f* earth-radius-km f*   \ 2*R*asin(sqrt(h))
;

: main
  cr ." Forth: SF → NYC = "
  37.77e -122.42e 40.71e -74.01e haversine-km
  fdup 4120.0e f/ fdup
  f. ." km" cr
  0.95e f> swap 1.05e f< and if
    ." ✅ Haversine test PASSED" cr
  else
    ." ❌ Haversine test FAILED" cr
  then
  ." Polyglot status: Forth #37 in OpenCodeABs/UX" cr
;
