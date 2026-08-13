// ─── globe.vert — COBE Globe Vertex Shader ────────────────────────────────
//
// Transforms a unit-sphere vertex into clip space with a slight
// atmospheric "puff" effect that makes the globe appear slightly
// larger than its physical radius for a glow halo.
//
// Uniforms:
//   uModelViewMatrix  - combined model + view transform
//   uProjectionMatrix - perspective projection
//   uPuffAmount       - radial extrusion factor (0.0 = none, 0.02 = subtle)
//
// ──────────────────────────────────────────────────────────────────────────

precision highp float;

attribute vec3 aPosition;
attribute vec3 aNormal;

uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;
uniform float uPuffAmount;

varying vec3 vNormal;
varying vec3 vPosition; // view-space position for fragment shader

void main() {
    // Apply puff: push the vertex slightly along its normal
    vec3 pos = aPosition + aNormal * uPuffAmount;

    vec4 viewPos = uModelViewMatrix * vec4(pos, 1.0);
    vPosition = viewPos.xyz;
    vNormal = normalize(mat3(uModelViewMatrix) * aNormal);

    gl_Position = uProjectionMatrix * viewPos;
}
