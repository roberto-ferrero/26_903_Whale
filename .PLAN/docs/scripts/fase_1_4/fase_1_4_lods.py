"""Fase 1.4 · Geometría: LODs, límite de influencias y medidas de calidad.

Uso:
  blender.exe --background <Whale_opt_f1_3.blend> --python fase_1_4_lods.py -- <salida.blend> <Whale_bake_src.blend> <informe.json>

- LOD0 = malla base con la subdivisión nivel 1 aplicada (≈ 39 k tris).
- LOD1 / LOD2 = LOD0 simplificado (decimate collapse) a ≈ 15 k / ≈ 5 k tris: misma
  forma límite y mismas UVs que LOD0 (comparten texturas y normal map).
- Pesos: limpieza (< 0,001), máx. 4 influencias y normalización en cada LOD.
- Mide: triángulos por material, influencias, distancia de cada LOD a LOD0 y de
  LOD0/base a la alta poligonal, y el error de deformación por limitar a 4 pesos.
La malla base no se borra del proceso: queda en la instantánea de la 1.3.
"""
import bpy
import bmesh
import json
import os
import statistics as st
import sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree

OUT, BAKE_SRC, REPORT = sys.argv[sys.argv.index("--") + 1:][:3]
TARGETS = {"Whale_LOD1": 15000, "Whale_LOD2": 5000}
scene = bpy.context.scene
rig = bpy.data.objects["WhaleRig"]
base = bpy.data.objects["Whale"]
rep = {}


def tris(obj):
    me = obj.data
    me.calc_loop_triangles()
    per_mat = {}
    for t in me.loop_triangles:
        name = me.materials[t.material_index].name if me.materials else "-"
        per_mat[name] = per_mat.get(name, 0) + 1
    return len(me.loop_triangles), per_mat


def influences(obj):
    counts = [sum(1 for g in v.groups if g.weight > 1e-4) for v in obj.data.vertices]
    sums = [sum(g.weight for g in v.groups) for v in obj.data.vertices]
    return {"max": max(counts), "over_4": sum(1 for c in counts if c > 4),
            "zero": sum(1 for c in counts if c == 0),
            "weight_sum_min": round(min(sums), 4), "weight_sum_max": round(max(sums), 4)}


def with_ctx(obj, op, **kw):
    with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj],
                                   selected_editable_objects=[obj]):
        return op(**kw)


def limit_weights(obj, max_n=4, min_w=0.001):
    """Deja como mucho max_n pesos por vértice (los mayores), quita los < min_w y normaliza a 1."""
    vgs = obj.vertex_groups
    for v in obj.data.vertices:
        ws = sorted(((g.group, g.weight) for g in v.groups), key=lambda t: -t[1])
        keep = [(i, w) for i, w in ws if w >= min_w][:max_n] or ws[:1]
        drop = {i for i, _ in ws} - {i for i, _ in keep}
        for i in drop:
            vgs[i].remove([v.index])
        total = sum(w for _, w in keep)
        for i, w in keep:
            vgs[i].add([v.index], w / total, "REPLACE")


def duplicate(src, name):
    o = src.copy()
    o.data = src.data.copy()
    o.name = o.data.name = name
    for c in src.users_collection:
        c.objects.link(o)
    o.parent = rig
    o.matrix_parent_inverse = src.matrix_parent_inverse.copy()
    return o


def bvh_of(obj, deform=False):
    if deform:
        dg = bpy.context.evaluated_depsgraph_get()
        eo = obj.evaluated_get(dg)
        me = eo.to_mesh()
        mw = eo.matrix_world
    else:
        me = obj.data
        mw = obj.matrix_world
    verts = [mw @ v.co for v in me.vertices]
    polys = [tuple(p.vertices) for p in me.polygons]
    bvh = BVHTree.FromPolygons(verts, polys)
    if deform:
        eo.to_mesh_clear()
    return bvh


