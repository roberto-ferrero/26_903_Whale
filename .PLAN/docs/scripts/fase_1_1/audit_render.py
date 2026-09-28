"""Fase 1.1 · Auditoría: renders en pose de reposo con texturas y análisis de animaciones.

Uso:
  blender.exe --background <Whale.blend> --python audit_render.py -- <carpeta_salida> <carpeta_texturas>

Todo se hace en memoria (rutas de imagen reasignadas, pose, cámara); el .blend
original NO se guarda. Escribe <salida>/anim.json y PNGs.
"""
import bpy
import json
import math
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
OUT, TEX = argv[0], argv[1]
os.makedirs(OUT, exist_ok=True)

scene = bpy.context.scene
RIG = bpy.data.objects["HumpbackRig(bakeanimationshere)"]
BODY = bpy.data.objects["HumpbackWhale"]

# ------------------------------------------------------------ texturas: reasignar a la carpeta entregada
by_name = {}
for root, _, files in os.walk(TEX):
    for f in files:
        by_name.setdefault(f.lower(), []).append(os.path.join(root, f))


def pick(fname, hint):
    cands = by_name.get(fname.lower(), [])
    for c in cands:
        if all(h.lower() in c.lower() for h in hint):
            return c
    return cands[0] if cands else None


remap = {}
for img in bpy.data.images:
    base = os.path.basename(img.filepath.replace("\\", "/"))
    new = None
    if "NoJawBarnacles" in img.filepath:
        new = pick(base, ["WithJawBarnacles", "2kText"]) or pick(base, ["NoJawBarnacles", "2kText"])
        if base.lower() == "aomap.png":
            new = pick("Ambient.png", ["WithJawBarnacles", "2kText"]) or new
    elif "BarbsTexture" in img.filepath:
        new = pick(base, ["BarbsTexture"])
    elif base.lower() == "image (3).png":  # rugosidad perdida -> DryRoughness
        new = pick("DryRoughness.png", ["2kText"])
    if new:
        img.filepath = new
        img.reload()
        remap[img.name] = new
print("REMAP", json.dumps(remap, indent=1))

# ------------------------------------------------------------ utilidades


