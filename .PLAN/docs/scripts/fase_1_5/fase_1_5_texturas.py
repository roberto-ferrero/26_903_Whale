"""Fase 1.5 · Texturas PBR para glTF y materiales exportables.

Uso:
  blender.exe --background <Whale_opt_f1_4.blend> --python fase_1_5_texturas.py -- <salida.blend> [--json <informe.json>]

Genera en <carpeta del .blend>/textures/gltf/ (2048², PNG 8 bits):
  whale_basecolor_2k.png  sRGB   diffuse ajustado (+ AO parcial) — ver PARAMS
  whale_orm_2k.png        lineal R = AO, G = rugosidad seca, B = metalicidad (0)
  whale_normal_2k.png     lineal normal map tangente OpenGL (+Y), copia del entregado
  whale_wet_2k.png        lineal R = rugosidad mojada, G = retención de agua (cavidades), B = altura
  barbs_basecolor.png     sRGB+A albedo de las "barbs" con alfa en el canal A
  barbs_normal.png        lineal normal de las "barbs"
y reconstruye los materiales `Humpback` y `Barbs` con nodos que el exportador glTF entiende.
"""
import bpy
import json
import os
import shutil
import sys
import numpy as np

args = sys.argv[sys.argv.index("--") + 1:]
OUT = args[0]
REPORT = args[args.index("--json") + 1] if "--json" in args else None
ROOT = os.path.dirname(OUT)
SRC = os.path.join(ROOT, "textures")
DST = os.path.join(SRC, "gltf")
os.makedirs(DST, exist_ok=True)

PARAMS = {
    "lift": 0.05,                  # levanta negros en sRGB: out = lift + (1 - lift) * in
    "dark_gain_rgb": [0.96, 1.0, 0.93],  # corrige el tinte azul/violeta de las zonas oscuras
    "dark_weight_lum": [0.15, 0.45],     # de oscuro (peso 1) a claro (peso 0), por luminancia
    "ao_in_basecolor": 0.35,       # fracción del AO que se hornea en el color (el resto va al ORM)
    "max_srgb": 0.86,              # techo de blancos (PBR: albedo no más brillante que la nieve)
}


def read(path):
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "Non-Color"  # valores codificados tal cual
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)


def write(path, arr):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(np.ascontiguousarray(arr, dtype=np.float32).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


to_lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
to_srgb = lambda c: np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.clip(c, 0, None), 1 / 2.4) - 0.055)
lum = lambda c: c[..., 0] * 0.2126 + c[..., 1] * 0.7152 + c[..., 2] * 0.0722
smooth = lambda e0, e1, x: np.clip((x - e0) / (e1 - e0), 0, 1) ** 2 * (3 - 2 * np.clip((x - e0) / (e1 - e0), 0, 1))

dif = read(os.path.join(SRC, "skin_diffuse_2k.png"))
ao = read(os.path.join(SRC, "skin_ao_2k.png"))[..., 0]
dry = read(os.path.join(SRC, "skin_roughness_dry_2k.png"))[..., 0]
wet = read(os.path.join(SRC, "skin_roughness_wet_2k.png"))[..., 0]
height = read(os.path.join(SRC, "skin_height_2k.png"))[..., 0]
H, W = dif.shape[:2]
ones = np.ones((H, W), dtype=np.float32)

# ---- baseColor
c = dif[..., :3].copy()
wdark = 1 - smooth(*PARAMS["dark_weight_lum"], lum(c))[..., None]
gain = 1 + (np.array(PARAMS["dark_gain_rgb"], dtype=np.float32) - 1) * wdark
c = c * gain
c = PARAMS["lift"] + (1 - PARAMS["lift"]) * c
lin = to_lin(np.clip(c, 0, 1)) * (1 - PARAMS["ao_in_basecolor"] * (1 - ao))[..., None]
c = np.minimum(to_srgb(lin), PARAMS["max_srgb"])
write(os.path.join(DST, "whale_basecolor_2k.png"), np.dstack([c, ones]))

# ---- ORM (glTF: R oclusión, G rugosidad, B metalicidad)
write(os.path.join(DST, "whale_orm_2k.png"), np.dstack([ao, dry, np.zeros_like(ao), ones]))

# ---- mojado: R rugosidad mojada, G retención (cavidades: AO bajo + zonas bajas del relieve), B altura
hn = (height - height.min()) / max(1e-6, float(height.max() - height.min()))
retention = np.clip(0.6 * (1 - ao) + 0.4 * (1 - hn), 0, 1)
write(os.path.join(DST, "whale_wet_2k.png"), np.dstack([wet, retention, hn, ones]))

# ---- normal (el entregado ya es tangente OpenGL, igual que glTF)
shutil.copy2(os.path.join(SRC, "skin_normal_2k.png"), os.path.join(DST, "whale_normal_2k.png"))