def dist_stats(obj, bvh, material=None):
    d = []
    mw = obj.matrix_world
    me = obj.data
    only = None
    if material:
        mi = [i for i, m in enumerate(me.materials) if m and m.name == material]
        only = {vi for p in me.polygons if p.material_index in mi for vi in p.vertices}
    for v in me.vertices:
        if only is not None and v.index not in only:
            continue
        hit = bvh.find_nearest(mw @ v.co)
        if hit[0] is not None:
            d.append(hit[3])
    d.sort()
    return {"mean_mm": round(st.mean(d) * 1000, 2), "p95_mm": round(d[int(len(d) * 0.95)] * 1000, 2),
            "max_mm": round(d[-1] * 1000, 2)}


def deformed_positions(obj, samples):
    """Posiciones deformadas de todos los vértices para una lista de (acción, fotograma)."""
    out = []
    rig.data.pose_position = "POSE"
    for t in rig.animation_data.nla_tracks:
        t.mute = True
    for act_name, f in samples:
        act = bpy.data.actions[act_name]
        rig.animation_data.action = act
        if rig.animation_data.action_slot is None:
            rig.animation_data.action_slot = act.slots[0]
        scene.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        eo = obj.evaluated_get(dg)
        me = eo.to_mesh()
        out.append([eo.matrix_world @ v.co for v in me.vertices])
        eo.to_mesh_clear()
    rig.animation_data.action = None
    for t in rig.animation_data.nla_tracks:
        t.mute = False
    scene.frame_set(0)
    return out


rep["base"] = {"triangles": tris(base)[0], "influences": influences(base)}

# ------------------------------------------------------------------ LOD0: subdivisión nivel 1 aplicada
lod0 = duplicate(base, "Whale_LOD0")
sub = next(m for m in lod0.modifiers if m.type == "SUBSURF")
sub.levels = 1
sub.render_levels = 1
with_ctx(lod0, bpy.ops.object.modifier_move_to_index, modifier=sub.name, index=0)
with_ctx(lod0, bpy.ops.object.modifier_apply, modifier=sub.name)
rep["Whale_LOD0"] = {"triangles": tris(lod0)[0], "triangles_by_material": tris(lod0)[1],
                     "ngons": sum(1 for p in lod0.data.polygons if p.loop_total > 4),
                     "influences_before_limit": influences(lod0)}

# ------------------------------------------------------------------ LOD1 / LOD2: decimado desde LOD0
lods = {"Whale_LOD0": lod0}
t0 = rep["Whale_LOD0"]["triangles"]
for name, target in TARGETS.items():
    o = duplicate(lod0, name)
    dec = o.modifiers.new("Decimate", "DECIMATE")
    dec.decimate_type = "COLLAPSE"
    dec.ratio = target / t0
    dec.use_collapse_triangulate = True
    dec.use_symmetry = True
    dec.symmetry_axis = "X"
    with_ctx(o, bpy.ops.object.modifier_move_to_index, modifier=dec.name, index=0)
    with_ctx(o, bpy.ops.object.modifier_apply, modifier=dec.name)
    lods[name] = o
    rep[name] = {"target": target, "ratio": round(target / t0, 4),
                 "triangles": tris(o)[0], "triangles_by_material": tris(o)[1],
                 "influences_before_limit": influences(o)}

# ------------------------------------------------------------------ pesos: error de deformación al limitar a 4
SAMPLES = [("Swim1_Anim", 0), ("Swim1_Anim", 44), ("Swim2_Anim", 45), ("Idle_Anim", 29),
           ("JumpRight_Anim", 70), ("JumpRight_Anim", 87), ("JumpLeft_Anim", 107),
           ("JumpStraight_Anim", 90), ("MouthOpen_Anim", 40)]
before = deformed_positions(lod0, SAMPLES)
for name, o in lods.items():
    limit_weights(o, 4, 0.001)
    rep[name]["influences_after_limit"] = influences(o)
