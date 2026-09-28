"""Fase 1.3 · Escala la fuente de horneado (alta poligonal) con el mismo factor que Whale_opt.

Uso:
  blender.exe --background <Whale_bake_src_f1_2.blend> --python fase_1_3_escala_bake_src.py -- <salida.blend> <factor>

Escala respecto al origen del mundo (igual que la malla de juego): posición de cada
objeto y sus vértices, sin dejar escala en los objetos.
"""
import bpy
import sys
from mathutils import Matrix

OUT, FACTOR = sys.argv[sys.argv.index("--") + 1:][:2]
f = float(FACTOR)
S = Matrix.Scale(f, 4)
for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    assert all(abs(s - 1) < 1e-6 for s in o.scale) and o.rotation_euler.to_quaternion().angle < 1e-6, o.name
    o.location = o.location * f
    o.data.transform(S)
    print("SCALED", o.name, tuple(round(x, 3) for x in o.dimensions))
bpy.ops.wm.save_as_mainfile(filepath=OUT, check_existing=False, compress=True)
print("BAKE_SRC_OK")
