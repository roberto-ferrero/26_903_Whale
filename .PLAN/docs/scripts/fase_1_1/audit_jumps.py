"""Fase 1.1 · Auditoría: análisis de los saltos (giro, cruces con el plano del agua).

Uso:
  blender.exe --background <Whale.blend> --python audit_jumps.py -- <carpeta_salida>

Solo lectura: no guarda el .blend. Escribe <salida>/jumps.json.
"""
import bpy
import json
import math
import os
import sys
from mathutils import Vector

OUT = sys.argv[sys.argv.index("--") + 1]
scene = bpy.context.scene
RIG = bpy.data.objects["HumpbackRig(bakeanimationshere)"]
BODY = bpy.data.objects["HumpbackWhale"]
WATER_Z = bpy.data.objects["Water"].location.z
for t in RIG.animation_data.nla_tracks:
    t.mute = True


def body_z_range():
    dg = bpy.context.evaluated_depsgraph_get()
    eo = BODY.evaluated_get(dg)
    me = eo.to_mesh()
    zs = [(eo.matrix_world @ v.co).z for v in me.vertices]
    eo.to_mesh_clear()
    return min(zs), max(zs)


out = {"water_plane_z": round(WATER_Z, 3)}
for name in ("JumpStraight_Anim", "JumpLeft_Anim", "JumpRight_Anim", "Swim1_Anim", "Swim2_Anim", "Idle_Anim", "MouthOpen_Anim"):
    act = bpy.data.actions[name]
    RIG.animation_data.action = act
    if RIG.animation_data.action_slot is None:
        RIG.animation_data.action_slot = act.slots[0]
    f0, f1 = map(int, act.frame_range)
    rows = []
    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        m = RIG.matrix_world @ RIG.pose.bones["Spine.004"].matrix
        axis = m.col[1].to_3d().normalized()      # eje del hueso (hacia la cabeza)
        side = m.col[0].to_3d().normalized()      # eje lateral del hueso
        pitch = math.degrees(math.asin(max(-1, min(1, axis.z))))
        # giro sobre el eje longitudinal: ángulo del eje lateral respecto al plano horizontal
        roll = math.degrees(math.atan2(side.z, math.hypot(side.x, side.y)))
        head = RIG.matrix_world @ RIG.pose.bones["Head"].tail
        tail = RIG.matrix_world @ RIG.pose.bones["Spine.007"].tail
        rows.append({"f": f, "pitch": round(pitch, 1), "roll": round(roll, 1),
                     "head_z": round(head.z, 2), "tail_z": round(tail.z, 2)})
    entry = {"frames": [f0, f1],
             "pitch_range_deg": [min(r["pitch"] for r in rows), max(r["pitch"] for r in rows)],
             "roll_range_deg": [min(r["roll"] for r in rows), max(r["roll"] for r in rows)]}
    if name.startswith("Jump"):
        above = [r["head_z"] > WATER_Z + 0.5 for r in rows]
        exit_f = next((r["f"] for r, a, pa in zip(rows[1:], above[1:], above) if a and not pa), None)
        apex = max(rows, key=lambda r: r["head_z"])
        # impacto: tras el ápice, el primer fotograma en que la cola baja y la cabeza vuelve al agua
        after = [r for r in rows if r["f"] > apex["f"]]
        impact_f = next((r["f"] for r in after if r["head_z"] <= WATER_Z + 0.5), None)
        # fracción del cuerpo fuera del agua en el ápice
        scene.frame_set(apex["f"])
        zmin, zmax = body_z_range()
        entry.update({
            "surface_exit_frame_est": exit_f, "apex_frame": apex["f"], "apex_head_z": apex["head_z"],
            "impact_frame_est": impact_f,
            "body_z_at_apex": [round(zmin, 2), round(zmax, 2)],
            "fraction_above_water_at_apex": round((zmax - WATER_Z) / (zmax - zmin), 2),
            "roll_at_apex_deg": apex["roll"],
        })
    entry["samples_every_10"] = rows[::10]
    out[name] = entry

with open(os.path.join(OUT, "jumps.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, indent=1, ensure_ascii=False)
print("JUMPS_OK")
