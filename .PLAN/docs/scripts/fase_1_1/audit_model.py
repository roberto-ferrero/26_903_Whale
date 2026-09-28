"""Fase 1.1 · Auditoría del modelo descargado (solo lectura).

Uso:
  blender.exe --background <Whale.blend> --python audit_model.py -- <carpeta_salida>

Vuelca <carpeta_salida>/audit.json y renders de previsualización
(lateral, superior, frontal, 3/4) en PNG. No guarda el .blend.
"""
import bpy
import json
import math
import os
import sys
from collections import Counter, defaultdict
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.path.dirname(bpy.data.filepath), "auditoria")
os.makedirs(OUT, exist_ok=True)


def r(v, n=4):
    return round(float(v), n)


def vec(v, n=4):
    return [r(x, n) for x in v]


def world_bbox(objs):
    lo = Vector((1e18, 1e18, 1e18))
    hi = Vector((-1e18, -1e18, -1e18))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


# ---------------------------------------------------------------- escena
scene = bpy.context.scene
us = scene.unit_settings
report = {
    "blend_file": bpy.data.filepath,
    "blender_version": bpy.app.version_string,
    "file_saved_with": ".".join(map(str, bpy.data.version)),
    "scene": {
        "name": scene.name,
        "unit_system": us.system,
        "scale_length": r(us.scale_length, 6),
        "length_unit": us.length_unit,
        "fps": scene.render.fps,
        "fps_base": r(scene.render.fps_base, 4),
        "frame_start": scene.frame_start,
        "frame_end": scene.frame_end,
        "render_engine": scene.render.engine,
        "scenes_in_file": [s.name for s in bpy.data.scenes],
    },
    "collections": {c.name: [o.name for o in c.objects] for c in bpy.data.collections},
}

# ---------------------------------------------------------------- objetos
report["objects"] = []
for o in bpy.data.objects:
    report["objects"].append({
        "name": o.name,
        "type": o.type,
        "data": o.data.name if o.data else None,
        "parent": o.parent.name if o.parent else None,
        "parent_type": o.parent_type if o.parent else None,
        "parent_bone": o.parent_bone or None,
        "location": vec(o.location),
        "rotation_euler_deg": [r(math.degrees(a), 3) for a in o.rotation_euler],
        "rotation_mode": o.rotation_mode,
        "scale": vec(o.scale),
        "dimensions_world": vec(o.dimensions),
        "hide_viewport": o.hide_viewport,
        "hide_render": o.hide_render,
        "visible": o.visible_get() if o.name in bpy.context.view_layer.objects else False,
        "in_view_layer": o.name in bpy.context.view_layer.objects,
        "users_collection": [c.name for c in o.users_collection],
        "animation_data_action": (o.animation_data.action.name
                                  if o.animation_data and o.animation_data.action else None),
    })

