/** Aspecto de la ballena: mojado, normal map, AO, alambre y "barbs" (estado + apply para presets/URL). */
export function createWhaleLook(whale) {
  const skin = whale.materials.Humpback;
  const barbs = whale.materials.Barbs;
  const normalMaps = new Map(Object.values(whale.materials).map((m) => [m, m.normalMap]));
  const state = {
    wetness: 0,
    wetDarken: whale.uniforms.wetDarken.value,
    normalMap: true,
    normalScale: 1,
    aoIntensity: skin?.aoMapIntensity ?? 1,
    wireframe: false,
    barbs: true,
  };

  function apply() {
    whale.uniforms.wetness.value = state.wetness;
    whale.uniforms.wetDarken.value = state.wetDarken;
    for (const [m, map] of normalMaps) {
      const next = state.normalMap ? map : null;
      if (m.normalMap !== next) { m.normalMap = next; m.needsUpdate = true; }
      m.normalScale.set(state.normalScale, state.normalScale);
    }
    if (skin) skin.aoMapIntensity = state.aoIntensity;
    for (const m of Object.values(whale.materials)) m.wireframe = state.wireframe;
    if (barbs) whale.meshes.forEach((mesh) => { if (mesh.material === barbs) mesh.visible = state.barbs; });
  }
  apply();
  return { state, apply };
}
