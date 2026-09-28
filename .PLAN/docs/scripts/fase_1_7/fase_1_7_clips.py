"""Fase 1.7 · Clips de animación para el salto (se añaden a los originales).

Uso:
  blender.exe --background <Whale_opt_f1_6.blend> --python fase_1_7_clips.py -- <salida.blend> <informe.json>

Crea, horneando pose a pose a 24 fps:
  swim_idle    copia de Swim1_Anim (nado en bucle, sin desplazamiento)
  swim_fast    Swim2_Anim un 35 % más rápido y con columna/caudal un 25 % más amplias (bucle cerrado)
  breach_body  cuerpo de JumpRight_Anim SIN el movimiento global de MasterBone (subida y giro):
               la trayectoria la pone el hueso Root por código (Three.js). Lleva en sus
               propiedades (extras en glTF) los tiempos de salida, ápice e impacto del clip.
Los clips originales se conservan.
"""
import bpy
import json
import sys
from mathutils import Quaternion

OUT, REPORT = sys.argv[sys.argv.index("--") + 1:][:2]
scene = bpy.context.scene
FPS = scene.render.fps
rig = bpy.data.objects["WhaleRig"]
ad = rig.animation_data
rep = {}


def set_action(act):
    ad.action = act
    # una acción recién creada aún no tiene slot: Blender lo crea con la primera clave
    if act is not None and ad.action_slot is None and len(act.slots):
        ad.action_slot = act.slots[0]


def sample_pose(src, frame):
    """Pose (loc, quat, scale) de cada hueso en un fotograma (admite subfotogramas)."""
    set_action(src)
    f = int(frame)
    scene.frame_set(f, subframe=frame - f)
    return {pb.name: (pb.location.copy(), pb.rotation_quaternion.copy(), pb.scale.copy()) for pb in rig.pose.bones}


def bake(name, poses):
    """Crea una acción nueva con una clave por fotograma y la pone en su propia pista NLA."""
    old = bpy.data.actions.get(name)
    if old:
        bpy.data.actions.remove(old)
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    set_action(act)
    for f, pose in enumerate(poses):
        for pb in rig.pose.bones:
            if pb.name == "Root":
                continue  # Root queda libre para la trayectoria
            loc, rot, scl = pose[pb.name]
            pb.location, pb.rotation_quaternion, pb.scale = loc, rot, scl
            pb.keyframe_insert("location", frame=f, group=pb.name)
            pb.keyframe_insert("rotation_quaternion", frame=f, group=pb.name)
            pb.keyframe_insert("scale", frame=f, group=pb.name)
    set_action(None)
    track = ad.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, act)
    return act


def amplify(q, k):
    axis, angle = q.to_axis_angle()
    return Quaternion(axis, angle * k)


for t in ad.nla_tracks:
    t.mute = True

# ------------------------------------------------------------------ swim_idle
src = bpy.data.actions["Swim1_Anim"]
f0, f1 = map(int, src.frame_range)
bake("swim_idle", [sample_pose(src, f) for f in range(f0, f1 + 1)])
rep["swim_idle"] = {"source": src.name, "frames": f1 - f0 + 1, "seconds": round((f1 - f0) / FPS, 2)}

# ------------------------------------------------------------------ swim_fast
src = bpy.data.actions["Swim2_Anim"]
f0, f1 = map(int, src.frame_range)
n_out = round((f1 - f0) * 0.65)  # 35 % más corto → más rápido
AMP = 1.25
amp_bones = {pb.name for pb in rig.pose.bones if pb.name.startswith(("Spine", "Tail", "MasterBone.006"))}
poses = []
for i in range(n_out + 1):
    pose = sample_pose(src, f0 + (f1 - f0) * i / n_out)
    for name in amp_bones:
        loc, rot, scl = pose[name]
        pose[name] = (loc, amplify(rot, AMP), scl)
    poses.append(pose)
bake("swim_fast", poses)
rep["swim_fast"] = {"source": src.name, "frames": n_out + 1, "seconds": round(n_out / FPS, 2),
                    "speed": round((f1 - f0) / n_out, 2), "amplitude": AMP, "amplified_bones": len(amp_bones)}

# ------------------------------------------------------------------ breach_body
src = bpy.data.actions["JumpRight_Anim"]
f0, f1 = map(int, src.frame_range)
poses = []
for f in range(f0, f1 + 1):
    pose = sample_pose(src, f)
    loc, rot, scl = pose["MasterBone"]
    pose["MasterBone"] = (loc * 0, Quaternion(), scl)  # sin subida ni giro global
    poses.append(pose)
act = bake("breach_body", poses)
# tiempos del clip original (auditoría 1.1): salida de la cabeza ~f63, ápice f87, impacto ~f122
events = {"surface_exit": round(63 / FPS, 3), "apex": round(87 / FPS, 3), "impact": round(122 / FPS, 3)}
act["events"] = json.dumps(events)
act["source"] = src.name
# copia en el hueso Root: gltfpack (Fase 1.8) conserva los extras de nodos pero no los de animaciones
rig.data.bones["Root"]["clip_events"] = json.dumps({"breach_body": events})
rep["breach_body"] = {"source": src.name, "frames": f1 - f0 + 1, "seconds": round((f1 - f0) / FPS, 2), "events_s": events}

for t in ad.nla_tracks:
    t.mute = False
scene.frame_set(0)
for img in bpy.data.images:
    if img.source == "FILE" and "/gltf/" not in img.filepath.replace("\\", "/"):
        img.filepath = "//textures/" + img.filepath.replace("\\", "/").rsplit("/", 1)[-1]
bpy.ops.wm.save_as_mainfile(filepath=OUT, check_existing=False, relative_remap=False, compress=True)
rep["actions"] = sorted(a.name for a in bpy.data.actions)
with open(REPORT, "w", encoding="utf-8") as fh:
    json.dump(rep, fh, indent=1, ensure_ascii=False)
print("REPORT", json.dumps(rep, indent=1, ensure_ascii=False))
print("FASE_1_7_OK")