# ---------------------------------------------------------------- mallas
depsgraph = bpy.context.evaluated_depsgraph_get()
report["meshes"] = []
for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    me = o.data
    me.calc_loop_triangles()
    tris = len(me.loop_triangles)
    ngons = sum(1 for p in me.polygons if p.loop_total > 4)
    quads = sum(1 for p in me.polygons if p.loop_total == 4)
    # triángulos tras modificadores (lo que se exportaría)
    try:
        eo = o.evaluated_get(depsgraph)
        em = eo.to_mesh()
        em.calc_loop_triangles()
        tris_eval = len(em.loop_triangles)
        verts_eval = len(em.vertices)
        eo.to_mesh_clear()
    except Exception as e:  # noqa
        tris_eval = verts_eval = None

    # influencias por vértice
    infl = Counter()
    zero_w = 0
    for v in me.vertices:
        n = sum(1 for g in v.groups if g.weight > 1e-4)
        infl[n] += 1
        if n == 0:
            zero_w += 1
    group_names = [g.name for g in o.vertex_groups]

    arm_mods = [m for m in o.modifiers if m.type == "ARMATURE"]
    bone_names = set()
    for m in arm_mods:
        if m.object and m.object.type == "ARMATURE":
            bone_names |= {b.name for b in m.object.data.bones}
    lo, hi = world_bbox([o])
    size = hi - lo
    axis_order = sorted(zip("XYZ", size), key=lambda t: -t[1])

    report["meshes"].append({
        "object": o.name,
        "mesh": me.name,
        "vertices": len(me.vertices),
        "edges": len(me.edges),
        "faces": len(me.polygons),
        "quads": quads,
        "ngons": ngons,
        "triangles": tris,
        "triangles_after_modifiers": tris_eval,
        "vertices_after_modifiers": verts_eval,
        "uv_layers": [{"name": u.name, "active_render": u.active_render} for u in me.uv_layers],
        "color_attributes": [c.name for c in me.color_attributes],
        "attributes": sorted(a.name for a in me.attributes if not a.name.startswith(".")),
        "shade_smooth_faces": sum(1 for p in me.polygons if p.use_smooth),
        "modifiers": [{
            "name": m.name, "type": m.type,
            "show_viewport": m.show_viewport, "show_render": m.show_render,
            **({"object": m.object.name if m.object else None} if hasattr(m, "object") else {}),
            **({"levels": m.levels, "render_levels": m.render_levels} if m.type == "SUBSURF" else {}),
            **({"ratio": r(m.ratio, 4)} if m.type == "DECIMATE" else {}),
        } for m in o.modifiers],
        "vertex_groups": len(group_names),
        "vertex_group_names": group_names,
        "vertex_groups_without_bone": sorted(set(group_names) - bone_names) if bone_names else None,
        "influences_histogram": {str(k): v for k, v in sorted(infl.items())},
        "max_influences": max(infl) if infl else 0,
        "vertices_over_4_influences": sum(v for k, v in infl.items() if k > 4),
        "vertices_without_weights": zero_w,
        "shape_keys": ([k.name for k in me.shape_keys.key_blocks] if me.shape_keys else []),
        "materials": [s.material.name if s.material else None for s in o.material_slots],
        "world_bbox_min_m": vec(lo * us.scale_length),
        "world_bbox_max_m": vec(hi * us.scale_length),
        "world_size_m": vec(size * us.scale_length),
        "longest_axis": axis_order[0][0],
        "axis_order_by_size": [a for a, _ in axis_order],
    })

# ---------------------------------------------------------------- materiales
report["materials"] = []
for m in bpy.data.materials:
    entry = {"name": m.name, "users": m.users, "use_nodes": m.use_nodes,
             "blend_method": getattr(m, "blend_method", None),
             "surface_render_method": getattr(m, "surface_render_method", None),
             "nodes": [], "links": []}
    if m.use_nodes and m.node_tree:
        for n in m.node_tree.nodes:
            nd = {"name": n.name, "type": n.bl_idname}
            if n.bl_idname == "ShaderNodeTexImage":
                nd["image"] = n.image.name if n.image else None
                nd["colorspace"] = n.image.colorspace_settings.name if n.image else None
            if n.bl_idname == "ShaderNodeBsdfPrincipled":
                vals = {}
                for s in n.inputs:
                    if not s.is_linked and hasattr(s, "default_value"):
                        dv = s.default_value
                        try:
                            vals[s.name] = r(dv) if isinstance(dv, float) else vec(dv)
                        except TypeError:
                            pass
                nd["unlinked_inputs"] = vals
            entry["nodes"].append(nd)
        for l in m.node_tree.links:
            entry["links"].append(f"{l.from_node.name}.{l.from_socket.name} -> {l.to_node.name}.{l.to_socket.name}")
    report["materials"].append(entry)

# ---------------------------------------------------------------- imágenes
report["images"] = []
for img in bpy.data.images:
    fp = img.filepath
    absfp = bpy.path.abspath(fp) if fp else ""
    report["images"].append({
        "name": img.name,
        "source": img.source,
        "filepath": fp,
        "abs_path": absfp,
        "exists_on_disk": os.path.exists(absfp) if absfp else False,
        "packed": img.packed_file is not None,
        "packed_size_bytes": img.packed_file.size if img.packed_file else 0,
        "size": list(img.size),
        "colorspace": img.colorspace_settings.name,
        "users": img.users,
        "has_data": img.has_data,
    })

