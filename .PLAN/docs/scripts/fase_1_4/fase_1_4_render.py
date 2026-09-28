"""Fase 1.4 · Renders de control de los LODs (solo lectura, no guarda).

Uso:
  blender.exe --background <Whale_opt.blend> --python fase_1_4_render.py -- <carpeta_png> <Whale_bake_src.blend> <Whale_opt_f1_3.blend>

- lod{0,1,2}_lateral: LODs texturizados (Eevee).
- wire_lod{0,1,2}_cabeza: malla en alambre, primer plano de cabeza y pectoral.
- clay_*_cabeza: alta poligonal vs LOD0 sin / con el normal map entregado (material gris).
- cola_*: pose Swim2_Anim f45, malla base con pesos originales vs LOD0 con 4 influencias.
"""
import bpy
import math
import os
import sys
from mathutils import Matrix, Vector

OUT, BAKE_SRC, F13 = sys.argv[sys.argv.index("--") + 1:][:3]
os.makedirs(OUT, exist_ok=True)
scene = bpy.context.scene
rig = bpy.data.objects["WhaleRig"]
LODS = [bpy.data.objects[n] for n in ("Whale_LOD0", "Whale_LOD1", "Whale_LOD2")]

# ------------------------------------------------------------------ escena de render
cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
scene.collection.objects.link(cam)
scene.camera = cam
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
sun.data.energy = 4.0
sun.rotation_euler = (math.radians(35), 0, math.radians(-30))
scene.collection.objects.link(sun)
if scene.world is None:
    scene.world = bpy.data.worlds.new("World")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.75, 0.8, 0.86, 1)
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
scene.view_settings.view_transform = "AgX"
scene.render.image_settings.file_format = "PNG"


def look(center, direction, span=None, persp_dist=None, lens=50):
    if persp_dist:
        cam.data.type = "PERSP"
        cam.data.lens = lens
        cam.location = center + direction.normalized() * persp_dist
    else:
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = span
        cam.location = center + direction.normalized() * span * 3
    fwd = (center - cam.location).normalized()
    right = fwd.cross(Vector((0, 0, 1))).normalized()
    up = right.cross(fwd)
    cam.rotation_euler = Matrix((right, up, -fwd)).transposed().to_euler()
    cam.data.clip_start, cam.data.clip_end = 0.05, 200


def only(*objs):
    for o in scene.objects:
        if o.type == "MESH":
            o.hide_render = o not in objs


def shot(name, engine="BLENDER_EEVEE"):
    scene.render.engine = engine
    scene.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("RENDER_OK", name)


rig.data.pose_position = "REST"
rig.animation_data.action = None
for t in rig.animation_data.nla_tracks:
    t.mute = True
scene.frame_set(0)

# ------------------------------------------------------------------ A. LODs texturizados
for o in LODS:
    only(o)
    look(Vector((0, 0.2, 0.45)), Vector((1, 0, 0)), span=15.2)
    shot(f"lod{o.name[-1]}_lateral")

# ------------------------------------------------------------------ B. alambre (modificador Wireframe sobre una copia)
wire_mat = bpy.data.materials.new("WireBlack")
wire_mat.diffuse_color = (0.02, 0.02, 0.02, 1)
white = bpy.data.materials.new("White")
white.diffuse_color = (0.92, 0.92, 0.92, 1)
sh = scene.display.shading
sh.light, sh.color_type = "FLAT", "MATERIAL"
head_c, head_dir = Vector((0.9, -4.6, 0.4)), Vector((1.0, -0.9, 0.5))
for o in LODS:
    w = o.copy()
    w.data = o.data.copy()
    w.data.materials.clear()
    w.data.materials.append(wire_mat)
    scene.collection.objects.link(w)
    wm = w.modifiers.new("Wire", "WIREFRAME")
    wm.thickness = 0.006
    wm.use_replace = True
    s = o.copy()
    s.data = o.data.copy()
    s.data.materials.clear()
    s.data.materials.append(white)
    scene.collection.objects.link(s)
    only(w, s)
    look(head_c, head_dir, persp_dist=6.5, lens=50)
    shot(f"wire_lod{o.name[-1]}_cabeza", "BLENDER_WORKBENCH")

