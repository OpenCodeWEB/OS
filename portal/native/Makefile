# native/Makefile — C globe math build
#
# Targets:
#   make test      compile and run native test
#   make wasm      compile to WASM via Emscripten
#   make clean     remove build artifacts

CC      := gcc
EMCC    := emcc
CFLAGS  := -O3 -Wall -Wextra -pedantic -std=c99
WASM_FLAGS := -O3 -s WASM=1 -s EXPORTED_FUNCTIONS=@exports.json -s EXPORT_NAME="GlobeMath"

.PHONY: test wasm clean

test: globe_math.c globe_math.h
	$(CC) $(CFLAGS) -DTEST_GLOBE_MATH globe_math.c -o globe_test -lm
	./globe_test

wasm: globe_math.c globe_math.h exports.json
	$(EMCC) $(CFLAGS) $(WASM_FLAGS) globe_math.c -o globe_math.wasm

clean:
	rm -f globe_test globe_math.wasm globe_math.wasm.map