# ---- barbs
alb = read(os.path.join(SRC, "barbs_albedo.png"))
alp = read(os.path.join(SRC, "barbs_alpha.png"))[..., 0]
write(os.path.join(DST, "barbs_basecolor.png"), np.dstack([alb[..., :3], alp]))
shutil.copy2(os.path.join(SRC, "barbs_normal.png"), os.path.join(DST, "barbs_normal.png"))

stats = lambda a: [round(float(x), 3) for x in a]
rep = {"params": PARAMS,
       "basecolor_dark_mean": stats(c[lum(c) < 0.25].mean(0)),
       "basecolor_light_mean": stats(c[lum(c) > 0.6].mean(0)),
       "basecolor_p05_p50_p95_lum": stats(np.percentile(lum(c), [5, 50, 95])),
       "barbs_alpha_coverage": round(float((alp > 0.5).mean()), 3)}
print("TEXTURES", json.dumps(rep))


# ------------------------------------------------------------------ materiales exportables
def tex_node(nt, fname, colorspace, loc):
    n = nt.nodes.new("ShaderNodeTexImage")
    img = bpy.data.images.load(os.path.join(DST, fname), check_existing=True)
    img.filepath = "//textures/gltf/" + fname
    img.colorspace_settings.name = colorspace
    n.image = img
    n.location = loc
    return n


def gltf_output_group():
    """Grupo `glTF Material Output`: el exportador lee de aquí la oclusión (AO)."""
    g = bpy.data.node_groups.get("glTF Material Output")
    if g is None:
        g = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        g.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        g.interface.new_socket("Thickness", in_out="INPUT", socket_type="NodeSocketFloat")
    return g


def rebuild_skin(mat):
    nt = mat.node_tree
    spec = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled").inputs["Specular IOR Level"].default_value
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (600, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled"); bsdf.location = (250, 0)
    bsdf.inputs["Specular IOR Level"].default_value = spec
    bsdf.inputs["Metallic"].default_value = 0.0
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    base = tex_node(nt, "whale_basecolor_2k.png", "sRGB", (-400, 250))
    nt.links.new(base.outputs["Color"], bsdf.inputs["Base Color"])
    orm = tex_node(nt, "whale_orm_2k.png", "Non-Color", (-400, -50))
    sep = nt.nodes.new("ShaderNodeSeparateColor"); sep.location = (-100, -50)
    nt.links.new(orm.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    grp = nt.nodes.new("ShaderNodeGroup"); grp.node_tree = gltf_output_group(); grp.location = (250, -450)
    nt.links.new(sep.outputs["Red"], grp.inputs["Occlusion"])
    nrm = tex_node(nt, "whale_normal_2k.png", "Non-Color", (-400, -350))
    nm = nt.nodes.new("ShaderNodeNormalMap"); nm.location = (-100, -350)
    nt.links.new(nrm.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    # mapa de mojado: no es parte de glTF; se referencia como propiedad (irá en extras) y se usa en Three.js
    mat["wet_map"] = "whale_wet_2k.png"
    mat["wet_map_channels"] = "R=rugosidad mojada, G=retencion de agua, B=altura"


def rebuild_barbs(mat):
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (600, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled"); bsdf.location = (250, 0)
    bsdf.inputs["Roughness"].default_value = 0.45
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    base = tex_node(nt, "barbs_basecolor.png", "sRGB", (-400, 200))
    nt.links.new(base.outputs["Color"], bsdf.inputs["Base Color"])
    # recorte de alfa (glTF alphaMode MASK, corte 0,5): Math ROUND sobre el alfa
    rnd = nt.nodes.new("ShaderNodeMath"); rnd.operation = "ROUND"; rnd.location = (-100, 50)
    nt.links.new(base.outputs["Alpha"], rnd.inputs[0])
    nt.links.new(rnd.outputs["Value"], bsdf.inputs["Alpha"])
    nrm = tex_node(nt, "barbs_normal.png", "Non-Color", (-400, -250))
    nm = nt.nodes.new("ShaderNodeNormalMap"); nm.location = (-100, -250)
    nt.links.new(nrm.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    mat.surface_render_method = "DITHERED"


rebuild_skin(bpy.data.materials["Humpback"])
rebuild_barbs(bpy.data.materials["Barbs"])
bpy.data.materials["Humpback"].surface_render_method = "DITHERED"
bpy.data.orphans_purge(do_recursive=True)
for img in bpy.data.images:
    if img.source == "FILE" and "/gltf/" not in img.filepath.replace("\\", "/"):
        img.filepath = "//textures/" + img.filepath.replace("\\", "/").rsplit("/", 1)[-1]
rep["images_in_file"] = sorted(i.filepath for i in bpy.data.images if i.source == "FILE")
bpy.ops.wm.save_as_mainfile(filepath=OUT, check_existing=False, relative_remap=False, compress=True)
if REPORT:
    with open(REPORT, "w", encoding="utf-8") as fh:
        json.dump(rep, fh, indent=1, ensure_ascii=False)
print("REPORT", json.dumps(rep, indent=1, ensure_ascii=False))
print("FASE_1_5_OK")
