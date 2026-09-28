"""Fase 1.2 · Copia de trabajo del modelo descargado.

Uso (Blender 5.1, sin abrir ningún .blend):
  blender.exe --background --factory-startup --python fase_1_2_copia_trabajo.py -- <Whale.blend original> <carpeta Textures\\Textures> <carpeta destino>

- Copia las texturas necesarias a <destino>/textures/.
- Crea <destino>/Whale_opt.blend con la malla de juego, el esqueleto horneado y sus
  acciones *_Anim (añadidos desde el original, que no se modifica ni se guarda).
- Crea <destino>/Whale_bake_src.blend con el esculpido de alta (para hornear en 1.4).
- Todas las rutas de imagen quedan relativas (//textures/...).
"""
import bpy
import os
import shutil
import sys

SRC_BLEND, SRC_TEX, DST = sys.argv[sys.argv.index("--") + 1:][:3]
TEX_DST = os.path.join(DST, "textures")
os.makedirs(TEX_DST, exist_ok=True)

# ------------------------------------------------------------------ texturas
# (origen relativo a Textures\Textures, nombre destino)
COPY = [
    ("WithJawBarnacles/2kText/Diffuse.png", "skin_diffuse_2k.png"),
    ("WithJawBarnacles/2kText/Normal.png", "skin_normal_2k.png"),
    ("WithJawBarnacles/2kText/Ambient.png", "skin_ao_2k.png"),
    ("WithJawBarnacles/2kText/Height.png", "skin_height_2k.png"),
    ("WithJawBarnacles/4kText/Diffuse.png", "skin_diffuse_4k.png"),
    ("WithJawBarnacles/4kText/Normal.png", "skin_normal_4k.png"),
    ("WithJawBarnacles/4kText/Ambient.png", "skin_ao_4k.png"),
    ("Wed,Dry Roughness/2kText/DryRoughness.png", "skin_roughness_dry_2k.png"),
    ("Wed,Dry Roughness/2kText/WetRoughness.png", "skin_roughness_wet_2k.png"),
    ("Wed,Dry Roughness/4kText/DryRoughness.png", "skin_roughness_dry_4k.png"),
    ("Wed,Dry Roughness/4kText/WetRoughness.png", "skin_roughness_wet_4k.png"),
    ("BarbsTexture/fiber_albedo.png", "barbs_albedo.png"),
    ("BarbsTexture/fiber_alpha.png", "barbs_alpha.png"),
    ("BarbsTexture/fiber_specular.png", "barbs_specular.png"),
    ("BarbsTexture/fiber_translucency.png", "barbs_translucency.png"),
    ("BarbsTexture/fiver.png", "barbs_normal.png"),
    ("BarbsTexture/fiber_ambient.png", "barbs_ao.png"),
]
for src, dst in COPY:
    shutil.copy2(os.path.join(SRC_TEX, src), os.path.join(TEX_DST, dst))
print("TEXTURES_COPIED", len(COPY))

# imagen del original (por nombre de fichero en su ruta rota) -> textura copiada (2K por defecto)
IMAGE_MAP = {
    "Diffuse.png": "skin_diffuse_2k.png",
    "Normal.png": "skin_normal_2k.png",
    "AOMap.png": "skin_ao_2k.png",
    "image (3).png": "skin_roughness_dry_2k.png",
    "fiber_albedo.png": "barbs_albedo.png",
    "fiber_alpha.png": "barbs_alpha.png",
    "fiber_specular.png": "barbs_specular.png",
    "fiber_translucency.png": "barbs_translucency.png",
    "fiver.png": "barbs_normal.png",
}


def clean_scene():
    """Deja el fichero de fábrica vacío (sin cubo, cámara ni luz)."""
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights, bpy.data.images):
        for d in list(coll):
            if d.users == 0:
                coll.remove(d)


def append_objects(names):
    with bpy.data.libraries.load(SRC_BLEND, link=False) as (src, dst):
        missing = [n for n in names if n not in src.objects]
        if missing:
            raise RuntimeError(f"No están en el original: {missing}")
        dst.objects = list(names)
    coll = bpy.context.scene.collection
    for o in dst.objects:
        coll.objects.link(o)
    return {o.name: o for o in dst.objects}


def relink_images():
    report = {}
    for img in bpy.data.images:
        if img.source != "FILE":
            continue
        base = os.path.basename(img.filepath.replace("\\", "/"))
        new = IMAGE_MAP.get(base)
        if new:
            img.filepath = "//textures/" + new
            img.name = os.path.splitext(new)[0]
            report[img.name] = img.filepath
    return report


def set_scene(fps=24):
    s = bpy.context.scene
    s.unit_settings.system = "METRIC"
    s.unit_settings.scale_length = 1.0
    s.unit_settings.length_unit = "METERS"
    s.render.fps = fps
    s.render.fps_base = 1.0


def save(path):
    bpy.ops.wm.save_as_mainfile(filepath=path, check_existing=False, relative_remap=True, compress=True)
    print("SAVED", path)


# ------------------------------------------------------------------ Whale_opt.blend
clean_scene()
set_scene()
objs = append_objects(["HumpbackWhale", "HumpbackRig(bakeanimationshere)"])
body = objs["HumpbackWhale"]
rig = objs["HumpbackRig(bakeanimationshere)"]
body.name = body.data.name = "Whale"
rig.name = "WhaleRig"
rig.data.name = "WhaleRig"
rig.hide_viewport = rig.hide_render = False
body.hide_viewport = body.hide_render = False

# pose de reposo por defecto y sin acción activa: los clips quedan en las pistas NLA
rig.animation_data.action = None
for t in rig.animation_data.nla_tracks:
    t.mute = False
    t.select = False

images = relink_images()
missing = [i.name for i in bpy.data.images if i.source == "FILE" and not os.path.exists(
    os.path.join(DST, i.filepath[2:].replace("/", os.sep)))]
if missing:
    print("IMAGES_NOT_RELINKED", missing)

s = bpy.context.scene
s.frame_start, s.frame_end = 0, 143
print("ACTIONS", sorted(a.name for a in bpy.data.actions))
print("IMAGES", images)
save(os.path.join(DST, "Whale_opt.blend"))

# ------------------------------------------------------------------ Whale_bake_src.blend (alta poligonal)
bpy.ops.wm.read_factory_settings(use_empty=True)
set_scene()
append_objects(["HIghPoluMOdel", "TongueHighPoly", "eyeshp"])
for o in bpy.data.objects:
    o.hide_viewport = o.hide_render = False
bpy.data.objects["HIghPoluMOdel"].name = "Whale_HighPoly"
bpy.data.objects["TongueHighPoly"].name = "Tongue_HighPoly"
bpy.data.objects["eyeshp"].name = "Eyes_HighPoly"
# las imágenes del material de los ojos en alta no se usan para hornear: se descartan
for o in bpy.data.objects:
    o.data.materials.clear()
bpy.data.orphans_purge(do_recursive=True)
save(os.path.join(DST, "Whale_bake_src.blend"))
print("FASE_1_2_OK")