# ---------------------------------------------------------------- armatures
report["armatures"] = []
for o in bpy.data.objects:
    if o.type != "ARMATURE":
        continue
    arm = o.data

    def tree(b):
        return {"name": b.name, "length_m": r(b.length * o.scale.x * us.scale_length),
                "deform": b.use_deform, "connected": b.use_connect,
                "children": [tree(c) for c in b.children]}

    roots = [b for b in arm.bones if b.parent is None]
    constraints = {pb.name: [c.type for c in pb.constraints] for pb in o.pose.bones if pb.constraints}
    report["armatures"].append({
        "object": o.name,
        "armature": arm.name,
        "bones": len(arm.bones),
        "deform_bones": sum(1 for b in arm.bones if b.use_deform),
        "pose_position": arm.pose_position,
        "display_type": arm.display_type,
        "bone_names": [b.name for b in arm.bones],
        "bone_heads_world_m": {b.name: vec((o.matrix_world @ b.head_local) * us.scale_length, 3) for b in arm.bones},
        "bone_tails_world_m": {b.name: vec((o.matrix_world @ b.tail_local) * us.scale_length, 3) for b in arm.bones},
        "hierarchy": [tree(b) for b in roots],
        "pose_constraints": constraints,
        "bone_collections": [c.name for c in getattr(arm, "collections_all", [])],
        "skinned_meshes": [m.name for m in bpy.data.objects if m.type == "MESH" and any(
            md.type == "ARMATURE" and md.object == o for md in m.modifiers)],
    })

# ---------------------------------------------------------------- acciones


def action_fcurves(act):
    """Compatible con acciones clásicas y con acciones por capas (Blender 4.4+/5.x)."""
    curves = []
    if hasattr(act, "layers") and len(getattr(act, "layers", [])):
        for layer in act.layers:
            for strip in layer.strips:
                for slot in act.slots:
                    cb = strip.channelbag(slot) if hasattr(strip, "channelbag") else None
                    if cb:
                        curves += list(cb.fcurves)
    elif hasattr(act, "fcurves"):
        curves = list(act.fcurves)
    return curves


report["actions"] = []
for act in bpy.data.actions:
    fcs = action_fcurves(act)
    bones = Counter()
    props = Counter()
    keys = 0
    for fc in fcs:
        dp = fc.data_path
        keys += len(fc.keyframe_points)
        if dp.startswith('pose.bones["'):
            bname = dp.split('"')[1]
            bones[bname] += 1
            props[dp.rsplit(".", 1)[-1]] += 1
        else:
            props[dp] += 1
    report["actions"].append({
        "name": act.name,
        "users": act.users,
        "fake_user": act.use_fake_user,
        "frame_range": vec(act.frame_range, 2),
        "manual_frame_range": getattr(act, "use_frame_range", False),
        "fcurves": len(fcs),
        "keyframes": keys,
        "animated_bones": len(bones),
        "animated_bone_names": sorted(bones),
        "channel_types": dict(props),
        "slots": [s.identifier for s in getattr(act, "slots", [])],
        "pose_markers": [{"name": m.name, "frame": m.frame} for m in act.pose_markers],
        "cyclic_curves": sum(1 for fc in fcs if any(m.type == "CYCLES" for m in fc.modifiers)),
    })

report["nla"] = []
for o in bpy.data.objects:
    ad = o.animation_data
    if not ad:
        continue
    report["nla"].append({
        "object": o.name,
        "active_action": ad.action.name if ad.action else None,
        "tracks": [{"name": t.name, "mute": t.mute,
                    "strips": [{"name": s.name, "action": s.action.name if s.action else None,
                                "frame_start": r(s.frame_start, 2), "frame_end": r(s.frame_end, 2),
                                "repeat": r(s.repeat, 2), "blend_type": s.blend_type}
                               for s in t.strips]} for t in ad.nla_tracks],
    })
report["timeline_markers"] = [{"name": m.name, "frame": m.frame} for m in scene.timeline_markers]

# ---------------------------------------------------------------- resumen de medidas
meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.visible_get()]
if meshes:
    lo, hi = world_bbox(meshes)
    report["overall_world_bbox_m"] = {"min": vec(lo * us.scale_length), "max": vec(hi * us.scale_length),
                                      "size": vec((hi - lo) * us.scale_length)}

