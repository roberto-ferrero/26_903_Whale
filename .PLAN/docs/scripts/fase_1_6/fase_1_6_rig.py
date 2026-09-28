"""Fase 1.6 · Revisión del rig y hueso raíz (punto de anclaje).

Uso:
  blender.exe --background <Whale_opt_f1_5.blend> --python fase_1_6_rig.py -- <salida.blend> <informe.json>

- Calcula el centro de masas de la piel (LOD0, volumen por tetraedros).
- Añade el hueso `Root` (no deformante) en el centro de masas, apuntando al morro,
  como padre de los huesos raíz actuales: será el punto de anclaje para mover y
  girar la ballena entera (trayectoria del salto en la 1.7, código en Three.js).
- Revisa: jerarquía, simetría izquierda/derecha, rango de movimiento de cada hueso
  en los 7 clips, pesos (máx. 4, suma 1) y que las animaciones no cambian.
"""
import bpy
import json
import math
import statistics as st
import sys
from mathutils import Vector

OUT, REPORT = sys.argv[sys.argv.index("--") + 1:][:2]
scene = bpy.context.scene
rig = bpy.data.objects["WhaleRig"]
lod0 = bpy.data.objects["Whale_LOD0"]
lods = [bpy.data.objects[n] for n in ("Whale_LOD0", "Whale_LOD1", "Whale_LOD2")]
rep = {}


def set_action(act):
    rig.animation_data.action = act
    if act is not None and rig.animation_data.action_slot is None:
        rig.animation_data.action_slot = act.slots[0]


def deformed(obj, samples):
    out = []
    for t in rig.animation_data.nla_tracks:
        t.mute = True
    for name, f in samples:
        set_action(bpy.data.actions[name])
        scene.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        eo = obj.evaluated_get(dg)
        me = eo.to_mesh()
        out.append([eo.matrix_world @ v.co for v in me.vertices])
        eo.to_mesh_clear()
    set_action(None)
    for t in rig.animation_data.nla_tracks:
        t.mute = False
    scene.frame_set(0)
    return out


SAMPLES = [("Swim1_Anim", 44), ("Swim2_Anim", 45), ("JumpRight_Anim", 87), ("JumpLeft_Anim", 107),
           ("JumpStraight_Anim", 90), ("MouthOpen_Anim", 40), ("Idle_Anim", 29)]
before = deformed(lod0, SAMPLES)

# ------------------------------------------------------------------ centro de masas (piel del LOD0, reposo)
me = lod0.data
skin_idx = [i for i, m in enumerate(me.materials) if m and m.name == "Humpback"]
me.calc_loop_triangles()
vol = 0.0
acc = Vector()
area_acc = Vector()
area = 0.0
for t in me.loop_triangles:
    if t.material_index not in skin_idx:
        continue
    a, b, c = (me.vertices[i].co for i in t.vertices)
    v = a.dot(b.cross(c)) / 6.0  # tetraedro con el origen
    vol += v
    acc += v * (a + b + c) / 4.0
    area += t.area
    area_acc += t.area * (a + b + c) / 3.0
com_volume = acc / vol if abs(vol) > 1e-6 else None
com_area = area_acc / area
com = com_volume if com_volume is not None else com_area
rep["center_of_mass"] = {"volume_m3": round(abs(vol), 3), "com_volume": [round(x, 3) for x in com_volume] if com_volume else None,
                         "com_area": [round(x, 3) for x in com_area], "used": [round(x, 3) for x in com],
                         "from_snout_pct": None}
ys = [v.co.y for v in me.vertices]
snout, tail = min(ys), max(ys)  # morro en −Y
rep["center_of_mass"]["from_snout_pct"] = round((com.y - snout) / (tail - snout) * 100, 1)

# ------------------------------------------------------------------ hueso Root
bpy.context.view_layer.objects.active = rig
for o in bpy.context.view_layer.objects:
    o.select_set(o is rig)
bpy.ops.object.mode_set(mode="EDIT")
eb = rig.data.edit_bones
if "Root" not in eb:
    old_roots = [b for b in eb if b.parent is None]
    root = eb.new("Root")
    root.head = com
    root.tail = com + Vector((0, -1.0, 0))  # eje Y del hueso hacia el morro
    root.roll = 0.0
    root.use_deform = False
    for b in old_roots:
        b.parent = root
        b.use_connect = False
    rep["root_added"] = {"children": [b.name for b in old_roots]}