# ------------------------------------------------------------------ C. arcilla: alta vs LOD0 sin/con normal map
clay = bpy.data.materials.new("Clay")
clay.use_nodes = True
bsdf = clay.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.55, 0.55, 0.55, 1)
bsdf.inputs["Roughness"].default_value = 0.55
clay_n = clay.copy()
clay_n.name = "ClayNormal"
nt = clay_n.node_tree
tex = nt.nodes.new("ShaderNodeTexImage")
tex.image = bpy.data.images["skin_normal_2k"]
tex.image.colorspace_settings.name = "Non-Color"
nm = nt.nodes.new("ShaderNodeNormalMap")
nt.links.new(tex.outputs["Color"], nm.inputs["Color"])
nt.links.new(nm.outputs["Normal"], nt.nodes["Principled BSDF"].inputs["Normal"])

with bpy.data.libraries.load(BAKE_SRC, link=False) as (src, dst):
    dst.objects = ["Whale_HighPoly", "Tongue_HighPoly"]
for hp in dst.objects:
    scene.collection.objects.link(hp)
    hp.data.materials.clear()
    hp.data.materials.append(clay)

lod0 = LODS[0]
orig_mats = list(lod0.data.materials)
views = {"cabeza": (head_c, head_dir, 6.5), "pectoral": (Vector((1.6, -2.4, -0.3)), Vector((1.0, 0.3, -0.35)), 5.5)}
for vname, (c, d, dist) in views.items():
    only(*dst.objects)
    look(c, d, persp_dist=dist)
    shot(f"clay_alta_{vname}")
    for mat, tag in ((clay, "lod0_sin_normal"), (clay_n, "lod0_con_normal")):
        for i in range(len(lod0.data.materials)):
            lod0.data.materials[i] = mat
        only(lod0)
        look(c, d, persp_dist=dist)
        shot(f"clay_{tag}_{vname}")
for i, m in enumerate(orig_mats):
    lod0.data.materials[i] = m

# ------------------------------------------------------------------ D. cola: pesos originales vs 4 influencias
with bpy.data.libraries.load(F13, link=False) as (src, dst2):
    dst2.objects = ["Whale"]
base = dst2.objects[0]
scene.collection.objects.link(base)
base.parent = rig
for m in base.modifiers:
    if m.type == "ARMATURE":
        m.object = rig
    if m.type == "SUBSURF":
        m.levels = 1
rig.data.pose_position = "POSE"
act = bpy.data.actions["Swim2_Anim"]
rig.animation_data.action = act
if rig.animation_data.action_slot is None:
    rig.animation_data.action_slot = act.slots[0]
scene.frame_set(45)
# encuadre: caja de los vértices de la cola (y en reposo > 4,5 m) ya deformados
rest_y = [v.co.y for v in lod0.data.vertices]
dg = bpy.context.evaluated_depsgraph_get()
eo = lod0.evaluated_get(dg)
me = eo.to_mesh()
pts = [eo.matrix_world @ v.co for v, y in zip(me.vertices, rest_y) if y > 4.5]
eo.to_mesh_clear()
lo, hi = Vector(map(min, *pts)), Vector(map(max, *pts))
tail_c = (lo + hi) / 2
tail_span = max(hi - lo)
for o, tag in ((base, "pesos_originales"), (lod0, "lod0_4_influencias")):
    mats = list(o.data.materials)
    for i in range(len(mats)):
        o.data.materials[i] = clay
    only(o)
    look(tail_c, Vector((1, 0.15, 0.3)), persp_dist=tail_span * 1.9)
    shot(f"cola_swim2_f45_{tag}")
    for i, m in enumerate(mats):
        o.data.materials[i] = m
print("FASE_1_4_RENDER_OK")
