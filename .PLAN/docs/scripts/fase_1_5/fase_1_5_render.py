"""Fase 1.5 · Renders de comparación de materiales (solo lectura, no guarda).

Uso:
  blender.exe --background <fichero.blend> --python fase_1_5_render.py -- <carpeta_png> <etiqueta> [--wet]

Renderiza Whale_LOD0 en reposo (lateral, 3/4 y cabeza) con Eevee y luz de sol + cielo.
Con --wet sustituye la rugosidad por la del mapa de mojado (whale_wet_2k.png, canal R)
para previsualizar la piel mojada.
"""
import bpy
import math
import os
import sys
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1:]
OUT, TAG = args[:2]
WET = "--wet" in args
os.makedirs(OUT, exist_ok=True)
scene = bpy.context.scene
rig = bpy.data.objects["WhaleRig"]
body = bpy.data.objects["Whale_LOD0"]
rig.data.pose_position = "REST"
for o in scene.objects:
    if o.type == "MESH":
        o.hide_render = o is not body

if WET:
    mat = bpy.data.materials["Humpback"]
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    t = nt.nodes.new("ShaderNodeTexImage")
    img = bpy.data.images.load(bpy.path.abspath("//textures/gltf/whale_wet_2k.png"))
    img.colorspace_settings.name = "Non-Color"
    t.image = img
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(t.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Red"], bsdf.inputs["Roughness"])

cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
scene.collection.objects.link(cam)
scene.camera = cam
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
sun.data.energy = 5.0
sun.data.angle = math.radians(1.5)
sun.rotation_euler = (math.radians(40), 0, math.radians(-35))
scene.collection.objects.link(sun)
if scene.world is None:
    scene.world = bpy.data.worlds.new("World")
scene.world.use_nodes = True
bg = scene.world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.55, 0.68, 0.85, 1)  # cielo azulado, como en las referencias
bg.inputs[1].default_value = 0.9
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
scene.view_settings.view_transform = "AgX"
scene.render.image_settings.file_format = "PNG"


def look(center, direction, span=None, dist=None, lens=50):
    if dist:
        cam.data.type, cam.data.lens = "PERSP", lens
        cam.location = center + direction.normalized() * dist
    else:
        cam.data.type, cam.data.ortho_scale = "ORTHO", span
        cam.location = center + direction.normalized() * span * 3
    fwd = (center - cam.location).normalized()
    right = fwd.cross(Vector((0, 0, 1))).normalized()
    cam.rotation_euler = Matrix((right, right.cross(fwd), -fwd)).transposed().to_euler()
    cam.data.clip_start, cam.data.clip_end = 0.05, 200


for name, args_ in (("lateral", dict(center=Vector((0, 0.2, 0.45)), direction=Vector((1, 0, 0)), span=15.2)),
                    ("tres_cuartos", dict(center=Vector((0, 0.2, 0.3)), direction=Vector((1, -0.9, 0.55)), dist=17)),
                    ("cabeza", dict(center=Vector((0.9, -4.6, 0.4)), direction=Vector((1.0, -0.9, 0.5)), dist=6.5))):
    look(**args_)
    scene.render.filepath = os.path.join(OUT, f"{TAG}_{name}.png")
    bpy.ops.render.render(write_still=True)
    print("RENDER_OK", TAG, name)
