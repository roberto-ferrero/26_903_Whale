"""Fase 1.3 · Limpieza y normalización de la copia de trabajo.

Uso:
  blender.exe --background <Whale_opt_f1_2.blend> --python fase_1_3_limpieza.py -- <salida.blend> [longitud_objetivo_m]

Parte SIEMPRE del resultado de la Fase 1.2 (instantánea), así que es repetible.
- Escala malla + esqueleto a la longitud objetivo (14 m por defecto) aplicando la
  escala y multiplicando las claves de posición de los huesos en todas las acciones.
- Elimina datos sobrantes: grupo de vértices sin hueso, atributo de color `Col`
  si ningún material lo usa, acción de un fotograma `RestPosee`, huérfanos.
- Comprueba que la orientación y las transformaciones son compatibles con glTF.
No toca influencias ni n-gons (ver doc: se hace tras aplicar la subdivisión, 1.4/1.6).
"""
import bpy
import json
import sys
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1:]
OUT = args[0]
TARGET_LEN = float(args[1]) if len(args) > 1 else 14.0

body = bpy.data.objects["Whale"]
rig = bpy.data.objects["WhaleRig"]
log = {}


def rest_bbox():
    rig.data.pose_position = "REST"
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    eo = body.evaluated_get(dg)
    me = eo.to_mesh()
    pts = [eo.matrix_world @ v.co for v in me.vertices]
    eo.to_mesh_clear()
    rig.data.pose_position = "POSE"
    return Vector(map(min, *pts)), Vector(map(max, *pts))


def action_fcurves(act):
    curves = []
    for layer in act.layers:
        for strip in layer.strips:
            for slot in act.slots:
                cb = strip.channelbag(slot)
                if cb:
                    curves += list(cb.fcurves)
    return curves


# ------------------------------------------------------------------ 1. escala
lo, hi = rest_bbox()
length = hi.y - lo.y
factor = TARGET_LEN / length
log["length_before_m"] = round(length, 4)
if abs(factor - 1) < 1e-3:
    print("SCALE_SKIP ya está a", length)
else:
    # Ambos objetos en el origen y sin transformaciones; la malla es hija del esqueleto
    # (parent inverse identidad). Se escalan los DATOS (vértices y reposo de los huesos),
    # no los objetos: así no se hereda la escala dos veces.
    for o in (body, rig):
        d = o.matrix_world - Matrix.Identity(4)
        assert max(abs(x) for row in d for x in row) < 1e-6, o.name
    assert body.matrix_parent_inverse == Matrix.Identity(4)
    S = Matrix.Scale(factor, 4)
    body.data.transform(S)
    rig.data.transform(S)

    # claves de posición de huesos (espacio local del hueso -> escalan con el esqueleto)
    n_curves = n_keys = 0
    for act in bpy.data.actions:
        for fc in action_fcurves(act):
            if fc.data_path.startswith('pose.bones["') and fc.data_path.endswith(".location"):
                for kp in fc.keyframe_points:
                    kp.co.y *= factor
                    kp.handle_left.y *= factor
                    kp.handle_right.y *= factor
                    n_keys += 1
                fc.update()
                n_curves += 1
    log["scale_factor"] = round(factor, 6)
    log["location_fcurves_scaled"] = n_curves
    log["location_keys_scaled"] = n_keys

lo, hi = rest_bbox()
log["length_after_m"] = round(hi.y - lo.y, 4)
log["rest_bbox_after_m"] = {"min": [round(x, 3) for x in lo], "max": [round(x, 3) for x in hi],
                            "size": [round(x, 3) for x in hi - lo]}

# ------------------------------------------------------------------ 2. datos sobrantes
bones = {b.name for b in rig.data.bones}
removed_groups = [g.name for g in body.vertex_groups if g.name not in bones]
for name in removed_groups:
    body.vertex_groups.remove(body.vertex_groups[name])
log["vertex_groups_removed"] = removed_groups

# atributo de color: solo se borra si ningún material lo lee
uses_color_attr = any(n.bl_idname in ("ShaderNodeVertexColor", "ShaderNodeAttribute")
                      for m in body.data.materials if m and m.node_tree for n in m.node_tree.nodes)
removed_attrs = []
if not uses_color_attr:
    for ca in list(body.data.color_attributes):
        removed_attrs.append(ca.name)
        body.data.color_attributes.remove(ca)
log["color_attributes_removed"] = removed_attrs

removed_actions = []
for act in list(bpy.data.actions):
    if act.frame_range[1] - act.frame_range[0] < 1:  # acciones de un solo fotograma (RestPosee)
        for t in list(rig.animation_data.nla_tracks):
            if any(s.action == act for s in t.strips):
                rig.animation_data.nla_tracks.remove(t)
        removed_actions.append(act.name)
        bpy.data.actions.remove(act)
log["actions_removed"] = removed_actions

# nodos sin conexión en los materiales (no aportan nada al exportar)
for m in bpy.data.materials:
    if not m.node_tree:
        continue
    linked = {l.from_node for l in m.node_tree.links} | {l.to_node for l in m.node_tree.links}
    for n in list(m.node_tree.nodes):
        if n not in linked and n.bl_idname != "ShaderNodeOutputMaterial":
            m.node_tree.nodes.remove(n)

bpy.data.orphans_purge(do_recursive=True)

# ------------------------------------------------------------------ 3. comprobaciones glTF
checks = {
    "transforms_identity": all(o.location.length < 1e-6 and o.rotation_euler.to_quaternion().angle < 1e-6
                               and all(abs(s - 1) < 1e-6 for s in o.scale) for o in (body, rig)),
    "mesh_parent": body.parent.name if body.parent else None,
    "armature_modifier_target": [m.object.name for m in body.modifiers if m.type == "ARMATURE"],
    "head_towards": "-Y (Blender) -> +Z (glTF/Three.js)" if (lo.y + hi.y) / 2 > -1 else "revisar",
    "up_axis": "+Z (Blender) -> +Y (glTF)",
    "bone_rotation_modes": sorted({pb.rotation_mode for pb in rig.pose.bones}),
    "materials": [m.name for m in body.data.materials],
    "images": [i.filepath for i in bpy.data.images if i.source == "FILE"],
    "actions": sorted(a.name for a in bpy.data.actions),
    "ngons": sum(1 for p in body.data.polygons if p.loop_total > 4),
}
log["checks"] = checks

s = bpy.context.scene
s.unit_settings.system, s.unit_settings.scale_length, s.unit_settings.length_unit = "METRIC", 1.0, "METERS"
# rutas de imagen: siempre //textures/<fichero> respecto al .blend de salida
import os
for img in bpy.data.images:
    if img.source == "FILE":
        img.filepath = "//textures/" + img.filepath.replace("\\", "/").rsplit("/", 1)[-1]  # ntpath.basename falla con "//" (UNC)
def _tex_file(img):
    return img.filepath.replace("\\", "/").rsplit("/", 1)[-1]


missing = [i.filepath for i in bpy.data.images if i.source == "FILE" and (
    not _tex_file(i) or not os.path.isfile(os.path.join(os.path.dirname(OUT), "textures", _tex_file(i))))]
assert not missing, missing
bpy.ops.wm.save_as_mainfile(filepath=OUT, check_existing=False, relative_remap=False, compress=True)
print("LOG", json.dumps(log, indent=1, ensure_ascii=False))
print("FASE_1_3_OK", OUT)
