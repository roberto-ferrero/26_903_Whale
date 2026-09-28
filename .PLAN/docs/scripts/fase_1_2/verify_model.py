"""Verificación de un .blend de la ballena (solo lectura, no guarda).

Uso:
  blender.exe --background <fichero.blend> --python verify_model.py -- <salida.json> <malla> <armature> [--render <carpeta_png>]

Vuelca: objetos, estadísticas de la malla, huesos, acciones, imágenes (existen/cargan)
y, por acción, la posición deformada de todos los vértices en varios fotogramas
(resumida en bbox + centroide + un muestreo de vértices) para comparar ficheros.
"""
import bpy
import json
import os
import sys
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
OUT, MESH, RIG = args[:3]
RENDER = args[args.index("--render") + 1] if "--render" in args else None
scene = bpy.context.scene
body = bpy.data.objects[MESH]
rig = bpy.data.objects[RIG]


def r(v, n=4):
    return round(float(v), n)


def deformed():
    dg = bpy.context.evaluated_depsgraph_get()
    eo = body.evaluated_get(dg)
    me = eo.to_mesh()
    pts = [eo.matrix_world @ v.co for v in me.vertices]
    eo.to_mesh_clear()
    lo = Vector(map(min, *pts))
    hi = Vector(map(max, *pts))
    c = sum(pts, Vector()) / len(pts)
    sample = [[r(x, 3) for x in pts[i]] for i in range(0, len(pts), max(1, len(pts) // 25))]
    return {"min": [r(x) for x in lo], "max": [r(x) for x in hi], "centroid": [r(x) for x in c], "sample": sample}


me = body.data
me.calc_loop_triangles()
infl = [sum(1 for g in v.groups if g.weight > 1e-4) for v in me.vertices]
images = []
for img in bpy.data.images:
    if img.source != "FILE":
        continue
    p = bpy.path.abspath(img.filepath)
    img.reload()
    images.append({"name": img.name, "filepath": img.filepath, "exists": os.path.exists(p),
                   "size": list(img.size), "loaded": img.has_data or img.size[0] > 0,
                   "colorspace": img.colorspace_settings.name})

rep = {
    "file": bpy.data.filepath,
    "objects": sorted((o.name, o.type) for o in bpy.data.objects),
    "mesh": {"vertices": len(me.vertices), "faces": len(me.polygons), "triangles": len(me.loop_triangles),
             "uv_layers": [u.name for u in me.uv_layers], "vertex_groups": len(body.vertex_groups),
             "materials": [m.name if m else None for m in me.materials], "max_influences": max(infl),
             "over_4": sum(1 for n in infl if n > 4),
             "modifiers": [(m.name, m.type) for m in body.modifiers]},
    "bones": len(rig.data.bones),
    "actions": {a.name: [r(a.frame_range[0], 1), r(a.frame_range[1], 1)] for a in bpy.data.actions},
    "nla_tracks": [[s.action.name for s in t.strips] for t in rig.animation_data.nla_tracks] if rig.animation_data else [],
    "images": images,
    "poses": {},
}

rig.data.pose_position = "REST"
scene.frame_set(0)
rep["poses"]["REST"] = deformed()
rig.data.pose_position = "POSE"
for t in rig.animation_data.nla_tracks:
    t.mute = True
for act in bpy.data.actions:
    if not act.name.endswith("_Anim"):
        continue
    rig.animation_data.action = act
    if rig.animation_data.action_slot is None:
        rig.animation_data.action_slot = act.slots[0]
    f0, f1 = map(int, act.frame_range)
    for f in sorted({f0, (f0 + f1) // 3, (f0 + f1) // 2, 87 if f1 >= 87 else f1, f1}):
        scene.frame_set(f)
        rep["poses"][f"{act.name}@{f}"] = deformed()

with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(rep, fh, indent=1, ensure_ascii=False)
print("VERIFY_OK", OUT)

if RENDER:
    import math
    os.makedirs(RENDER, exist_ok=True)
    for o in scene.objects:
        if o.type == "MESH" and o is not body:
            o.hide_render = True
        if o.type == "LIGHT":
            o.hide_render = True
    cam = bpy.data.objects.new("VerifyCam", bpy.data.cameras.new("VerifyCam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    sun = bpy.data.objects.new("VerifySun", bpy.data.lights.new("VerifySun", "SUN"))
    sun.data.energy = 4.0
    sun.rotation_euler = (math.radians(35), 0, math.radians(-30))
    scene.collection.objects.link(sun)
    if scene.world is None:
        scene.world = bpy.data.worlds.new("VerifyWorld")
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.75, 0.8, 0.86, 1)
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1600, 900
    scene.view_settings.view_transform = "AgX"

    def shoot(name, center, span):
        from mathutils import Matrix
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = span
        cam.location = center + Vector((span * 3, 0, 0))
        fwd = (center - cam.location).normalized()
        right = fwd.cross(Vector((0, 0, 1))).normalized()
        up = right.cross(fwd)
        cam.rotation_euler = Matrix((right, up, -fwd)).transposed().to_euler()
        cam.data.clip_end = span * 10
        scene.render.filepath = os.path.join(RENDER, name + ".png")
        bpy.ops.render.render(write_still=True)

    rig.animation_data.action = None
    rig.data.pose_position = "REST"
    scene.frame_set(0)
    p = rep["poses"]["REST"]
    lo, hi = Vector(p["min"]), Vector(p["max"])
    shoot("verify_rest_lateral", (lo + hi) / 2, (hi.y - lo.y) * 1.08)
    rig.data.pose_position = "POSE"
    act = bpy.data.actions.get("JumpRight_Anim")
    if act:
        rig.animation_data.action = act
        if rig.animation_data.action_slot is None:
            rig.animation_data.action_slot = act.slots[0]
        scene.frame_set(87)
        p = rep["poses"]["JumpRight_Anim@87"]
        lo, hi = Vector(p["min"]), Vector(p["max"])
        shoot("verify_jumpright_f087", (lo + hi) / 2, max(hi.y - lo.y, (hi.z - lo.z) * 16 / 9) * 1.15)
    print("RENDER_DONE")