after = deformed_positions(lod0, SAMPLES)
errs = []
per_pose = {}
for (act, f), pb, pa in zip(SAMPLES, before, after):
    d = sorted((a - b).length for a, b in zip(pa, pb))
    per_pose[f"{act}@{f}"] = {"max_mm": round(d[-1] * 1000, 1), "p99_mm": round(d[int(len(d) * 0.99)] * 1000, 1)}
    errs += d
worst = sorted(range(len(before[0])), key=lambda i: -max((after[k][i] - before[k][i]).length for k in range(len(SAMPLES))))[:300]
dom = {}
for i in worst:
    g = max(lod0.data.vertices[i].groups, key=lambda g: g.weight)
    n = lod0.vertex_groups[g.group].name
    dom[n] = dom.get(n, 0) + 1
errs.sort()
rep["weight_limit_worst300_dominant_bone"] = dict(sorted(dom.items(), key=lambda t: -t[1]))
rep["weight_limit_deformation_error_LOD0"] = {
    "mean_mm": round(st.mean(errs) * 1000, 2), "p99_mm": round(errs[int(len(errs) * 0.99)] * 1000, 1),
    "max_mm": round(errs[-1] * 1000, 1), "per_pose": per_pose}

# ------------------------------------------------------------------ distancias de forma (reposo)
bvh0 = bvh_of(lod0)
for name in ("Whale_LOD1", "Whale_LOD2"):
    rep[name]["distance_to_LOD0"] = dist_stats(lods[name], bvh0)

# comparación con la alta poligonal (se añade temporalmente y se borra antes de guardar)
with bpy.data.libraries.load(BAKE_SRC, link=False) as (src, dst):
    dst.objects = ["Whale_HighPoly", "Tongue_HighPoly"]
hps = list(dst.objects)
_v, _p = [], []
for hp in hps:
    off = len(_v)
    _v += [hp.matrix_world @ v.co for v in hp.data.vertices]
    _p += [tuple(i + off for i in pl.vertices) for pl in hp.data.polygons]
bvh_hp = BVHTree.FromPolygons(_v, _p)
# solo la piel: las "barbs" y los ojos no existen en el esculpido
rep["distance_to_highpoly_skin"] = {"base_cage": dist_stats(base, bvh_hp, "Humpback"),
                                    "Whale_LOD0": dist_stats(lod0, bvh_hp, "Humpback"),
                                    "Whale_LOD1": dist_stats(lods["Whale_LOD1"], bvh_hp, "Humpback"),
                                    "Whale_LOD2": dist_stats(lods["Whale_LOD2"], bvh_hp, "Humpback")}
# vértices de piel del LOD0 más alejados del esculpido (para localizar diferencias)
far = []
for v in lod0.data.vertices:
    loc, _, _, dd = bvh_hp.find_nearest(lod0.matrix_world @ v.co)
    far.append((dd, tuple(round(x, 2) for x in lod0.matrix_world @ v.co)))
far.sort(reverse=True)
rep["LOD0_farthest_from_highpoly"] = [{"mm": round(dd * 1000), "pos": p} for dd, p in far[:12]]
for hp in hps:
    me_hp = hp.data
    bpy.data.objects.remove(hp)
    bpy.data.meshes.remove(me_hp)

# ------------------------------------------------------------------ guardar: los LODs sustituyen a la base
base_mesh = base.data
bpy.data.objects.remove(base)
if base_mesh.users == 0:
    bpy.data.meshes.remove(base_mesh)
lods["Whale_LOD1"].hide_viewport = lods["Whale_LOD2"].hide_viewport = False
bpy.data.orphans_purge(do_recursive=True)
for img in bpy.data.images:
    if img.source == "FILE":
        img.filepath = "//textures/" + img.filepath.replace("\\", "/").rsplit("/", 1)[-1]
bpy.ops.wm.save_as_mainfile(filepath=OUT, check_existing=False, relative_remap=False, compress=True)
with open(REPORT, "w", encoding="utf-8") as fh:
    json.dump(rep, fh, indent=1, ensure_ascii=False)
print("REPORT", json.dumps(rep, indent=1, ensure_ascii=False))
print("FASE_1_4_OK")