# medidas por grupos de vértices (aletas), a partir de vértices con peso > 0.5
region_extents = {}
for o in meshes:
    idx = {g.index: g.name for g in o.vertex_groups}
    pts = defaultdict(list)
    mw = o.matrix_world
    for v in o.data.vertices:
        for g in v.groups:
            if g.weight > 0.5:
                pts[idx[g.group]].append(mw @ v.co)
    for name, ps in pts.items():
        lo_ = Vector(map(min, *ps)) if len(ps) > 1 else ps[0]
        hi_ = Vector(map(max, *ps)) if len(ps) > 1 else ps[0]
        region_extents[f"{o.name}:{name}"] = {"vertices": len(ps),
                                              "size_m": vec((hi_ - lo_) * us.scale_length, 3),
                                              "min_m": vec(lo_ * us.scale_length, 3),
                                              "max_m": vec(hi_ * us.scale_length, 3)}
report["vertex_group_extents"] = region_extents

with open(os.path.join(OUT, "audit.json"), "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2, ensure_ascii=False)
print("AUDIT_JSON_OK", os.path.join(OUT, "audit.json"))

# ---------------------------------------------------------------- renders
if "--no-render" not in argv and meshes:
    lo, hi = world_bbox(meshes)
    center = (lo + hi) / 2
    size = hi - lo
    span = max(size)

    cam_data = bpy.data.cameras.new("AuditCam")
    cam = bpy.data.objects.new("AuditCam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    sun_data = bpy.data.lights.new("AuditSun", "SUN")
    sun_data.energy = 3.0
    sun = bpy.data.objects.new("AuditSun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(40), math.radians(10), math.radians(30))

    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"

    long_axis = max(range(3), key=lambda i: size[i])
    # vistas definidas relativas al eje largo del modelo; Z es arriba en Blender
    views = {
        "lateral": Vector((0, -1, 0)) if long_axis == 0 else Vector((1, 0, 0)),
        "superior": Vector((0, 0, 1)),
        "frontal": (Vector((1, 0, 0)) if long_axis == 0 else Vector((0, -1, 0))),
        "tres_cuartos": None,
    }
    # el morro: extremo del eje largo con más vértices "gruesos" es difícil de saber; se usan ambos extremos en frontal
    views["tres_cuartos"] = (views["lateral"] + views["frontal"] * 0.8 + Vector((0, 0, 0.5))).normalized()

    def aim(obj, direction, dist):
        obj.location = center + direction.normalized() * dist
        rot = (center - obj.location).to_track_quat("-Z", "Y" if abs(direction.z) > 0.99 else "Z")
        obj.rotation_euler = rot.to_euler()

    engines = [("workbench", "BLENDER_WORKBENCH")]
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scene.render.engine = eng
            engines.append(("eevee", eng))
            break
        except TypeError:
            continue

    for tag, eng in engines:
        scene.render.engine = eng
        if eng == "BLENDER_WORKBENCH":
            sh = scene.display.shading
            sh.light = "STUDIO"
            sh.color_type = "TEXTURE"
            sh.show_cavity = True
            sh.show_shadows = False
            sh.background_type = "VIEWPORT"
            sh.background_color = (0.85, 0.87, 0.9)
        else:
            if scene.world is None:
                scene.world = bpy.data.worlds.new("AuditWorld")
            scene.world.use_nodes = True
            bg = scene.world.node_tree.nodes.get("Background")
            if bg:
                bg.inputs[0].default_value = (0.6, 0.65, 0.7, 1)
                bg.inputs[1].default_value = 0.8
        for vname, d in views.items():
            if tag == "eevee" and vname not in ("lateral", "tres_cuartos"):
                continue
            cam_data.type = "ORTHO" if vname != "tres_cuartos" else "PERSP"
            if cam_data.type == "ORTHO":
                cam_data.ortho_scale = span * 1.1
                aim(cam, d, span * 3)
            else:
                cam_data.lens = 50
                aim(cam, d, span * 1.6)
            cam_data.clip_end = span * 10
            scene.render.filepath = os.path.join(OUT, f"{tag}_{vname}.png")
            try:
                bpy.ops.render.render(write_still=True)
                print("RENDER_OK", scene.render.filepath)
            except Exception as e:
                print("RENDER_FAIL", vname, tag, e)

print("AUDIT_DONE")