def eval_bbox(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    eo = obj.evaluated_get(dg)
    me = eo.to_mesh()
    mw = eo.matrix_world
    pts = [mw @ v.co for v in me.vertices]
    eo.to_mesh_clear()
    lo = Vector(map(min, *pts))
    hi = Vector(map(max, *pts))
    return lo, hi


def mute_nla(obj, mute=True):
    ad = obj.animation_data
    if ad:
        for t in ad.nla_tracks:
            t.mute = mute


def r(v, n=3):
    return round(float(v), n)


# ------------------------------------------------------------ pose de reposo
mute_nla(RIG)
RIG.animation_data.action = None
RIG.data.pose_position = "REST"
scene.frame_set(0)
lo, hi = eval_bbox(BODY)
rest = {"bbox_min": [r(x) for x in lo], "bbox_max": [r(x) for x in hi], "size": [r(x) for x in hi - lo]}

# medidas por grupos de vértices en reposo (peso > 0.3)
groups = {g.index: g.name for g in BODY.vertex_groups}
acc = {}
for v in BODY.data.vertices:
    for g in v.groups:
        if g.weight > 0.3:
            acc.setdefault(groups[g.group], []).append(BODY.matrix_world @ v.co)


def extent(prefixes):
    ps = [p for k, v in acc.items() if any(k.startswith(x) for x in prefixes) for p in v]
    if not ps:
        return None
    a = Vector(map(min, *ps))
    b = Vector(map(max, *ps))
    return {"min": [r(x) for x in a], "max": [r(x) for x in b], "size": [r(x) for x in b - a]}


def chain_len(names):
    return r(sum(RIG.data.bones[n].length for n in names if n in RIG.data.bones))


fin_chain = ["Fin.L", "Fin.L.001", "Fin.L.002", "Fin.L.003", "Fin.L.004", "Fin.L.005"]
measures = {
    "body_length_Y": r(hi.y - lo.y),
    "max_width_X_incl_fins": r(hi.x - lo.x),
    "height_Z": r(hi.z - lo.z),
    "pectoral_L_extent": extent(["Fin.L"]),
    "pectoral_R_extent": extent(["Fin.R"]),
    "pectoral_bone_chain_length": chain_len(fin_chain),
    "fluke_extent": extent(["Tail.L", "Tail.R"]),
    "head_extent": extent(["Head", "UpperJaw", "LowerJaw"]),
    "eye_L_head_world": [r(x) for x in RIG.matrix_world @ RIG.data.bones["Eye.L"].head_local],
    "head_bone_head_world": [r(x) for x in RIG.matrix_world @ RIG.data.bones["Head"].head_local],
    "tail_bone_tail_world": [r(x) for x in RIG.matrix_world @ RIG.data.bones["Tail.L.004"].tail_local],
}

# ------------------------------------------------------------ renders en reposo
for o in scene.objects:
    if o.type == "MESH" and o is not BODY:
        o.hide_render = True
for o in scene.objects:
    if o.type == "LIGHT":
        o.hide_render = True

cam_data = bpy.data.cameras.new("AuditCam")
cam = bpy.data.objects.new("AuditCam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
sun_data = bpy.data.lights.new("AuditSun", "SUN")
sun_data.energy = 4.0
sun = bpy.data.objects.new("AuditSun", sun_data)
scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(35), 0, math.radians(-30))

if scene.world is None:
    scene.world = bpy.data.worlds.new("AuditWorld")
scene.world.use_nodes = True
bg = scene.world.node_tree.nodes.get("Background")
if bg:
    bg.inputs[0].default_value = (0.75, 0.8, 0.86, 1)
    bg.inputs[1].default_value = 1.0

scene.render.resolution_x = 1600
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = "AgX" if "AgX" in [i.name for i in type(scene.view_settings).bl_rna.properties["view_transform"].enum_items] else "Standard"


def shoot(path, center, direction, span, ortho=True, up_hint="Z"):
    cam_data.type = "ORTHO" if ortho else "PERSP"
    dist = span * 3
    if ortho:
        cam_data.ortho_scale = span
    else:
        cam_data.lens = 45
        dist = span * 1.25
    cam.location = center + direction.normalized() * dist
    # look-at con vector "arriba" del mundo (Z) o, en vistas cenitales, +X/-Y
    world_up = {"Z": Vector((0, 0, 1)), "X": Vector((-1, 0, 0))}[up_hint]
    fwd = (center - cam.location).normalized()
    right = fwd.cross(world_up).normalized()
    up = right.cross(fwd)
    from mathutils import Matrix
    rot = Matrix((right, up, -fwd)).transposed()
    cam.rotation_euler = rot.to_euler()
    cam_data.clip_start = 0.1
    cam_data.clip_end = dist * 4
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("RENDER_OK", path)


center = (lo + hi) / 2
L = hi.y - lo.y
# el morro está en -Y (ojos y barbas en Y negativa); lateral = mirar desde +X hacia -X con la cabeza a la izquierda
views = [
    ("lateral", Vector((1, 0, 0)), L * 1.08, True, "Z"),
    ("superior", Vector((0, 0, 1)), L * 1.08, True, "X"),
    ("inferior", Vector((0, 0, -1)), L * 1.08, True, "X"),
    ("frontal", Vector((0, -1, 0)), (hi.x - lo.x) * 1.15, True, "Z"),
    ("tres_cuartos", Vector((1.0, -0.9, 0.55)), L, False, "Z"),
]

for eng, tag in (("BLENDER_EEVEE", "eevee"),):
    scene.render.engine = eng
    for name, d, span, ortho, up in views:
        shoot(os.path.join(OUT, f"rest_{tag}_{name}.png"), center, d, span, ortho, up)

# ------------------------------------------------------------ animaciones (rig horneado)
RIG.data.pose_position = "POSE"
anim = {}
root = RIG.pose.bones["MasterBone"]
head = RIG.pose.bones["Head"]
for act in bpy.data.actions:
    if not act.name.endswith("_Anim") and act.name != "RestPosee":
        continue
    RIG.animation_data.action = act
    if getattr(RIG.animation_data, 'action_slot', 1) is None and len(act.slots):
        RIG.animation_data.action_slot = act.slots[0]
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    samples = []
    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        rp = RIG.matrix_world @ root.head
        hp = RIG.matrix_world @ head.head
        samples.append((f, rp.copy(), hp.copy()))
    zs = [s[1].z for s in samples]
    ys = [s[1].y for s in samples]
    xs = [s[1].x for s in samples]
    hz = [s[2].z for s in samples]
    # bbox deformado en algunos fotogramas
    frames_bbox = {}
    for f in sorted(set([f0, (f0 + f1) // 4, (f0 + f1) // 2, 3 * (f0 + f1) // 4, f1] + [samples[max(range(len(hz)), key=lambda i: hz[i])][0]])):
        scene.frame_set(f)
        a, b = eval_bbox(BODY)
        frames_bbox[f] = {"min_z": r(a.z), "max_z": r(b.z), "min_y": r(a.y), "max_y": r(b.y)}
    scene.frame_set(f0)
    pose0 = [(pb.name, tuple(round(x, 4) for x in pb.matrix_basis.to_translation()),
              tuple(round(x, 4) for x in pb.matrix_basis.to_quaternion())) for pb in RIG.pose.bones]
    scene.frame_set(f1)
    pose1 = [(pb.name, tuple(round(x, 4) for x in pb.matrix_basis.to_translation()),
              tuple(round(x, 4) for x in pb.matrix_basis.to_quaternion())) for pb in RIG.pose.bones]
    diff = 0.0
    for (n0, t0, q0), (_, t1, q1) in zip(pose0, pose1):
        diff = max(diff, max(abs(a - b) for a, b in zip(t0 + q0, t1 + q1)))
    anim[act.name] = {
        "frames": [f0, f1], "seconds_at_fps": r((f1 - f0) / scene.render.fps, 2),
        "root_x_range": [r(min(xs)), r(max(xs))],
        "root_y_range": [r(min(ys)), r(max(ys))],
        "root_z_range": [r(min(zs)), r(max(zs))],
        "root_travel_m": r((samples[-1][1] - samples[0][1]).length),
        "head_z_max": r(max(hz)), "head_z_max_frame": samples[max(range(len(hz)), key=lambda i: hz[i])][0],
        "deformed_bbox_by_frame": frames_bbox,
        "loop_max_pose_diff_first_last": r(diff, 4),
    }

# tira de fotogramas del salto recto, vista lateral fija
water_z = bpy.data.objects["Water"].location.z if "Water" in bpy.data.objects else 0.0
for act_name in ("JumpStraight_Anim", "Swim1_Anim"):
    if act_name not in bpy.data.actions:
        continue
    act = bpy.data.actions[act_name]
    RIG.animation_data.action = act
    if getattr(RIG.animation_data, 'action_slot', 1) is None and len(act.slots):
        RIG.animation_data.action_slot = act.slots[0]
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    # encuadre común para todo el clip
    los, his = [], []
    for f in range(f0, f1 + 1, 10):
        scene.frame_set(f)
        a, b = eval_bbox(BODY)
        los.append(a)
        his.append(b)
    a = Vector(map(min, *los))
    b = Vector(map(max, *his))
    c = (a + b) / 2
    span = max(b.y - a.y, (b.z - a.z) * 16 / 9) * 1.1
    n = 6
    for i in range(n):
        f = round(f0 + (f1 - f0) * i / (n - 1))
        scene.frame_set(f)
        shoot(os.path.join(OUT, f"anim_{act_name}_{i}_f{f:03d}.png"), c, Vector((1, 0, 0)), span, True, "Z")

report = {"texture_remap": remap, "rest_bbox": rest, "measures_rest_m": measures,
          "water_plane_z": r(water_z), "fps": scene.render.fps, "animations": anim}
with open(os.path.join(OUT, "anim.json"), "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2, ensure_ascii=False)
print("ANIM_JSON_OK")
