"""Exportación GLB de la ballena (preliminar de la Fase 1.8: texturas PNG, sin compresión).

Uso:
  blender.exe --background <Whale_opt.blend> --python export_glb.py -- <salida.glb>

Exporta WhaleRig + Whale_LOD0/1/2 con sus 7 acciones como clips, pesos de 4
influencias y `extras` (p. ej. `wet_map` del material de la piel). Copia también
el mapa de mojado junto al GLB. No guarda el .blend.
"""
import bpy
import os
import shutil
import sys

OUT = sys.argv[sys.argv.index("--") + 1]
os.makedirs(os.path.dirname(OUT), exist_ok=True)

rig = bpy.data.objects["WhaleRig"]
rig.data.pose_position = "POSE"
rig.animation_data.action = None
for t in rig.animation_data.nla_tracks:
    t.mute = False
bpy.context.scene.frame_set(0)
for o in bpy.data.objects:
    o.hide_set(False)
    o.hide_viewport = False

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_yup=True,
    export_apply=False,
    export_image_format="AUTO",
    export_materials="EXPORT",
    export_tangents=False,
    export_extras=True,
    export_skins=True,
    export_influence_nb=4,
    export_def_bones=False,
    export_leaf_bone=False,
    export_rest_position_armature=True,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_force_sampling=True,
    export_optimize_animation_size=True,
    export_anim_single_armature=True,
    export_cameras=False,
    export_lights=False,
)
wet = bpy.path.abspath("//textures/gltf/whale_wet_2k.png")
shutil.copy2(wet, os.path.join(os.path.dirname(OUT), "whale_wet_2k.png"))
print("EXPORT_OK", OUT, os.path.getsize(OUT))