bpy.ops.object.mode_set(mode="OBJECT")
rig.data.bones["Root"]["anchor"] = "centro de masas (piel LOD0, reposo)"
for coll in rig.data.collections_all:
    if coll.name == "Layer 1":
        coll.assign(rig.data.bones["Root"])

after = deformed(lod0, SAMPLES)
d = [(a - b).length for pa, pb in zip(after, before) for a, b in zip(pa, pb)]
rep["animation_change_after_root_mm"] = round(max(d) * 1000, 4)

# ------------------------------------------------------------------ jerarquía y cadenas


def chain(start, stop=None):
    names, b = [], rig.data.bones.get(start)
    while b:
        names.append(b.name)
        kids = [c for c in b.children if not c.name.startswith(("Fin", "Tail", "Tongue", "Eye", "Upper", "Lower"))]
        b = kids[0] if kids else None
    return names


bones = rig.data.bones
rep["bones"] = {"total": len(bones), "deform": sum(1 for b in bones if b.use_deform),
                "roots": [b.name for b in bones if b.parent is None]}
rep["spine_front"] = chain("Spine.003")
rep["spine_back"] = chain("MasterBone.006")
rep["spine_bones_total"] = 1 + len(rep["spine_front"]) + len(rep["spine_back"])  # + MasterBone

# simetría: posición de cada hueso .L frente a su .R reflejado en X
sym = {}
for b in bones:
    if ".L" in b.name:
        r = bones.get(b.name.replace(".L", ".R"))
        if r:
            m = Vector((-r.head_local.x, r.head_local.y, r.head_local.z))
            sym[b.name] = round((b.head_local - m).length * 1000, 2)
rep["symmetry_max_mm"] = max(sym.values()) if sym else None

# rango de movimiento por hueso en los 7 clips (ángulo máx. respecto al reposo y desplazamiento máx.)
motion = {b.name: {"rot_deg": 0.0, "loc_m": 0.0} for b in bones}
for t in rig.animation_data.nla_tracks:
    t.mute = True
for act in bpy.data.actions:
    set_action(act)
    f0, f1 = map(int, act.frame_range)
    for f in range(f0, f1 + 1, 2):
        scene.frame_set(f)
        for pb in rig.pose.bones:
            q = pb.rotation_quaternion
            ang = math.degrees(2 * math.acos(min(1.0, abs(q.w))))
            m = motion[pb.name]
            m["rot_deg"] = max(m["rot_deg"], ang)
            m["loc_m"] = max(m["loc_m"], pb.location.length)
set_action(None)
for t in rig.animation_data.nla_tracks:
    t.mute = False
scene.frame_set(0)
rep["motion_by_bone"] = {k: {"rot_deg": round(v["rot_deg"], 1), "loc_m": round(v["loc_m"], 3)} for k, v in motion.items()}
rep["static_bones"] = [k for k, v in motion.items() if v["rot_deg"] < 0.5 and v["loc_m"] < 0.001]

# pesos
for o in lods:
    counts = [sum(1 for g in v.groups if g.weight > 1e-4) for v in o.data.vertices]
    sums = [sum(g.weight for g in v.groups) for v in o.data.vertices]
    rep.setdefault("weights", {})[o.name] = {"max_influences": max(counts), "sum_min": round(min(sums), 4),
                                            "sum_max": round(max(sums), 4)}

for img in bpy.data.images:
    if img.source == "FILE" and "/gltf/" not in img.filepath.replace("\\", "/"):
        img.filepath = "//textures/" + img.filepath.replace("\\", "/").rsplit("/", 1)[-1]
bpy.ops.wm.save_as_mainfile(filepath=OUT, check_existing=False, relative_remap=False, compress=True)
with open(REPORT, "w", encoding="utf-8") as fh:
    json.dump(rep, fh, indent=1, ensure_ascii=False)
print("REPORT", json.dumps({k: v for k, v in rep.items() if k != "motion_by_bone"}, indent=1, ensure_ascii=False))
print("FASE_1_6_OK")
